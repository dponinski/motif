const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
const { componentsReady } = require("./support/git-panel");
const { readEdits } = require("./support/stored-edits");
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

  await seed(page, "props001");
  await page.goto("http://localhost:3000/editor/props001");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const stage = page.frameLocator('iframe[title="Component preview"]');
  const rowFor = (name) => page.locator("aside button[title*='src/']").filter({ hasText: new RegExp(`^${name}$`) });
  const aside = page.locator("aside").last();
  const gitOpen = async () => (await page.getByPlaceholder("owner/name").isVisible()) || (await page.getByText("Components and tokens").isVisible());

  await componentsReady(page);

  // The pointer is moved off the preview first: a button under it would show its hover color.
  const css = async (selector, prop) => { await page.mouse.move(720, 12); return stage.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop); };
  const editButton = page.getByRole("button", { name: "Design", exact: true });
  const field = (label) => aside.getByLabel(label, { exact: true });
  const setColor = async (label, value) => { await field(label).click(); const box = page.getByLabel(`${label}: search tokens or type a value`); await box.fill(value); await box.press("Enter"); };

  const settle = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const group = aside.getByRole("group", { name: "Variant group variant" });
  const badgeCount = () => stage.locator("#root span.rounded-full").count();

  await rowFor("Badge").click();
  await stage.locator("#root span.rounded-full").waitFor({ timeout: 60000 });
  await editButton.click();
  await page.getByRole("tab", { name: "Props", exact: true }).click();

  // ── Options ──────────────────────────────────────────────────────────────
  await group.getByLabel("Rename variant neutral").waitFor();
  check("the variant group is listed with its options and default", (await group.getByLabel(/^Rename variant /).count()) === 6 && (await aside.getByLabel("Default variant").inputValue()) === "neutral");
  await aside.getByLabel("New variant option").fill("ghost");
  await aside.getByLabel("Add variant option").click();
  check("a new option appears in the list straight away", await settle(async () => (await group.getByLabel("Rename variant ghost").count()) === 1));
  await page.getByRole("button", { name: "Variants", exact: true }).click();
  check("and in All variants", await settle(async () => (await badgeCount()) === 7));
  await editButton.click();
  check("and in the props controls", (await aside.getByLabel("variant", { exact: true }).locator("option").allInnerTexts()).includes("ghost"));
  await page.screenshot({ path: `${OUT}/props-option.png` });

  // The new option is edited like any other: choose it, pick the element, change its look.
  await aside.getByLabel("variant", { exact: true }).selectOption("ghost");
  await stage.locator("#root span.rounded-full").first().click();
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await aside.getByText("<span>").waitFor({ timeout: 10000 });
  await setColor("Background", "transparent");
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  check("the new option's classes are the ones the inspector edits", (await aside.getByLabel("Classes: variant: ghost").inputValue()) === "bg-transparent text-foreground", await aside.getByLabel("Classes: variant: ghost").inputValue());
  await page.getByRole("tab", { name: "Props", exact: true }).click();

  // ── Default, rename, remove ──────────────────────────────────────────────
  await aside.getByLabel("Default variant").selectOption("ghost");
  check("the default can be changed", await settle(async () => (await aside.getByLabel("Default variant").inputValue()) === "ghost"));
  await group.getByLabel("Remove variant ghost").click();
  check("an option that is the default can't be removed, and it says why", await aside.getByText(/ghost is the default for variant/).isVisible());
  await aside.getByLabel("Default variant").selectOption("neutral");
  await group.getByLabel("Remove variant outline").click();
  check("another option can be removed", await settle(async () => (await group.getByLabel("Rename variant outline").count()) === 0));
  await group.getByLabel("Rename variant danger").fill("destructive");
  await group.getByLabel("Rename variant danger").press("Enter");
  check("an option can be renamed", await settle(async () => (await group.getByLabel("Rename variant destructive").count()) === 1));

  // ── A new group, wired in ────────────────────────────────────────────────
  await aside.getByLabel("New variant group name").fill("tone");
  await aside.getByLabel("First option of the new group").fill("soft");
  await aside.getByLabel("Add variant group").click();
  check("a new variant group appears with its option", await settle(async () => (await aside.getByRole("group", { name: "Variant group tone" }).getByLabel("Rename tone soft").count()) === 1));
  check("and the component still renders with it", (await badgeCount()) >= 1 && (await stage.locator("#root pre").count()) === 0);
  check("and it is a control of the component", (await aside.getByLabel("tone", { exact: true }).count()) === 1);

  // ── Plain props ──────────────────────────────────────────────────────────
  await aside.getByLabel("New prop name").fill("dot");
  await aside.getByLabel("New prop type").selectOption("boolean");
  await aside.getByLabel("New prop default").fill("false");
  await aside.getByLabel("Add prop").click();
  check("a prop can be added with a default", await settle(async () => (await aside.getByLabel("Default dot").count()) === 1 && (await aside.getByLabel("Default dot").inputValue()) === "false"));
  await aside.getByLabel("Default dot").fill("true");
  await aside.getByLabel("Default dot").press("Enter");
  check("and its default changed", await settle(async () => (await aside.getByLabel("Default dot").inputValue()) === "true"));
  await aside.getByLabel("Remove prop dot").click();
  check("and removed", await settle(async () => (await aside.getByLabel("Default dot").count()) === 0));
  await aside.getByLabel("New prop name").fill("size");
  await aside.getByLabel("New prop name").press("Tab");
  await aside.getByLabel("New prop name").fill("rounded");
  await aside.getByLabel("New prop type").selectOption("boolean");
  await aside.getByLabel("Add prop").click();
  check("a prop that stays", await settle(async () => (await aside.getByLabel("Default rounded").count()) === 1));
  await page.screenshot({ path: `${OUT}/props-editor.png` });

  // ── Pull request ─────────────────────────────────────────────────────────
  await page.locator('main button[aria-label="Sync"]').click();
  await page.getByLabel("Changes to src/components/Badge.tsx", { exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/props-pr.png` });
  await syncNow(page, 1);
  const pr = prs[prs.length - 1];
  const badge = repos["acme/ds"][pr.head].get("src/components/Badge.tsx");
  check("the file has the new option, the new default, the group and the prop", badge.includes('ghost: "bg-transparent text-foreground"') && badge.includes("tone: {") && badge.includes("soft:") && badge.includes("rounded?: boolean;") && /\{ className, variant, tone, rounded/.test(badge), badge.slice(0, 900));
  check("with the removed option gone and the renamed one renamed", !badge.includes("outline:") && badge.includes("destructive:") && !badge.includes("danger:"));
  check("and wired into the cva call", badge.includes("badgeVariants({ variant, tone })"));
  check("only Badge changed", [...repos["acme/ds"][pr.head]].filter(([p, t]) => t !== repos["acme/ds"].main.get(p)).map(([p]) => p).join() === "src/components/Badge.tsx");
  check("the description lists them", pr.body.includes("added option ghost") && pr.body.includes("added variant group tone") && pr.body.includes("added prop rounded"), pr.body.slice(0, 500));
  check("the edits stay in the editor while the pull request is open", (await group.getByLabel("Rename variant ghost").count()) === 1);
  // Merged: the repository has them now, and the editor shows the repository's file.
  prs[0].merged = true; prs[0].state = "closed"; repos["acme/ds"].main = new Map(repos["acme/ds"][pr.head]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // (The panel starts again when the repository is read again: back to the tab the variants are in.)
  check("once merged the editor shows the repository's version, which has them", await settle(async () => { await page.getByRole("tab", { name: "Props", exact: true }).click(); return (await page.locator('main button[aria-label="Sync"]').count()) === 0 && (await group.getByLabel("Rename variant ghost").count()) === 1 && (await group.getByLabel("Rename variant outline").count()) === 0; }, 20000), JSON.stringify({ btn: await page.locator('main button[aria-label="Sync"]').count(), ghost: await group.getByLabel("Rename variant ghost").count(), outline: await group.getByLabel("Rename variant outline").count(), edits: await readEdits(page, 0).then((r) => ({ bases: Object.keys(r.state.bases), h: r.state.history.length })) }));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
