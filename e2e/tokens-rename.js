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

const { withoutConversion } = require("./support/conversion");
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

  await seed(page, "trename1");
  await page.goto("http://localhost:3000/editor/trename1");
  await page.getByText("Layers", { exact: true }).waitFor();
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const settle = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };

  // ── Scan the repository and link its tokens ───────────────────────────────
  await componentsReady(page);
  await tokensLinked(page);

  await nav("Tokens");
  await page.locator("div.w-\\[220px\\]").getByText("acme/ds", { exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Select primary", { exact: true }).waitFor();
  const row = (name) => page.locator("[data-token-id]").filter({ has: page.getByLabel(`Select ${name}`, { exact: true }) });
  const usedBefore = Number((await row("primary").locator("[data-used]").innerText()).match(/\d+/)[0]);

  // ── The dialog ────────────────────────────────────────────────────────────
  await page.getByLabel("Edit primary (Light)").click();
  const editor = page.locator("[data-color-editor]");
  await editor.waitFor();
  check("a token the repository names can be renamed there", await editor.locator("[data-rename-open]").isVisible());
  await editor.locator("[data-rename-open]").click();
  const rename = page.getByRole("dialog", { name: /Rename primary in the repository/ });
  await rename.waitFor();
  const find = rename.getByRole("button", { name: "Find places" });
  check("nothing can be done until there is a new name", await find.isDisabled());
  await rename.getByLabel("New name").fill("surface");
  check("a name that is taken is refused, and says so", (await rename.locator("[data-rename-problem]").innerText()).includes("already has that name") && await find.isDisabled());
  await rename.getByLabel("New name").fill("1brand");
  check("so is one that isn't a name", (await rename.locator("[data-rename-problem]").innerText()).includes("letters") && await find.isDisabled());
  await rename.getByLabel("New name").fill("brand");
  check("a free name can go on", await find.isEnabled());
  await find.click();
  await rename.locator("[data-rename-plan]").waitFor();
  const found = await rename.locator("[data-rename-plan]").innerText();
  const total = Number(found.match(/Found (\d+) place/)?.[1]);
  check("it finds the places the repository uses it, at least as many as it counts as uses", total > usedBefore, `${total} places, ${usedBefore} uses`);
  check("in the stylesheet that declares it and in the components", found.includes("src/styles/motif.css") && found.includes("src/components/Button.tsx"));
  check("and says what it can't see", found.includes("built while the page runs"));
  await page.screenshot({ path: `${OUT}/tokens-rename-dialog.png` });
  await rename.getByRole("button", { name: "Rename and add to pull request" }).click();
  await rename.waitFor({ state: "hidden" });

  // ── In Motif ──────────────────────────────────────────────────────────────
  check("Motif's token has the new name, and the old one is gone", await settle(async () => (await row("brand").count()) === 1 && (await row("primary").count()) === 0));
  check("the token that starts the same is left alone", (await row("primary-foreground").count()) === 1);
  check("it is still counted as used as often", await settle(async () => Number((await row("brand").locator("[data-used]").innerText()).match(/\d+/)[0]) === usedBefore), await row("brand").innerText());
  check("and is not taken for one the repository doesn't have", (await row("brand").locator("[data-unused]").count()) === 0);
  await page.screenshot({ path: `${OUT}/tokens-renamed.png` });

  // ── In the pull request ───────────────────────────────────────────────────
  await page.locator('nav button[title="Source control"]').click();
  await page.getByRole("status", { name: "Sync status" }).waitFor();
  const diff = async (file) => { await page.getByLabel(`Changes to ${file}`, { exact: true }).click(); const text = await page.getByLabel(`Diff of ${file}`, { exact: true }).innerText(); await page.getByLabel(`Changes to ${file}`, { exact: true }).click(); return text; };
  const button = await diff("src/components/Button.tsx");
  check("the changes list has the components and the stylesheet", /bg-brand/.test(button) && !/\+.*bg-primary(?![\w-])/.test(button), button.slice(0, 300));
  await page.screenshot({ path: `${OUT}/tokens-rename-sync.png` });
  check("the rename is among the changes, with no token changes besides it", (await page.getByRole("status", { name: "Sync status" }).innerText()).replace(/\s+/g, " ").includes("files waiting to sync") && (await page.getByText(/TOKEN CHANGES/i).count()) === 0);
  await page.getByRole("button", { name: "Push" }).click();
  await page.waitForFunction(() => /In sync with pull request #\d+/.test(document.querySelector('[aria-label="Sync status"]')?.textContent ?? ""), null, { timeout: 30000 });
  const pushed = Object.keys(repos["acme/ds"]).filter((b) => b !== "main");
  check("Sync sends one branch", pushed.length === 1, pushed.join());
  const tree = repos["acme/ds"][pushed[0]];
  // (The variables are in design tokens files now, and in the stylesheet they build; the repository's own stylesheet keeps the alias Tailwind reads.)
  const css = tree.get("src/styles/tokens.css") + tree.get("src/styles/motif.css");
  const built = tree.get("src/styles/tokens.css");
  check("with the token declared under its new name in every theme", /--brand:/.test(built) && /\.dark \{[^}]*--brand:/.test(built) && !/(?<![\w-])--primary(?![\w-])/.test(css) && /--color-brand: var\(--brand\)/.test(css), css.split("\n").filter((l) => /brand|primary/.test(l)).slice(0, 6).join(" | "));
  check("the components use the class by its new name", /bg-brand/.test(tree.get("src/components/Button.tsx")) && ![...tree.entries()].some(([p, t]) => !p.endsWith(".md") && /(?<![\w-])(bg|text|ring|accent)-primary(?![\w-])/.test(t)));
  check("and every file that changed is one the rename plans", [...tree.entries()].every(([p, t]) => repos["acme/ds"].main.get(p) === t || !withoutConversion([p]).length || /(?<![\w-])(--)?(brand|primary)(?![\w-])|-brand/.test(t)));
  check("the token is not flagged as changed, nor made twice", await (async () => { await nav("Tokens"); await page.locator("div.w-\\[220px\\]").getByText("acme/ds", { exact: true }).click(); return (await row("brand").locator("text=changed").count()) === 0 && (await row("brand").count()) === 1; })());

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
