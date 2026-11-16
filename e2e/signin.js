const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { serve } = require("./support/fake-cdn");
const { gitData } = require("./support/git-data");
const { syncNow } = require("./support/sync-helpers");
const { openDetails } = require("./support/git-panel");

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
const usedTokens = [];
repos["acme/plain"] = { main: new Map(Object.entries({ "package.json": "{}", "README.md": "# hi" })) };

async function github(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "x-ratelimit-remaining" };
  const json = (status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

  const bearer = (req.headers()["authorization"] ?? "").replace("Bearer ", "");
  if (url.pathname.startsWith("/user")) {
    if (bearer) usedTokens.push(bearer);
    if (bearer && !oauth.tokens.has(bearer)) return json(401, { message: "Bad credentials" });
    if (url.pathname === "/user") return bearer ? json(200, { login: "ada", avatar_url: "https://avatars.test/ada.png" }) : json(401, { message: "Requires authentication" });
    if (url.pathname === "/user/installations") return bearer ? json(200, { total_count: 1, installations: [{ id: 11, account: { login: "acme" }, repository_selection: "selected" }] }) : json(401, { message: "Requires authentication" });
    if (url.pathname === "/user/installations/11/repositories") return bearer ? json(200, { total_count: 2, repositories: [{ name: "plain", private: false, owner: { login: "acme" } }, { name: "ds", private: true, owner: { login: "acme" } }] }) : json(401, { message: "Requires authentication" });
    return json(404, { message: "Not Found" });
  }
  const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const branches = m && repos[m[1]];
  if (!branches) return json(404, { message: "Not Found" });
  const rest = decodeURIComponent(m[2] ?? "");
  const method = req.method();
  const token = (req.headers()["authorization"] ?? "").replace("Bearer ", "");
  if (token) usedTokens.push(token);
  if (token && !oauth.tokens.has(token)) return json(401, { message: "Bad credentials" });
  // acme/ds is private: it can only be seen with a token.
  if (m[1] === "acme/ds" && !token) return json(404, { message: "Not Found" });
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
    const pr = { number: prs.length + 1, repo: m[1], ...body, state: "open", merged: false, token };
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


// ── A fake GitHub for the OAuth parts: approving the app, exchanging a code, refreshing, revoking ────────────
const http = require("http");
const { spawn } = require("child_process");
const OAUTH_PORT = 3199;
const { APP_PORT_OWN: APP_PORT } = require("./support/env");
const APP = `http://localhost:${APP_PORT}`;
const oauth = { mode: "approve", expiresIn: 28800, n: 0, tokens: new Set(), refresh: new Map(), codes: new Set(), exchanges: [], refreshes: [], revoked: [], authorizations: [] };
const issue = () => {
  const n = ++oauth.n;
  oauth.tokens.add(`ghu_${n}`);
  oauth.refresh.set(`ghr_${n}`, `ghu_${n}`);
  return { access_token: `ghu_${n}`, expires_in: oauth.expiresIn, refresh_token: `ghr_${n}`, refresh_token_expires_in: 15897600, token_type: "bearer", scope: "" };
};
const oauthServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
  const send = (status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(body === null ? undefined : JSON.stringify(body)); };
  if (url.pathname === "/login/oauth/authorize") {
    oauth.authorizations.push(Object.fromEntries(url.searchParams));
    const redirect = url.searchParams.get("redirect_uri");
    const st = url.searchParams.get("state");
    const code = `code${oauth.authorizations.length}`;
    oauth.codes.add(code);
    const to = oauth.mode === "deny" ? `${redirect}?error=access_denied&state=${st}` : oauth.mode === "tamper" ? `${redirect}?code=${code}&state=${st}x` : `${redirect}?code=${code}&state=${st}`;
    res.writeHead(302, { location: to });
    return res.end();
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = body ? JSON.parse(body) : {};
    if (url.pathname === "/login/oauth/access_token") {
      if (json.client_id !== "testid" || json.client_secret !== "testsecret") return send(200, { error: "incorrect_client_credentials" });
      if (json.grant_type === "refresh_token") {
        oauth.refreshes.push(json.refresh_token);
        if (!oauth.refresh.has(json.refresh_token)) return send(200, { error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired." });
        oauth.refresh.delete(json.refresh_token);
        return send(200, issue());
      }
      oauth.exchanges.push(json);
      if (!oauth.codes.has(json.code)) return send(200, { error: "bad_verification_code" });
      oauth.codes.delete(json.code);
      return send(200, issue());
    }
    if (url.pathname === "/applications/testid/token" && req.method === "DELETE") {
      const ok = req.headers.authorization === `Basic ${Buffer.from("testid:testsecret").toString("base64")}`;
      if (!ok) return send(401, { message: "Bad credentials" });
      oauth.revoked.push(json.access_token);
      oauth.tokens.delete(json.access_token);
      return send(204, null);
    }
    send(404, { message: "Not Found" });
  });
});

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

