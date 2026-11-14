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
repos["acme/plain"] = { main: new Map(Object.entries({ "package.json": "{}", "README.md": "# hi" })) };

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
  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const stored = async () => { await page.waitForTimeout(700); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects") || "{}").state?.projects ?? []); };

  // Whatever earlier versions left in the browser is cleared.
  await page.goto("http://localhost:3000/");
  await page.evaluate(() => {
    localStorage.setItem("motif-files", JSON.stringify({ state: { files: [{ id: "old", name: "Old file" }], folders: [] }, version: 2 }));
    localStorage.setItem("motif-git", JSON.stringify({ state: { connection: { owner: "x", repo: "y", token: "secret" } }, version: 0 }));
    localStorage.setItem("motif-theme", JSON.stringify({ state: { mode: "light" }, version: 0 }));
  });
  await page.goto("http://localhost:3000/");
  await page.getByText("Connect your design system").waitFor();
  check("the first screen asks for a repository, not a file", await page.getByRole("button", { name: "Connect a repository" }).isVisible() && (await page.getByText("New file").count()) === 0);
  check("files, connections and tokens from earlier versions are gone", await page.evaluate(() => ["motif-files", "motif-git", "motif-library", "motif-design-system"].every((k) => localStorage.getItem(k) === null)));
  await page.screenshot({ path: `${OUT}/projects-empty.png` });

  // ── Create ───────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Connect a repository" }).click();
  await page.getByLabel("Repository").fill("not a repo");
  await page.getByRole("button", { name: "Create project" }).click();
  check("a malformed repository is refused in the dialog", await page.getByRole("alert").filter({ hasText: "owner/name" }).isVisible());
  await page.getByLabel("Repository").fill("acme/missing");
  await page.getByRole("button", { name: "Create project" }).click();
  check("a repository that can't be reached is refused with the reason", await settle(async () => /not found|Not Found|couldn't|cannot|404/i.test(await page.getByRole("alert").innerText())), await page.getByRole("alert").innerText().catch(() => ""));
  check("and no project is made", (await stored()).length === 0);
  await page.getByLabel("Repository").fill("https://github.com/acme/ds.git");
  await page.getByLabel("Access token").fill("t");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/editor\/[A-Za-z0-9_-]+$/);
  await page.getByText("Layers", { exact: true }).waitFor();
  const first = (await stored())[0];
  check("a project is made for the repository and opened", first?.name === "ds" && first.repo.connection.owner === "acme" && first.repo.connection.repo === "ds" && first.repo.connection.token === "t");
  // ── Work in it, come back ────────────────────────────────────────────────
  await page.locator("aside button[title*='src/']").first().waitFor({ timeout: 60000 });
  check("the repository is read by itself: its components are there without pressing anything", (await page.locator("aside button[title*='src/']").count()) > 0);
  await page.locator('nav button[title="Tokens"]').click();
  await page.getByText(/^(Colors|Colours)/).first().waitFor().catch(() => {});
  check("a new project has no sample tokens", (await page.evaluate(() => document.body.innerText.includes("primary-500"))) === false);
  await page.locator('nav button[title="Tokens"]').click().catch(() => {});
  await page.waitForTimeout(900);
  const saved = (await stored())[0];
  check("what was imported is saved with the project", saved.library.components.length === 23 && saved.repo.analysis?.repo === "acme/ds");

  await page.goto("http://localhost:3000/");
  await page.getByText("Design systems").waitFor();
  const card = page.locator(`[data-project="${first.id}"]`);
  check("the project is on the dashboard with its repository and what it holds", (await card.innerText()).includes("acme/ds") && (await card.innerText()).includes("23 components"));
  await page.screenshot({ path: `${OUT}/projects-list.png` });
  await card.click();
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator("aside button[title*='src/']").first().waitFor();
  check("reopening it shows the components without scanning again", (await page.locator("aside button[title*='src/']").count()) === 23 && (await page.getByLabel(/Scan and import components/).count()) === 0);

  // ── Reload keeps it ──────────────────────────────────────────────────────
  await page.reload();
  await page.locator("aside button[title*='src/']").first().waitFor({ timeout: 15000 });
  check("a reload of the editor keeps the project loaded", (await page.locator("aside button[title*='src/']").count()) === 23);

  // ── A second project is separate ─────────────────────────────────────────
  await page.goto("http://localhost:3000/");
  await page.getByRole("button", { name: "New project" }).click();
  check("a token already entered can be reused", await page.getByRole("button", { name: "acme/ds" }).isVisible());
  await page.getByRole("button", { name: "acme/ds" }).click();
  await page.getByLabel("Repository").fill("acme/plain");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/editor\//);
  await page.getByText("Layers", { exact: true }).waitFor();
  check("it starts empty, whatever the first one holds", (await page.locator("aside button[title*='src/']").count()) === 0 && await page.getByText("No components yet").first().waitFor({ timeout: 20000 }).then(() => true, () => false), (await page.locator("body").innerText()).slice(0, 300));
  await page.waitForTimeout(900);
  const both = await stored();
  check("both are kept, each with its own repository and library", both.length === 2 && both.find((p) => p.repo.connection.repo === "ds").library.components.length === 23 && both.find((p) => p.repo.connection.repo === "plain").library.components.length === 0);

  // ── Rename and delete ────────────────────────────────────────────────────
  await page.goto("http://localhost:3000/");
  await page.getByText("Design systems").waitFor();
  const plain = page.locator(`[data-project="${both.find((p) => p.repo.connection.repo === "plain").id}"]`);
  await plain.hover();
  await plain.getByLabel("Project actions").click();
  await plain.getByRole("button", { name: "Rename" }).click();
  await plain.getByLabel("Project name").fill("Plain DS");
  await plain.getByLabel("Project name").press("Enter");
  check("a project can be renamed", await settle(async () => (await stored()).some((p) => p.name === "Plain DS")));
  await plain.hover();
  await plain.getByLabel("Project actions").click();
  await plain.getByRole("button", { name: "Delete" }).click();
  check("deleting asks first and says the repository is not touched", await plain.getByText(/repository is not touched/).isVisible());
  await plain.getByRole("button", { name: "Delete" }).click();
  check("and removes only that project", await settle(async () => (await stored()).length === 1) && (await stored())[0].repo.connection.repo === "ds");

  // ── Opening one that doesn't exist ───────────────────────────────────────
  await page.goto("http://localhost:3000/editor/nope");
  check("opening a project that doesn't exist goes back to the dashboard", await page.waitForURL("http://localhost:3000/", { timeout: 10000 }).then(() => true, () => false));

  const real = errors.filter((e) => !/hydrat|404/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); process.exit(1); });
