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

  await seed(page, "comp0001");
  await page.goto("http://localhost:3000/editor/comp0001");
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

  const undo = () => page.getByRole("button", { name: "Undo" }).click();
  const at = (w) => page.frameLocator(`iframe[data-frame-width="${w}"]`);
  const frameWidths = () => page.locator("iframe[title='Component preview']").evaluateAll((els) => els.map((e) => e.getAttribute("data-frame-width")).join());
  const compareButton = page.getByRole("button", { name: "Compare sizes", exact: true });
  const h2s = (w) => at(w).locator("h2").count();
  const outlines = (w) => at(w).locator("body > div[aria-hidden] > div").evaluateAll((els) => els.filter((e) => e.style.display !== "none" && /solid/.test(e.style.cssText) && /0\.06/.test(e.style.cssText)).length);

  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });
  check("one preview to begin with", (await page.locator("iframe[title='Component preview']").count()) === 1);
  check("and the bar offers Compare", await compareButton.isVisible() && (await compareButton.getAttribute("aria-pressed")) === "false");

  // ── Several sizes ────────────────────────────────────────────────────────
  await compareButton.click();
  check("Compare shows Phone, Tablet and Desktop side by side", await settle(async () => (await frameWidths()) === "375,768,1280"), await frameWidths());
  check("each is the component, rendered", await settle(async () => (await h2s(375)) === 1 && (await h2s(768)) === 1 && (await h2s(1280)) === 1));
  check("and each is labelled with its size", (await page.locator("[data-frame-label]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join("|").match(/^Banner · Phone 375.*\|Banner · Tablet 768.*\|Banner · Desktop 1280/) !== null);
  check("the width field gives way to the sizes", (await page.getByLabel("Preview width", { exact: true }).count()) === 0);
  await page.screenshot({ path: `${OUT}/compare.png` });

  // ── Pick in one, see it in all ───────────────────────────────────────────
  await at(768).locator("h2").click();
  await aside.getByText("<h2>").waitFor({ timeout: 10000 });
  check("clicking an element in one size picks it", await aside.getByText("<h2>").isVisible());
  check("and it is outlined in every size", await settle(async () => (await outlines(375)) === 1 && (await outlines(768)) === 1 && (await outlines(1280)) === 1));

  // ── One edit shows in all ────────────────────────────────────────────────
  await page.getByRole("button", { name: "Add element", exact: true }).click();
  await page.locator("[data-insert-palette]").waitFor();
  await page.locator('[data-palette-item="Text"]').click();
  check("an edit made in one shows in all sizes", await settle(async () => (await at(375).locator("h2 > span").count()) === 1 && (await at(768).locator("h2 > span").count()) === 1 && (await at(1280).locator("h2 > span").count()) === 1));

  // ── A size added later has the edit too ──────────────────────────────────
  await page.getByRole("button", { name: "Preview width: 768" }).click();
  check("a size can be switched off", await settle(async () => (await frameWidths()) === "375,1280"));
  await undo();
  await settle(async () => (await at(375).locator("h2 > span").count()) === 0);
  await at(375).locator("h2").click();
  await aside.getByText("<h2>").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Add element", exact: true }).click();
  await page.locator("[data-insert-palette]").waitFor();
  await page.locator('[data-palette-item="Text"]').click();
  check("an edit made while a size is away shows in the others", await settle(async () => (await at(375).locator("h2 > span").count()) === 1 && (await at(1280).locator("h2 > span").count()) === 1));
  await page.getByRole("button", { name: "Preview width: 768" }).click();
  check("and back on", await settle(async () => (await frameWidths()) === "375,768,1280"));
  check("it is brought up to date with what was edited while it was away", await settle(async () => (await at(768).locator("h2 > span").count()) === 1));
  await undo();
  check("one undo takes the edit from every size", await settle(async () => (await at(375).locator("h2 > span").count()) === 0 && (await at(768).locator("h2 > span").count()) === 0 && (await at(1280).locator("h2 > span").count()) === 0));

  // ── Back to one ──────────────────────────────────────────────────────────
  await compareButton.click();
  check("Compare off is one preview again, with the width field", await settle(async () => (await page.locator("iframe[title='Component preview']").count()) === 1) && (await page.getByLabel("Preview width", { exact: true }).count()) === 1);
  check("which still renders", await settle(async () => (await stage.locator("h2").count()) === 1));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