async function startApp() {
  const child = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], {
    cwd: require("./support/env").ROOT,
    env: {
      ...process.env,
      GITHUB_APP_CLIENT_ID: "testid",
      GITHUB_APP_CLIENT_SECRET: "testsecret",
      GITHUB_APP_SLUG: "motif-test",
      APP_URL: APP,
      GITHUB_OAUTH_URL: `http://localhost:${OAUTH_PORT}`,
      GITHUB_API_URL: `http://localhost:${OAUTH_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 300 && !/Ready in/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  if (!/Ready in/.test(log)) throw new Error("the app did not start: " + log.slice(-500));
  return child;
}

let app = null;
const stopApp = () => { try { if (app) process.kill(-app.pid, "SIGTERM"); } catch { /* already gone */ } };

(async () => {
  await new Promise((r) => oauthServer.listen(OAUTH_PORT, r));
  app = await startApp();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });
  await context.route("https://api.github.com/**", github);
  await context.route("https://avatars.test/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>" }));
  await context.route(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//, async (route) => {
    const out = await serve(route.request().url());
    if (!out) return route.abort();
    route.fulfill({ status: out.status, contentType: out.type, headers: { "access-control-allow-origin": "*" }, body: out.body });
  });
  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  const cookies = async () => (await context.cookies()).filter((c) => c.name.startsWith("motif_gh"));
  const projects = async () => { await page.waitForTimeout(700); return page.evaluate(() => JSON.parse(localStorage.getItem("motif-projects") || "{}").state?.projects ?? []); };
  const nav = async (title) => { await page.locator(`nav button[title="${title}"]`).click(); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(250); };

  // ── Signed out ────────────────────────────────────────────────────────────
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: "Connect a repository" }).waitFor({ timeout: 90000 });
  check("with the app set up, the dashboard offers to sign in", await page.getByRole("button", { name: "Sign in with GitHub" }).first().waitFor({ timeout: 20000 }).then(() => true, () => false));
  await page.getByRole("button", { name: "Connect a repository" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign in with GitHub" }).waitFor({ timeout: 20000 });
  check("and so does the new project dialog, with the token form behind a link", await page.getByRole("dialog").getByRole("button", { name: "Sign in with GitHub" }).isVisible() && (await page.getByLabel("Access token").count()) === 0 && await page.getByText("Use an access token, or a public repository, instead").isVisible());
  await page.screenshot({ path: `${OUT}/signin-dialog.png` });
  await page.getByText("Use an access token, or a public repository, instead").click();
  check("the token form is still there for anyone who wants it", await page.getByLabel("Access token").isVisible());
  await page.keyboard.press("Escape");

  // ── Sign in ───────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Sign in with GitHub" }).first().click();
  await page.waitForURL(`${APP}/`, { timeout: 60000 });
  await page.getByRole("button", { name: "GitHub account" }).waitFor({ timeout: 20000 });
  check("signing in goes to GitHub and comes back signed in, as the person", await settle(async () => (await page.getByRole("button", { name: "GitHub account" }).innerText()).includes("ada")));
  check("GitHub was sent this app's id, where to come back to, and a state", oauth.authorizations.length === 1 && oauth.authorizations[0].client_id === "testid" && oauth.authorizations[0].redirect_uri === `${APP}/api/github/callback` && oauth.authorizations[0].state.length > 20, JSON.stringify(oauth.authorizations[0]));
  check("the code was exchanged on the server with the app's secret", oauth.exchanges.length === 1 && oauth.exchanges[0].client_secret === "testsecret" && oauth.exchanges[0].redirect_uri === `${APP}/api/github/callback`);
  check("the address has no code, state or token", !page.url().includes("code") && !page.url().includes("ghu_") && page.url() === `${APP}/`, page.url());
  const jar = await cookies();
  const session = jar.find((c) => c.name === "motif_gh");
  check("the sign-in is a cookie the page's scripts can't read, kept for months", !!session && session.httpOnly && session.sameSite === "Lax" && session.path === "/api/github" && session.expires > Date.now() / 1000 + 100 * 86400, JSON.stringify(session && { ...session, value: "…" }));
  check("the state cookie is gone", !jar.some((c) => c.name === "motif_gh_state"));
  check("neither the page nor its storage has the token", !(await page.evaluate(() => document.cookie + JSON.stringify({ ...localStorage }))).includes("ghu_"));
  await page.screenshot({ path: `${OUT}/signin-dashboard.png` });

  // ── Pick a repository ─────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Connect a repository" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[data-picker]").waitFor();
  await dialog.locator("[data-repo]").first().waitFor({ timeout: 15000 });
  check("the dialog lists the repositories the app is installed on", (await dialog.locator("[data-repo]").evaluateAll((els) => els.map((e) => e.getAttribute("data-repo")))).join() === "acme/ds,acme/plain");
  check("private ones are marked, and who is signed in is shown", (await dialog.locator('[data-repo="acme/ds"] [aria-label="Private"]').count()) === 1 && (await dialog.locator("[data-signed-in]").innerText()).includes("ada"));
  check("there is a link to install the app on more", (await dialog.getByRole("link", { name: /Install the app on more repositories/ }).getAttribute("href")) === `http://localhost:${OAUTH_PORT}/apps/motif-test/installations/new`);
  await page.screenshot({ path: `${OUT}/signin-picker.png` });
  await dialog.locator('[data-repo="acme/ds"]').click();
  await page.waitForURL(/\/editor\//, { timeout: 30000 });
  await page.getByText("Layers", { exact: true }).waitFor();
  const made = (await projects())[0];
  check("a project is made without any token typed in or stored", made.repo.connection.owner === "acme" && made.repo.connection.repo === "ds" && made.repo.connection.token === "" && !JSON.stringify(await projects()).includes("ghu_"));
  check("the private repository was reached with the account's token", usedTokens.includes("ghu_1"));

  // ── Use it: scan and open a pull request ──────────────────────────────────
  check("the Git panel says who it is signed in as, instead of asking for a token", await (async () => { await nav("Source control"); return page.locator("[data-signed-in]").filter({ hasText: "Signed in with GitHub as ada" }).waitFor({ timeout: 20000 }).then(() => true, () => false); })());
  check("no token is asked for", (await page.getByLabel("Access token").count()) === 0);
  await openDetails(page);
  await page.getByText(/tokens · \d+ components/).waitFor({ timeout: 60000 });
  check("the private repository is scanned with it", true);
  await nav("Source control");
  await nav("Components");
  const stage = page.frameLocator('iframe[title="Component preview"]');
  await page.locator("aside button[title*='src/']").filter({ hasText: /^Banner$/ }).click();
  await stage.locator("#root h2").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await stage.locator("#root h2").click();
  const aside = page.locator("aside").last();
  await aside.getByLabel("Text size", { exact: true }).selectOption("2xl");
  await page.locator('main button[aria-label="Sync"]').click();
  check("syncing is allowed without a typed token", !(await page.getByRole("button", { name: "Push" }).isDisabled()) && (await page.getByText(/needs you to sign in/).count()) === 0);
  await syncNow(page, 1);
  check("and it is opened with the account's token", prs.length === 1 && prs[0].token === "ghu_1");

  // ── Reload: still signed in ───────────────────────────────────────────────
  await page.reload();
  await page.getByText("Layers", { exact: true }).waitFor();
  await nav("Source control");
  check("a reload is still signed in, from the cookie", await page.locator("[data-signed-in]").filter({ hasText: "Signed in with GitHub as ada" }).isVisible());
  await nav("Source control");

  // ── GitHub stops accepting the token ──────────────────────────────────────
  const refreshesBefore = oauth.refreshes.length;
  oauth.tokens.delete("ghu_1");
  await nav("Source control");
  await openDetails(page);
  await page.getByRole("button", { name: /^(Re)?scan$/i }).click();
  await page.getByText(/tokens · \d+ components/).waitFor({ timeout: 60000 });
  await settle(async () => oauth.refreshes.length === refreshesBefore + 1);
  check("a token GitHub refuses is renewed once and the request made again", oauth.refreshes.length === refreshesBefore + 1 && oauth.refreshes.at(-1) === "ghr_1" && usedTokens.includes("ghu_2"), JSON.stringify({ refreshes: oauth.refreshes, used: [...new Set(usedTokens)] }));
  check("the refresh token was rotated, and the cookie has the new ones", !oauth.refresh.has("ghr_1") && oauth.refresh.has("ghr_2"));
  const renewed = (await cookies()).find((c) => c.name === "motif_gh");
  check("the cookie changed", renewed && session && renewed.value !== session.value);
  check("nobody was told anything went wrong", (await page.getByRole("alert").filter({ hasText: /\S/ }).count()) === 0);

  // ── Two tabs renew together ───────────────────────────────────────────────
  const second = await context.newPage();
  await second.goto(`${APP}/`);
  await second.getByRole("button", { name: "GitHub account" }).waitFor({ timeout: 30000 });
  oauth.tokens.delete("ghu_2");
  const before2 = oauth.refreshes.length;
  const asks = await Promise.all([page, second].map((p) => p.evaluate(async () => (await fetch("/api/github/session?force=1", { headers: { "x-requested-with": "motif" } })).json())));
  check("two pages that renew at the same time get the same new token, and GitHub is asked once", asks[0].accessToken === asks[1].accessToken && asks[0].signedIn && oauth.refreshes.length === before2 + 1, JSON.stringify({ asks: asks.map((a) => a.accessToken), n: oauth.refreshes.length - before2 }));
  await second.close();

  // ── The sign-in ends ──────────────────────────────────────────────────────
  oauth.refresh.clear();
  for (const t of [...oauth.tokens]) oauth.tokens.delete(t);
  await openDetails(page);
  await page.getByRole("button", { name: /^(Re)?scan$/i }).click();
  await page.getByRole("alert").filter({ hasText: /sign-in has expired/ }).waitFor({ timeout: 30000 });
  check("when GitHub refuses the refresh token the person is told the sign-in has ended", await page.getByRole("button", { name: "Sign in again" }).isVisible());
  check("and the cookie is gone", (await cookies()).length === 0);
  await page.screenshot({ path: `${OUT}/signin-expired.png` });

  // ── Cancel, tamper, sign in again, sign out ───────────────────────────────
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: "Sign in with GitHub" }).first().waitFor();
  oauth.mode = "deny";
  await page.getByRole("button", { name: "Sign in with GitHub" }).first().click();
  await page.getByRole("alert").filter({ hasText: "GitHub sign-in was cancelled." }).waitFor({ timeout: 30000 });
  check("cancelling at GitHub comes back with a message, and nobody signed in", (await settle(async () => (await cookies()).length === 0, 5000)) && await page.getByRole("button", { name: "Sign in with GitHub" }).first().isVisible() && !page.url().includes("github_error"), page.url());
  await page.reload();
  check("the message is shown once", (await page.getByRole("alert").filter({ hasText: /\S/ }).count()) === 0);

  oauth.mode = "tamper";
  await page.getByRole("button", { name: "Sign in with GitHub" }).first().click();
  await page.getByRole("alert").filter({ hasText: /wasn't started from this browser/ }).waitFor({ timeout: 30000 });
  check("a state that isn't the one that was started with is refused, and nothing is exchanged", (await cookies()).length === 0 && oauth.exchanges.length === 1);

  oauth.mode = "approve";
  await page.reload();
  await page.getByRole("button", { name: "Sign in with GitHub" }).first().click();
  await page.getByRole("button", { name: "GitHub account" }).waitFor({ timeout: 30000 });
  check("signing in again works", (await cookies()).some((c) => c.name === "motif_gh"));
  const token = [...oauth.tokens].at(-1);
  await page.getByRole("button", { name: "GitHub account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in with GitHub" }).first().waitFor();
  check("signing out clears the cookie and revokes the token at GitHub", (await cookies()).length === 0 && oauth.revoked.includes(token), JSON.stringify(oauth.revoked));
  await page.reload();
  check("and stays signed out", await page.getByRole("button", { name: "Sign in with GitHub" }).first().waitFor({ timeout: 20000 }).then(() => true, () => false));

  // ── A page with no sign-in still works for public repositories ────────────
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByText("Use an access token, or a public repository, instead").click();
  await page.getByLabel("Repository").fill("acme/plain");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/editor\//, { timeout: 30000 });
  check("a public repository can still be added by name, with no sign-in and no token", (await projects()).some((p) => p.repo.connection.repo === "plain" && p.repo.connection.token === ""));

  const real = errors.filter((e) => !/hydrat/i.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  stopApp();
  oauthServer.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 2500)); stopApp(); process.exit(1); });
