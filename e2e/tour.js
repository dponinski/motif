const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");

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

  await seed(page, "tour0001");
  // The suites keep the tour away; this one is about it.
  await page.evaluate(() => localStorage.removeItem("motif-tour-done"));
  await page.goto("http://localhost:3000/editor/tour0001");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
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

  const card = page.locator("[data-tour-card]");
  const title = () => card.locator("p").first().innerText();
  const done = () => page.evaluate(() => localStorage.getItem("motif-tour-done"));

  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });

  // ── The first time ───────────────────────────────────────────────────────
  check("the tour opens by itself the first time", await card.waitFor({ timeout: 15000 }).then(() => true, () => false));
  check("at the first of five steps", (await title()) === "Your component, on a canvas" && (await card.innerText()).includes("1 of 5"));
  await page.screenshot({ path: `${OUT}/tour-1.png` });
  const titles = [await title()];
  for (let i = 0; i < 4; i++) { await card.getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(150); titles.push(await title()); }
  check("it walks through the canvas, Add, sizes, layers and the panel", titles.join("|") === "Your component, on a canvas|Add things|Try other sizes|Layers|Style it here", titles.join("|"));
  check("and the last step says Done", await card.getByRole("button", { name: "Done" }).isVisible());
  await page.screenshot({ path: `${OUT}/tour-5.png` });
  await card.getByRole("button", { name: "Back" }).click();
  check("Back goes back", (await title()) === "Layers");
  await card.getByRole("button", { name: "Next" }).click();
  check("it is on the screen, whatever the step", await (async () => { const b = await card.boundingBox(); return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 1440 && b.y + b.height <= 900; })());

  // ── It does not get in the way ───────────────────────────────────────────
  await page.getByRole("button", { name: "Add element", exact: true }).click();
  check("the page still works under it", await page.locator("[data-insert-palette]").waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.getByRole("button", { name: "Add element", exact: true }).click();
  await page.locator("[data-insert-palette]").waitFor({ state: "detached" }).catch(() => {});

  // ── Finishing ────────────────────────────────────────────────────────────
  await card.getByRole("button", { name: "Done" }).click();
  check("Done closes it", await settle(async () => (await card.count()) === 0));
  check("and it is remembered", (await done()) === "1");
  await rowFor("Button").click();
  await stage.locator("button").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  check("it is not shown again", (await card.count()) === 0);

  // ── Asking for it ────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Show the tour", exact: true }).click();
  check("the question mark shows it again", await card.waitFor({ timeout: 5000 }).then(() => true, () => false) && (await title()) === "Your component, on a canvas");
  await page.keyboard.press("Escape");
  check("Esc leaves it", await settle(async () => (await card.count()) === 0));
  await page.getByRole("button", { name: "Show the tour", exact: true }).click();
  await card.waitFor();
  await card.getByRole("button", { name: "Skip the tour" }).click();
  check("so does Skip", await settle(async () => (await card.count()) === 0));

  // ── Not in the other modes ───────────────────────────────────────────────
  await page.evaluate(() => localStorage.removeItem("motif-tour-done"));
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForTimeout(500);
  check("the tour is for Design, not Preview", (await card.count()) === 0 && (await page.getByRole("button", { name: "Show the tour", exact: true }).count()) === 0);

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
