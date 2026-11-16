const { seed } = require("./support/seed");
const { gitData } = require("./support/git-data");
const { openSourceControl } = require("./support/git-panel");
const { syncNow } = require("./support/sync-helpers");
const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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

// ── Fake GitHub ──────────────────────────────────────────────────────────────
const repos = {
  "acme/ds": { main: new Map(Object.entries(loadDir(FIXTURE))) },
  "acme/bare": {
    main: new Map(Object.entries({
      "package.json": JSON.stringify({ name: "bare", dependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" } }),
      "src/index.css": '@import "tailwindcss";\n\nbody { margin: 0; }\n',
    })),
  },
};
const prs = [];
const log = [];

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
  log.push(`${method} ${m[1]}${rest}`);

  const gd = gitData({ rest, method, req, branches, prs, json });
  if (gd) return gd;
  if (rest === "") return json(200, { default_branch: "main", permissions: { push: Boolean(token) } });
  if (rest === "/branches") return json(200, Object.keys(branches).map((name) => ({ name })));
  if (rest.startsWith("/git/ref/heads/")) {
    const b = rest.slice(15);
    // A branch whose files changed is a new commit: what the app has read for a commit is kept.
    const version = [...(branches[b]?.values() ?? [])].reduce((n, t) => n + t.length, branches[b]?.size ?? 0);
    // (The working branch keeps its plain head: the Git Data fake checks the parent by name.)
    return branches[b] ? json(200, { object: { sha: b.startsWith("motif/") ? `commit:${b}` : `commit:${b}@${version}` } }) : json(404, { message: "Not Found" });
  }
  if (rest.startsWith("/git/trees/")) {
    const b = rest.slice(11).split("?")[0].replace("commit:", "").split("@")[0];
    return branches[b] ? json(200, { truncated: false, tree: [...branches[b].keys()].map((p) => ({ path: p, type: "blob" })) }) : json(404, { message: "Not Found" });
  }
  if (rest === "/git/refs" && method === "POST") {
    const body = req.postDataJSON();
    const from = body.sha.replace("commit:", "").split("@")[0];
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
const mergePr = (n) => {
  const pr = prs[n - 1];
  repos[pr.repo].main = new Map(repos[pr.repo][pr.head]);
  pr.state = "closed";
  pr.merged = true;
};

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
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route("https://api.github.com/**", github);
  await page.route("https://raw.githubusercontent.com/**", github);

  await seed(page, "tok00001");
  await page.goto("http://localhost:3000/editor/tok00001");
  await page.getByText("Layers", { exact: true }).waitFor();

  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };
  const dialog = page.getByRole("dialog");
  // A project is saved shortly after it changes.
  const project = async () => { await page.waitForTimeout(1500); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects")).state.projects[0]); };
  const designSystem = async () => (await project()).tokens;
  const gitState = async () => (await project()).repo;
  const setToken = (token) => page.evaluate((t) => {
    const raw = JSON.parse(localStorage.getItem("motif-projects"));
    raw.state.projects[0].repo.connection.token = t;
    localStorage.setItem("motif-projects", JSON.stringify(raw));
  }, token);
  // Simulates an edit made in Motif by changing what Motif has stored, then reloading.
  const editMotif = async (fn) => {
    await page.evaluate((src) => {
      const raw = JSON.parse(localStorage.getItem("motif-projects"));
      new Function("state", src)(raw.state.projects[0].tokens);
      localStorage.setItem("motif-projects", JSON.stringify(raw));
    }, `(${fn.toString()})(state)`);
    await page.goto("http://localhost:3000/editor/tok00001");
    await page.getByText("Layers", { exact: true }).waitFor();
  };
  const status = () => page.getByRole("status", { name: "Sync status" });
  // The panel (opened when it isn't), with the tokens linked, then Pull.
  const pull = async () => { await openSourceControl(page); await page.getByRole("button", { name: "Pull", exact: true }).click(); };
  const upToDate = () => page.locator("[data-pull-notice]").getByText("Up to date.").waitFor({ timeout: 30000 });
  const lightId = (s, setName) => s.sets.find((x) => x.name === setName).themes.find((t) => t.name === "Light").id;

  // ── Connect ────────────────────────────────────────────────────────────────
  await openSourceControl(page);

  // ── Import: the repository's tokens come in with the first pull, with nothing pressed ──
  await status().getByText(/Nothing to sync/).waitFor({ timeout: 60000 });
  let ds = await designSystem();
  const set = ds.sets.find((s) => s.name === "acme/ds");
  check("a set is created with a Light and a Dark theme", !!set && set.themes.map((t) => t.name).join() === "Light,Dark");
  check("its tokens are imported", ds.colors.filter((c) => c.setId === set.id).length === 17 && ds.radii.filter((r) => r.setId === set.id).length === 4 && ds.shadows.filter((s) => s.setId === set.id).length === 2);
  const primary = ds.colors.find((c) => c.setId === set.id && c.name === "primary");
  check("colors are read into hex per theme, and grouped", /^#[0-9a-f]{6}$/.test(primary.themeValues[lightId(ds, "acme/ds")]) && primary.group === "primary");
  check("a fresh import has nothing to send or receive", (await page.getByLabel("Token changes").count()) === 0 && (await page.locator("[data-behind-note]").count()) === 0);
  await page.screenshot({ path: `${OUT}/tokens-synced.png` });

  // ── Edit in Motif → pull request ──────────────────────────────────────────
  await editMotif((state) => {
    const set = state.sets.find((s) => s.name === "acme/ds");
    const light = set.themes.find((t) => t.name === "Light").id;
    const c = state.colors.find((x) => x.setId === set.id && x.name === "primary");
    c.themeValues[light] = "#ff0000";
    c.value = "#ff0000";
    state.radii.find((r) => r.setId === set.id && r.name === "radius-md").value = 10;
  });
  await openSourceControl(page);
  await status().getByText(/2 token changes waiting to sync/).waitFor({ timeout: 30000 });
  const changes = page.getByLabel("Token changes");
  check("Motif's edits are listed as waiting, with no pull request of their own to open", (await changes.locator("li").filter({ hasText: /^primary/ }).count()) === 1 && (await changes.locator("li").filter({ hasText: /^radius-md/ }).count()) === 1 && (await page.getByRole("button", { name: "Create pull request" }).count()) === 0);
  await page.screenshot({ path: `${OUT}/tokens-changes.png` });
  check("nothing has been sent", !!repos["acme/ds"].main && prs.length === 0);
  await syncNow(page, 1);
  const pr = prs[0];
  check("one branch and one pull request, from the working branch", prs.length === 1 && /^motif\/changes-/.test(pr.head) && pr.base === "main" && pr.title === "Changes from Motif");
  const original = [...repos["acme/ds"].main.get("src/styles/motif.css").split("\n")];
  const edited = repos["acme/ds"][pr.head].get("src/styles/motif.css").split("\n");
  const diff = edited.flatMap((l, i) => (l === original[i] ? [] : [`${original[i].trim()} => ${l.trim()}`]));
  check("the pull request changes only the two values, in the file's own notation", edited.length === original.length && diff.length === 2 && diff[0].startsWith("--primary: oklch(0.52 0.21 270); => --primary: oklch(0.628") && diff[1] === "--radius-md: 0.5rem; => --radius-md: 0.625rem;", diff.join(" | "));
  check("the base branch is untouched", repos["acme/ds"].main.get("src/styles/motif.css").includes("--primary: oklch(0.52 0.21 270);"));
  check("the description lists the changes under the step that made them", pr.body.includes("- Update 2 design tokens from Motif") && pr.body.includes("  - `primary` (light): `#3e55df` → `#ff0000`") && pr.body.includes("  - `radius-md` (light): `8px` → `10px`") && pr.body.includes("- `src/styles/motif.css`"), pr.body.slice(0, 400));
  check("the link remembers what was staged", (await gitState()).tokenLink.staged?.paths?.join() === "src/styles/motif.css");
  check("and nothing is waiting any more", await page.getByRole("status", { name: "Sync status" }).getByText(/In sync with pull request #1/).isVisible());
  await page.screenshot({ path: `${OUT}/tokens-pr.png` });

  // A second edit goes into the same pull request.
  await editMotif((state) => {
    const set = state.sets.find((s) => s.name === "acme/ds");
    state.radii.find((r) => r.setId === set.id && r.name === "radius-sm").value = 5;
  });
  await openSourceControl(page);
  await page.getByRole("status", { name: "Sync status" }).getByText(/1 token change waiting to sync/).waitFor({ timeout: 15000 });
  await syncNow(page, 1);
  const edited2 = repos["acme/ds"][pr.head].get("src/styles/motif.css");
  check("a second token edit goes into the same pull request, on top of the first", prs.length === 1 && edited2.includes("--radius-sm: 0.3125rem;") && edited2.includes("--radius-md: 0.625rem;"), edited2.split("\n").filter((l) => l.includes("radius")).join(" | "));

  // ── The pull request is merged ────────────────────────────────────────────
  mergePr(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText(/was merged/).first().waitFor({ timeout: 30000 });
  await pull();
  await upToDate();
  check("once merged, the two sides agree exactly (no false conflicts), and nothing is staged", (await page.getByRole("dialog").count()) === 0 && (await gitState()).tokenLink.staged === null);

  // ── Edit in the repository → pull ─────────────────────────────────────────
  const main = repos["acme/ds"].main;
  main.set("src/styles/motif.css", main.get("src/styles/motif.css").replace("--radius-lg: 0.75rem;", "--radius-lg: 1rem;").replace("--background: oklch(0.17 0.015 265);", "--background: oklch(0.2 0.015 265);"));
  await pull();
  await page.locator("[data-pull-notice]").getByText(/2 token changes from the repository/).waitFor({ timeout: 30000 });
  ds = await designSystem();
  check("the repository's changes arrive in Motif", ds.radii.find((r) => r.name === "radius-lg" && r.setId === set.id).value === 16 && ds.colors.find((c) => c.name === "background" && c.setId === set.id).themeValues[ds.sets.find((s) => s.id === set.id).themes.find((t) => t.name === "Dark").id] !== undefined);

  // ── The same value changed on both sides ──────────────────────────────────
  main.set("src/styles/motif.css", main.get("src/styles/motif.css").replace("--success: oklch(0.56 0.14 155);", "--success: oklch(0.6 0.2 100);"));
  await editMotif((state) => {
    const set = state.sets.find((s) => s.name === "acme/ds");
    const light = set.themes.find((t) => t.name === "Light").id;
    const c = state.colors.find((x) => x.setId === set.id && x.name === "success");
    c.themeValues[light] = "#00ff00";
    c.value = "#00ff00";
  });
  await pull();
  await dialog.getByText("1 value changed in both places").waitFor({ timeout: 30000 });
  check("a clash shows both values", (await dialog.getByText("success · light").isVisible()) && (await dialog.getByText("#00ff00").first().isVisible()));
  await page.screenshot({ path: `${OUT}/tokens-conflict.png` });
  await dialog.getByRole("button", { name: /Repository/ }).click();
  await dialog.getByRole("button", { name: "Apply my choices" }).click();
  await dialog.waitFor({ state: "hidden" });
  ds = await designSystem();
  const success = ds.colors.find((c) => c.name === "success" && c.setId === set.id);
  check("choosing the repository's value puts it in Motif", success.themeValues[lightId(ds, "acme/ds")] !== "#00ff00");

  // ── Deleting in Motif never deletes from the repository ───────────────────
  await editMotif((state) => {
    const set = state.sets.find((s) => s.name === "acme/ds");
    state.colors = state.colors.filter((c) => !(c.setId === set.id && c.name === "ring"));
  });
  await pull();
  await page.locator("[data-pull-notice]").getByText(/token changes? from the repository/).waitFor({ timeout: 30000 });
  check("it is restored, and the repository still has it", (await designSystem()).colors.some((c) => c.name === "ring" && c.setId === set.id) && repos["acme/ds"].main.get("src/styles/motif.css").includes("--ring:"));

  // ── A token without Pull requests access ──────────────────────────────────
  await project();
  await setToken("ro");
  await editMotif((state) => {
    const set = state.sets.find((s) => s.name === "acme/ds");
    state.radii.find((r) => r.setId === set.id && r.name === "radius-sm").value = 7;
  });
  await page.locator('nav button[title="Source control"]').click();
  await page.getByRole("button", { name: "Push" }).click();
  await page.getByText("The token can't open pull requests. It needs Pull requests: read and write.").first().waitFor({ timeout: 30000 });
  check("a token that can't open pull requests gets a clear message, and no pull request is recorded", (await gitState()).work?.pr === null && prs.length === 1);
  await setToken("t");
  await page.goto("http://localhost:3000/editor/tok00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await page.locator('nav button[title="Source control"]').click();
  await page.getByRole("button", { name: "Push" }).click();
  await page.getByRole("status", { name: "Sync status" }).getByText(/In sync with pull request #2/).waitFor({ timeout: 30000 });
  check("with a token that can, the same changes carry on and open it", prs.length === 2 && repos["acme/ds"][prs[1].head].get("src/styles/motif.css").includes("--radius-sm: 0.4375rem;"));

  // ── Entry from the Tokens view ────────────────────────────────────────────
  await page.goto("http://localhost:3000/editor/tok00001");
  await page.getByText("Layers", { exact: true }).waitFor();
  await nav("Tokens");
  await page.getByRole("button", { name: "Repo sync" }).click();
  await page.locator("[data-token-link]").waitFor({ timeout: 30000 });
  check("the Tokens view opens the Source control panel, with the set linked to the repository", await page.locator("[data-token-link]").getByText(/acme\/ds/).first().isVisible());

  // ── A repository with no tokens ───────────────────────────────────────────
  await seed(page, "tok00002", { repo: "acme/bare", name: "Bare", extra: { tokens: {
    sets: [{ id: "set-global", name: "Global", themes: [{ id: "theme-default", name: "Default" }], activeThemeId: "theme-default" }],
    colors: [["primary", "#6366f1"], ["neutral", "#737373"], ["success", "#22c55e"]].map(([name, v], i) => ({ id: "c" + i, name, value: v, group: "brand", setId: "set-global", themeValues: { "theme-default": v } })),
    typography: [], spacing: [{ id: "sp1", name: "space-4", value: 16, setId: "set-global" }], radii: [{ id: "r1", name: "radius-md", value: 4, setId: "set-global" }], shadows: [], components: [],
  } } });
  await page.goto("http://localhost:3000/editor/tok00002");
  await page.getByText("Layers", { exact: true }).waitFor();
  await nav("Source control");
  const tokensFile = page.locator("[data-tokens-file]");
  await tokensFile.getByText("This repository has no design tokens yet.").waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${OUT}/tokens-export.png` });
  await tokensFile.getByRole("button", { name: "Add to pull request" }).click();
  await page.getByText(/Added \d+ tokens in src\/tokens\.css to your pull request/).waitFor({ timeout: 30000 });
  check("adding tokens to a repository that has none sends nothing yet", prs.length === 2);
  await syncNow(page, 3);
  const exportPr = prs[2];
  const bare = repos["acme/bare"][exportPr.head];
  check("a tokens stylesheet is added and imported from the Tailwind stylesheet", bare.has("src/tokens.css") && bare.get("src/index.css") === '@import "tailwindcss";\n@import "./tokens.css";\n\nbody { margin: 0; }\n');
  if (process.env.SHOW) console.log(bare.get("src/tokens.css").split("\n").slice(0, 80).join("\n"));
  check("it holds variables and the Tailwind wiring", /:root \{\n[\s\S]*--primary: #6366f1;/.test(bare.get("src/tokens.css")) && bare.get("src/tokens.css").includes("@theme inline {\n  --color-primary: var(--primary);") && /@theme \{[\s\S]*--radius-md: 4px;/.test(bare.get("src/tokens.css")));
  check("the pull request explains what it adds", exportPr.title === "Changes from Motif" && /- Add \d+ design tokens from Motif/.test(exportPr.body));
  mergePr(3);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText(/was merged/).first().waitFor({ timeout: 30000 });
  await pull();
  await upToDate();
  check("once merged, the new repository and the set agree", true);

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors besides the existing theme hydration warning", real.length === 0, real.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) console.log(log.slice(-12).join("\n"));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); console.log(log.slice(-12).join("\n")); process.exit(1); });
