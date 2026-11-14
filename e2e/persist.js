const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { seed } = require("./support/seed");
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

  await seed(page, "persist01");
  await page.goto("http://localhost:3000/editor/persist01");
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
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  const field = (label) => aside.getByLabel(label, { exact: true });
  const setColor = async (label, value) => { await field(label).click(); const box = page.getByLabel(`${label}: search tokens or type a value`); await box.fill(value); await box.press("Enter"); };

  const settle = async (fn, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const gap = () => css("#root button", "gap");
  const prButton = page.locator('main button[aria-label="Sync"]');
  const backToLibrary = async () => {
    await page.getByText("Layers", { exact: true }).waitFor();
    await page.waitForTimeout(600);
    if (!(await rowFor("Button").isVisible())) await nav("Components");
  };

  // ── Edit, then reload ────────────────────────────────────────────────────
  await rowFor("Button").click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  await editButton.click();
  await stage.locator("#root button").click();
  await aside.getByText("<button>").waitFor({ timeout: 10000 });
  await field("Gap").selectOption("4");
  check("an edit is made", await settle(async () => (await gap()) === "16px") && (await prButton.innerText()).includes("Sync (1)"));
  await setColor("Background", "danger");
  await page.waitForTimeout(600);

  await page.reload();
  await backToLibrary();
  await rowFor("Button").click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  check("after a reload the edit is still there, in the preview", await settle(async () => (await gap()) === "16px"), await gap());
  check("and the pull request button still counts the file", await prButton.isVisible() && (await prButton.innerText()).includes("Sync (1)"));
  await page.screenshot({ path: `${OUT}/persist-reloaded.png` });

  // ── History comes back too ───────────────────────────────────────────────
  await editButton.click();
  check("undo is available after the reload", await page.getByRole("button", { name: "Undo" }).isEnabled());
  await page.getByRole("button", { name: "Undo" }).click();
  check("and takes back the last change, the background", await settle(async () => !(await css("#root button", "backgroundColor")).startsWith("oklch(0.56")) && (await gap()) === "16px");
  await page.getByRole("button", { name: "Undo" }).click();
  check("and the one before it", await settle(async () => (await gap()) === "8px"));
  await page.getByRole("button", { name: "Redo" }).click();
  await page.getByRole("button", { name: "Redo" }).click();
  check("redo brings them back", await settle(async () => (await gap()) === "16px"));

  // ── Updating from the repository keeps what was edited ───────────────────
  await page.getByRole("button", { name: "Update from repository" }).click();
  await page.getByText("Up to date").waitFor({ timeout: 30000 });
  check("an update from the repository keeps the edits", (await prButton.innerText()).includes("Sync (1)") && await settle(async () => (await gap()) === "16px", 15000));
  check("and says nothing about the file being out of date", (await page.getByText(/has changed in the repository since you edited/).count()) === 0);

  // ── The repository changes the file meanwhile ────────────────────────────
  repos["acme/ds"].main.set("src/components/Button.tsx", repos["acme/ds"].main.get("src/components/Button.tsx") + "// changed in the repository\n");
  await page.reload();
  await backToLibrary();
  await rowFor("Button").click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  await page.getByRole("alert").getByText(/Button\.tsx has changed in the repository since you edited it/).waitFor({ timeout: 30000 });
  check("a file the repository has changed since is flagged", true);
  await page.screenshot({ path: `${OUT}/persist-stale.png` });
  await page.getByLabel("Discard edits to changed files").click();
  check("and its edits can be given up", await settle(async () => (await page.getByText(/changed in the repository since you edited/).count()) === 0 && (await prButton.count()) === 0 && (await gap()) === "8px"));
  await page.reload();
  await backToLibrary();
  await rowFor("Button").click();
  await stage.locator("#root button").waitFor({ timeout: 60000 });
  check("and stay given up after another reload", (await prButton.count()) === 0 && (await gap()) === "8px");

  // ── An edit made before a reload can be sent after it ────────────────────
  await rowFor("Banner").click();
  await stage.locator("h2").waitFor({ timeout: 60000 });
  await editButton.click();
  await stage.locator("h2").click();
  await aside.getByText("<h2>").waitFor();
  await field("Text").fill("Saved across a reload");
  await field("Text").press("Enter");
  await stage.getByRole("heading", { name: "Saved across a reload" }).waitFor({ timeout: 10000 });
  await page.reload();
  await backToLibrary();
  await rowFor("Banner").click();
  await stage.getByRole("heading", { name: "Saved across a reload" }).waitFor({ timeout: 60000 });
  await syncNow(page, 1);
  const pr = prs[prs.length - 1];
  const banner = repos["acme/ds"][pr.head].get("src/components/Banner.tsx");
  check("the pull request made after the reload has the edit", banner.includes("Saved across a reload") && [...repos["acme/ds"][pr.head]].filter(([p, t]) => t !== repos["acme/ds"].main.get(p)).map(([p]) => p).join() === "src/components/Banner.tsx");
  await page.reload();
  await backToLibrary();
  await rowFor("Banner").click();
  await stage.getByRole("heading", { name: "Saved across a reload" }).waitFor({ timeout: 60000 });
  check("once sent the edits stay, as in the pull request, even after a reload", (await prButton.innerText()).includes("Synced"), await prButton.innerText());
  // The pull request is merged: the repository has the edit, and the editor has nothing left to send.
  prs[0].merged = true; prs[0].state = "closed"; repos["acme/ds"].main = new Map(repos["acme/ds"][pr.head]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  check("after the merge the edits are the repository's, and nothing is left", await settle(async () => (await prButton.count()) === 0, 20000));
  await page.reload();
  await backToLibrary();
  await rowFor("Banner").click();
  await stage.getByRole("heading", { name: "Saved across a reload" }).waitFor({ timeout: 60000 });

  const stored = (await readEdits(page)).state;
  check("what is kept stays small and is for this repository and branch only", stored.scope === "acme/ds@main" && Object.keys(stored.bases).length === 0 && stored.history.length === 1, JSON.stringify(stored).slice(0, 200));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
