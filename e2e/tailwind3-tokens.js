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

  await seed(page, "tw3tok01");
  await page.goto("http://localhost:3000/editor/tw3tok01");
  await page.getByText("Layers", { exact: true }).waitFor();
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const settle = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };

  // ── Reading a Tailwind 3 repository's tokens ──────────────────────────────
  await nav("Source control");
  await tokensLinked(page);

  await nav("Tokens");
  await page.locator("div.w-\\[220px\\]").getByText("acme/ds", { exact: true }).click();
  check("its colors, radii and shadows are read (the colors from channels, the rest from the config)", (await page.locator('[data-token-id][data-token-kind="color"]').count()) === 17 && (await page.locator('[data-token-id][data-token-kind="radius"]').count()) === 4 && (await page.locator('[data-token-id][data-token-kind="shadow"]').count()) === 2);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Select primary", { exact: true }).waitFor();
  const row = (name) => page.locator("[data-token-id]").filter({ has: page.getByLabel(`Select ${name}`, { exact: true }) });
  check("a color kept as channels shows as the color it is, in each theme", (await page.getByLabel("Light value of primary", { exact: true }).inputValue()) === "#0f172a" && (await page.getByLabel("Dark value of primary", { exact: true }).inputValue()) === "#f8fafc");
  check("and a token of the config is not locked", (await row("primary").locator('[aria-label="Read-only"]').count()) === 0);
  check("nor is a radius defined in the config", (await page.locator("[data-token-id]").filter({ hasText: "radius-md" }).locator('[aria-label="Read-only"], [aria-label="Can\'t be edited here"]').count()) === 0);
  await page.screenshot({ path: `${OUT}/tailwind3-tokens.png` });

  // ── Renaming a color that shares its group with its foreground ────────────
  await page.getByLabel("Edit secondary (Light)").click();
  const editor = page.locator("[data-color-editor]");
  await editor.locator("[data-rename-open]").click();
  const rename = page.getByRole("dialog", { name: /Rename secondary in the repository/ });
  await rename.getByLabel("New name").fill("soft");
  await rename.getByRole("button", { name: "Find places" }).click();
  await rename.locator("[data-rename-plan]").waitFor();
  const plan = await rename.locator("[data-rename-plan]").innerText();
  check("the rename finds the config and the stylesheet and the components", plan.includes("tailwind.config.js") && plan.includes("src/styles/globals.css") && plan.includes("src/components/Button.tsx"), plan.slice(0, 300));
  await rename.getByRole("button", { name: "Rename and add to pull request" }).click();
  await rename.waitFor({ state: "hidden" });
  check("Motif's token has the new name", await settle(async () => (await row("soft").count()) === 1 && (await row("secondary").count()) === 0));
  check("and secondary-foreground is left alone", (await row("secondary-foreground").count()) === 1);

  // ── Editing values, and adding a token ────────────────────────────────────
  await page.getByLabel("Light value of primary", { exact: true }).fill("#ff0000");
  await page.getByLabel("Light value of primary", { exact: true }).press("Enter");
  const radiusInput = page.getByLabel("Light value of radius-md", { exact: true });
  await radiusInput.waitFor();
  await radiusInput.fill("10");
  await radiusInput.press("Enter");
  await page.locator('[data-group="primary"]').hover();
  await page.getByRole("button", { name: "Add to primary" }).click();
  const add = page.locator("[data-add-row]");
  await add.getByLabel("New color name").fill("brand");
  await add.getByLabel("New color value").fill("#1d4ed8");
  await add.getByLabel("New color value").press("Enter");
  await add.getByLabel("New color name").press("Escape");
  check("the new color is a token of the set", await settle(async () => (await row("brand").count()) === 1));

  // ── What Sync sends ───────────────────────────────────────────────────────
  await page.locator('nav button[title="Source control"]').click();
  await page.getByRole("status", { name: "Sync status" }).waitFor();
  await page.getByRole("button", { name: "Push" }).click();
  await page.waitForFunction(() => /In sync with pull request #\d+/.test(document.querySelector('[aria-label="Sync status"]')?.textContent ?? ""), null, { timeout: 40000 });
  const pushed = Object.keys(repos["acme/ds"]).filter((b) => b !== "main");
  check("Sync sends one branch", pushed.length === 1, pushed.join());
  const tree = repos["acme/ds"][pushed[0]];
  const css = tree.get("src/styles/globals.css");
  const config = tree.get("tailwind.config.js");
  check("the color that was edited is still channels, in the same variable", /--primary: 0 100% 50%;/.test(css), css.split("\n").filter((l) => /--primary:/.test(l)).join(" | "));
  check("the renamed color is renamed where the repository declares it, in both themes", (css.match(/--soft:/g) ?? []).length === 2 && !/(?<![\w-])--secondary(?![\w-])/.test(css));
  check("and in the config, out of its group, so the foreground keeps its class", /secondary: \{\n\s+foreground: "hsl\(var\(--secondary-foreground\)\)",\n\s+\},\n\s+soft: "hsl\(var\(--soft\)\)",/.test(config), config.split("\n").filter((l) => /soft|secondary/.test(l)).join(" | "));
  check("the classes in the components follow it", /bg-soft/.test(tree.get("src/components/Button.tsx")) && ![...tree.entries()].some(([p, t]) => !p.endsWith(".md") && /(?<![\w-])(bg|text|border|ring)-secondary(?![\w-])/.test(t)));
  check("the radius is changed in the config, in its unit", /md: "0\.625rem",/.test(config), config.split("\n").filter((l) => /\bmd:/.test(l)).join(" | "));
  check("the new color is a variable of channels in each theme and an entry of the config", (css.match(/--brand: 224\.3 76\.3% 48%;/g) ?? []).length === 2 && /brand: "hsl\(var\(--brand\)\)",/.test(config));
  check("nothing else in the config changed", (() => {
    const before = repos["acme/ds"].main.get("tailwind.config.js").split("\n");
    const after = config.split("\n");
    const removed = before.filter((l) => !after.includes(l)).map((l) => l.trim());
    const added = after.filter((l) => !before.includes(l)).map((l) => l.trim());
    return JSON.stringify(removed) === JSON.stringify(['DEFAULT: "hsl(var(--secondary))",', 'md: "0.5rem",']) && JSON.stringify(added) === JSON.stringify(['soft: "hsl(var(--soft))",', 'brand: "hsl(var(--brand))",', 'md: "0.625rem",']);
  })());
  await page.screenshot({ path: `${OUT}/tailwind3-synced.png` });

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
