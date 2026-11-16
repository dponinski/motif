const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { tokensLinked } = require("./support/git-panel");
const { gitData } = require("./support/git-data");
const { openSync, syncNow } = require("./support/sync-helpers");

const { OUT } = require("./support/env");
const { FIXTURE_V3 } = require("./support/env");
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

const design = loadDir(FIXTURE_V3);
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
design["src/components/Promo.tsx"] = [
  'export function Promo() {',
  '  return (',
  '    <div className="flex flex-col gap-[18px] rounded-[8px] bg-[oklch(0.52_0.21_270)] p-[16px] text-[15px] shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04),0_1px_3px_0_rgb(0_0_0_/_0.06)]">',
  '      <h3 className="text-lg font-semibold text-white">Promo</h3>',
  '      <p className="text-red-500">Body</p>',
  '    </div>',
  '  );',
  '}',
  '',
].join("\n");
design["src/index.ts"] += '\nexport { Promo } from "./components/Promo";\n';
// An element with values written out where a token could be.
design["src/components/Chip.tsx"] = [
  'export function Chip() {',
  '  return (',
  '    <div className="flex flex-col gap-2 rounded-[10px] bg-[#1d4ed8] p-[13.5px] text-[#1d4ed8]">',
  '      <span>Chip</span>',
  '    </div>',
  '  );',
  '}',
  '',
].join("\n");
design["src/index.ts"] += '\nexport { Chip } from "./components/Chip";\n';
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

  await seed(page, "tw3prev1");
  await page.goto("http://localhost:3000/editor/tw3prev1");
  await page.getByText("Layers", { exact: true }).waitFor();
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const settle = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());
  // The pointer is moved off the preview first: a button under it would show its hover color.
  const style = async (selector, prop) => { await page.mouse.move(720, 12); return stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop); };
  const styled = async (selector, prop, want, ms = 15000) => settle(async () => (await style(selector, prop)) === want, ms);

  await nav("Git");
  await page.getByRole("button", { name: "Scan" }).click();
  await page.getByText(/tokens · \d+ components/).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /(Re-import|Import) components/ }).click();
  await page.getByText(/Imported \d+ components/).waitFor();
  if (await gitOpen()) await nav("Git");
  await nav("Components");

  // ── It renders, styled by the repository's own config and stylesheet ──────
  await rowFor("Button").click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  check("a Tailwind 3 component is shown, not refused", (await page.getByText(/can't be previewed/).count()) === 0);
  check("with the colors of its config, from the variables of its stylesheet", await styled("#root button", "backgroundColor", "rgb(15, 23, 42)"), await style("#root button", "backgroundColor"));
  check("and the radius, spacing and font its classes name", (await style("#root button", "borderRadius")) === "8px" && (await style("#root button", "height")) === "40px" && (await style("#root button", "gap")) === "8px");
  check("and the stylesheet's own base layer", (await stage.locator("body").evaluate(() => getComputedStyle(document.body).fontFamily)).includes("Inter"));
  await page.screenshot({ path: `${OUT}/tailwind3-preview.png` });

  // ── Dark mode follows the `.dark` class its config asks for ───────────────
  await page.getByLabel("Dark theme", { exact: true }).click();
  check("dark mode uses the dark values of the same variables", await styled("#root button", "backgroundColor", "rgb(248, 250, 252)", 8000), await style("#root button", "backgroundColor"));
  await page.getByLabel("Light theme", { exact: true }).click();
  await styled("#root button", "backgroundColor", "rgb(15, 23, 42)", 8000);

  // ── Editing a class redraws it, and the new class is built ────────────────
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await aside.getByText("Click an element in the preview").waitFor({ timeout: 10000 });
  await stage.locator("#root button").click();
  await aside.getByText("<button>").waitFor({ timeout: 10000 });
  const field = (label) => aside.getByLabel(label, { exact: true });
  check("the classes are read like any other repository's", (await field("Gap").inputValue()) === "2" && (await field("Background").getAttribute("data-value")) === "primary");
  await field("Gap").selectOption("4");
  check("changing the gap shows at once, with a class the page hadn't built", await styled("#root button", "gap", "16px"), await style("#root button", "gap"));
  check("and the change is one file in the pull request", (await page.locator('main button[aria-label="Sync"]').innerText()).includes("Sync (1)"));
  await field("Background").click();
  const box = page.getByLabel("Background: search tokens or type a value");
  await box.fill("danger");
  await box.press("Enter");
  check("a color token can be picked", await settle(async () => (await style("#root button", "backgroundColor")) !== "rgb(15, 23, 42)" && (await field("Background").getAttribute("data-value")) === "danger"), await style("#root button", "backgroundColor"));
  await page.screenshot({ path: `${OUT}/tailwind3-edit.png` });

  // ── Motif's tokens show in it before they are synced ──────────────────────
  await nav("Git");
  await tokensLinked(page);
  await nav("Tokens");
  await page.locator("div.w-\\[220px\\]").getByText("acme/ds", { exact: true }).click();
  await page.getByRole("tab", { name: /Colors/ }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Light value of danger", { exact: true }).waitFor();
  await page.getByLabel("Light value of danger", { exact: true }).fill("#00aa00");
  await page.getByLabel("Light value of danger", { exact: true }).press("Enter");
  await page.getByRole("tab", { name: /Radii/ }).click();
  const radiusInput = page.getByLabel("Value of radius-md", { exact: true });
  await radiusInput.waitFor();
  await radiusInput.fill("20");
  await radiusInput.press("Enter");
  await nav("Components");
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  check("a color Motif changed shows, written as the channels the config wraps", await styled("#root button", "backgroundColor", "rgb(0, 170, 0)", 20000), await style("#root button", "backgroundColor"));
  check("and a radius the config itself holds shows too", await styled("#root button", "borderRadius", "20px", 20000), await style("#root button", "borderRadius"));
  await page.getByRole("button", { name: /changed in Motif|Motif tokens|token changes?/i }).first().click().catch(() => {});
  check("both go away with the repository's own values when Motif's are hidden", await styled("#root button", "borderRadius", "8px", 20000), await style("#root button", "borderRadius"));
  await page.screenshot({ path: `${OUT}/tailwind3-tokens-preview.png` });

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
