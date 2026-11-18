const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady } = require("./support/git-panel");
const { tokensLinked } = require("./support/git-panel");
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

  await seed(page, "tquick01");
  await page.goto("http://localhost:3000/editor/tquick01");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());
  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };

  // ── The repository's tokens, linked to a set ──────────────────────────────
  await componentsReady(page);
  await tokensLinked(page);

  const css = async (selector, prop) => { await page.mouse.move(720, 12); return stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop); };
  const field = (label) => aside.getByLabel(label, { exact: true });
  const valueOf = (label) => field(label).getAttribute("data-value");
  const hint = (id) => aside.locator(`[data-raw="${id}"]`);
  const saveButton = (label) => aside.getByRole("button", { name: `Save ${label} as a token` });
  const form = (label) => page.getByRole("dialog", { name: `Save ${label} as a token` }).or(page.locator(`[aria-label="Save ${label} as a token"][role="dialog"]`));
  const classes = () => stage.locator("#root div.flex").first().getAttribute("class");

  await rowFor("Chip").click();
  await stage.locator("#root span").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await stage.locator("#root div.flex").click({ position: { x: 4, y: 4 } });
  await aside.getByText("<div>").waitFor({ timeout: 10000 });

  // ── A color ───────────────────────────────────────────────────────────────
  check("a color written out is offered to be saved as a token", await saveButton("Background").isEnabled());
  check("so is a radius that is only close to one", (await hint("radius").innerText()).includes("Closest: md") && (await saveButton("Radius").isEnabled()));
  const spacing = saveButton("Padding");
  check("spacing is offered too, though the repository has no @theme of spacing (one is made when it is sent)", await spacing.isEnabled(), await spacing.getAttribute("title"));
  await saveButton("Background").click();
  const input = page.getByLabel("Name of the new color token");
  await input.waitFor();
  check("the name is suggested, and selected to be typed over", (await input.inputValue()) === "custom");
  await input.fill("primary");
  check("a name that is taken is refused", (await page.getByText("A token has that name").isVisible()) && (await page.getByRole("button", { name: "Save and use" }).isDisabled()));
  await input.fill("brand");
  await page.screenshot({ path: `${OUT}/tokens-save-as.png` });
  await page.getByRole("button", { name: "Save and use" }).click();
  check("the element then uses the token", await settle(async () => (await valueOf("Background")) === "brand"));
  check("the real component has a class for it, and it is the color it was", await settle(async () => ((await classes()) ?? "").includes("bg-brand") && (await css("#root div.flex", "backgroundColor")) === "rgb(29, 78, 216)"), `${await classes()} ${await css("#root div.flex", "backgroundColor")}`);
  check("it is marked as a token, and the same color elsewhere is offered it", await settle(async () => (await hint("text-color").innerText()).includes("Use brand")) && (await saveButton("Text color").count()) === 0);

  // ── A radius ──────────────────────────────────────────────────────────────
  await saveButton("Radius").click();
  const radiusName = page.getByLabel("Name of the new radius token");
  await radiusName.waitFor();
  check("a radius carries the prefix a class needs", (await page.locator("span.font-mono", { hasText: "radius-" }).count()) >= 1);
  await radiusName.fill("card");
  await page.getByRole("button", { name: "Save and use" }).click();
  check("and is used by its class", await settle(async () => (await field("Radius").inputValue()) === "card" && ((await classes()) ?? "").includes("rounded-card")));
  check("which the preview draws", await settle(async () => (await css("#root div.flex", "borderRadius")) === "10px"), await css("#root div.flex", "borderRadius"));

  // ── A spacing, where the repository has no @theme of spacing ──────────────
  await spacing.click();
  const spacingName = page.getByLabel("Name of the new spacing token");
  await spacingName.waitFor();
  await spacingName.fill("gutter");
  await page.getByRole("button", { name: "Save and use" }).click();
  check("a spacing is used by its class, and the preview draws it at once", await settle(async () => ((await classes()) ?? "").includes("p-gutter") && (await css("#root div.flex", "paddingTop")) === "13.5px"), `${await classes()} ${await css("#root div.flex", "paddingTop")}`);

  // ── In the Tokens screen, to be sent with the next sync ───────────────────
  await nav("Tokens");
  await page.locator("div.w-\\[220px\\]").getByText("acme/ds", { exact: true }).click();
  check("the color is a token of the set, Motif's own until synced", (await page.locator('button[aria-label^="brand:"]').count()) === 1);
  check("and so is the radius, named for its class", await settle(async () => (await page.getByText("radius-card", { exact: true }).count()) >= 1));
  await page.screenshot({ path: `${OUT}/tokens-saved.png` });

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
