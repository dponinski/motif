const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { gitData } = require("./support/git-data");
const { openSync, syncNow } = require("./support/sync-helpers");

const { OUT } = require("./support/env");
const { FIXTURE } = require("./support/env");
const blobSha = (text) => {
  const body = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};
function loadDir(dir, prefix = "") {
  const files = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) Object.assign(files, loadDir(path.join(dir, e.name), `${prefix}${e.name}/`));
    else files[`${prefix}${e.name.replace(/\.fixture$/, "")}`] = fs.readFileSync(path.join(dir, e.name), "utf8");
  }
  return files;
}

const design = loadDir(FIXTURE);
// A component made of plain elements and text, to edit text and structure with.
design["src/components/Banner.tsx"] = [
  'export function Banner() {',
  '  return (',
  '    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border">',
  '      <h2 className="text-lg font-semibold">Hello</h2>',
  '      <p className="text-sm text-muted-foreground">World</p>',
  '      <small className="text-xs">Footnote</small>',
  '    </div>',
  '  );',
  '}',
  '',
].join("\n");
design["src/index.ts"] += '\nexport { Banner } from "./components/Banner";\n';
const repos = { "acme/ds": { main: new Map(Object.entries(design)) } };
const prs = [];

async function github(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "x-ratelimit-remaining" };
  const json = (status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

  const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const branches = m && repos[m[1]];
  if (!branches) return json(404, { message: "Not Found" });
  const token = (req.headers()["authorization"] ?? "").replace("Bearer ", "");
  if (token && token !== "t" && token !== "ro") return json(401, { message: "Bad credentials" });
  const rest = decodeURIComponent(m[2] ?? "");
  const method = req.method();
  

  if (rest === "") return json(200, { default_branch: "main", permissions: { push: Boolean(token) } });
  if (rest === "/branches") return json(200, Object.keys(branches).map((name) => ({ name })));
  const gd = gitData({ rest, method, req, branches, prs, json });
  if (gd) return gd;
  if (rest.startsWith("/git/ref/heads/")) {
    const b = rest.slice(15);
    return branches[b] ? json(200, { object: { sha: `commit:${b}` } }) : json(404, { message: "Not Found" });
  }
  if (rest.startsWith("/git/trees/")) {
    const b = rest.slice(11).split("?")[0].replace("commit:", "");
    return branches[b] ? json(200, { truncated: false, tree: [...branches[b].keys()].map((p) => ({ path: p, type: "blob" })) }) : json(404, { message: "Not Found" });
  }
  if (rest === "/git/refs" && method === "POST") {
    const body = req.postDataJSON();
    const from = body.sha.replace("commit:", "");
    branches[body.ref.replace("refs/heads/", "")] = new Map(branches[from]);
    return json(201, {});
  }
  if (rest.startsWith("/contents/")) {
    const file = rest.slice(10);
    if (method === "PUT") {
      const body = req.postDataJSON();
      const tree = branches[body.branch];
      const current = tree.get(file);
      if ((current === undefined ? undefined : blobSha(current)) !== body.sha) return json(409, { message: `${file} does not match ${body.sha}` });
      tree.set(file, Buffer.from(body.content, "base64").toString("utf8"));
      return json(200, { content: { sha: blobSha(tree.get(file)) }, commit: { html_url: "https://github.com/commit/1" } });
    }
    const text = branches[url.searchParams.get("ref")]?.get(file);
    return text === undefined ? json(404, { message: "Not Found" }) : json(200, { sha: blobSha(text), content: Buffer.from(text).toString("base64"), encoding: "base64" });
  }
  if (rest === "/pulls" && method === "POST") {
    if (token === "ro") return json(403, { message: "Resource not accessible by personal access token" });
    const body = req.postDataJSON();
    const pr = { number: prs.length + 1, repo: m[1], ...body, state: "open", merged: false };
    prs.push(pr);
    return json(201, { number: pr.number, html_url: `https://github.com/${m[1]}/pull/${pr.number}` });
  }
  const pull = rest.match(/^\/pulls\/(\d+)$/);
  if (pull) {
    const pr = prs[Number(pull[1]) - 1];
    return json(200, { number: pr.number, html_url: `https://github.com/${pr.repo}/pull/${pr.number}`, state: pr.state, merged: pr.merged });
  }
  return json(404, { message: "Not Found" });
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", github);
  await context.route(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//, async (route) => {
    const out = await serve(route.request().url());
    if (!out) return route.abort();
    route.fulfill({ status: out.status, contentType: out.type, headers: { "access-control-allow-origin": "*" }, body: out.body });
  });

  await seed(page, "struct01");
  await page.goto("http://localhost:3000/editor/struct01");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());

  await nav("Git");
  await page.getByRole("button", { name: "Scan" }).click();
  await page.getByText(/tokens · \d+ components/).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /(Re-import|Import) components/ }).click();
  await page.getByText(/Imported \d+ components/).waitFor();
  if (await gitOpen()) await nav("Git");
  await nav("Components");

  // The pointer is moved off the preview first: a button under it would show its hover color.
  const css = async (selector, prop) => { await page.mouse.move(720, 12); return stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop); };
  const editButton = page.getByRole("button", { name: "Design", exact: true });
  const field = (label) => aside.getByLabel(label, { exact: true });

  const pick = async (selector, tag) => { await stage.locator(selector).first().click(); await aside.getByText(`<${tag}>`).waitFor({ timeout: 10000 }); };
  const settle = async (fn, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };

  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });
  await editButton.click();

  // ── Insert ───────────────────────────────────────────────────────────────
  await pick("p", "p");
  await aside.getByLabel("Insert position").selectOption("after");
  await aside.getByLabel("Insert element").selectOption({ label: "Heading" });
  check("an element is added after the selected one", await settle(async () => (await stage.locator("div.rounded-lg > *").evaluateAll((els) => els.map((e) => e.tagName).join())) === "H2,P,H2,SMALL"));
  check("and the new element is the one selected", await aside.getByText("<h2>").isVisible() && (await field("Text").inputValue()) === "Heading");

  await pick("div.rounded-lg", "div");
  await aside.getByLabel("Insert position").selectOption("last-child");
  await aside.getByLabel("Insert element").selectOption({ label: "Badge" });
  check("a library component can be added inside, and renders", await settle(async () => (await stage.locator("div.rounded-lg > span").count()) === 1 && (await stage.locator("div.rounded-lg > span").innerText()).includes("Badge")));
  check("and is selected, as the component it is", await aside.getByText("<Badge>").isVisible());
  await page.screenshot({ path: `${OUT}/struct-insert.png` });

  // ── Change tag ───────────────────────────────────────────────────────────
  await pick("div.rounded-lg > h2:nth-of-type(2)", "h2");
  await aside.getByLabel("Tag").selectOption("h3");
  const became = await settle(async () => (await stage.locator("div.rounded-lg > h3").count()) === 1);
  check("an element can become another kind", became, became ? "" : "see debug-struct.png");
  if (!became) { await page.screenshot({ path: `${OUT}/debug-struct.png` }); console.log("ASIDE", JSON.stringify((await aside.innerText()).slice(0, 600))); console.log("STAGE", JSON.stringify((await stage.locator("body").innerHTML()).slice(0, 600))); }
  check("keeping its text", (await stage.locator("div.rounded-lg > h3").innerText()) === "Heading");

  // ── Wrap and unwrap ──────────────────────────────────────────────────────
  await pick("div.rounded-lg > p", "p");
  await aside.getByLabel("Wrap in").selectOption("column");
  check("an element can be wrapped", await settle(async () => (await stage.locator("div.rounded-lg > div.flex-col > p").count()) === 1));
  check("and the wrapper is selected", await aside.getByText("<div>").isVisible() && (await field("Gap").inputValue()) === "2");
  check("a wrapper with one element in it can be taken off", await aside.getByRole("button", { name: "Unwrap element" }).isEnabled());
  await aside.getByRole("button", { name: "Unwrap element" }).click();
  check("which puts the element back where it was", await settle(async () => (await stage.locator("div.rounded-lg > p").count()) === 1 && (await stage.locator("div.flex-col div.flex-col").count()) === 0));

  await page.getByRole("button", { name: "Wrap in" }).count();
  await pick("div.rounded-lg > small", "small");
  await aside.getByLabel("Wrap in").selectOption({ label: "Badge" });
  check("an element can be wrapped in a library component", await settle(async () => (await stage.locator("div.rounded-lg > span > small").count()) === 1));

  // ── Undo ─────────────────────────────────────────────────────────────────
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Undo" }).click();
  check("undo takes every one of them back", await settle(async () => (await stage.locator("div.rounded-lg > *").evaluateAll((els) => els.map((e) => e.tagName).join())) === "H2,P,SMALL"));
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Redo" }).click();
  check("and redo brings them back", await settle(async () => (await stage.locator("div.rounded-lg > span > small").count()) === 1 && (await stage.locator("div.rounded-lg > h3").count()) === 1));

  // ── Pull request ─────────────────────────────────────────────────────────
  await page.locator('main button[aria-label="Sync"]').click();
  await page.getByLabel("Changes to src/components/Banner.tsx", { exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/struct-pr.png` });
  await syncNow(page, 1);
  const pr = prs[prs.length - 1];
  const banner = repos["acme/ds"][pr.head].get("src/components/Banner.tsx");
  check("the file imports Badge in the file's own way, from where it is", banner.startsWith('import { Badge } from "./Badge";\n'), banner.slice(0, 120));
  check("and uses everything that was added", banner.includes("<h3") && banner.includes("<Badge>") && banner.includes("<small") && banner.includes("flex-col") === true);
  check("only Banner changed", [...repos["acme/ds"][pr.head]].filter(([p, t]) => t !== repos["acme/ds"].main.get(p)).map(([p]) => p).join() === "src/components/Banner.tsx");
  check("the description lists the structure changes", pr.body.includes("added <h2>") && pr.body.includes("wrapped in <Badge>") && pr.body.includes("now <h3>"), pr.body.slice(0, 500));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
