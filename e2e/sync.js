// Projects saved to the account and kept in step between devices: two browsers, one real server and MariaDB.
const { chromium } = require("playwright");
const net = require("net");
const { spawn, execFileSync } = require("child_process");
const { seedDb: seed } = require("./support/seed");

const { OUT } = require("./support/env");
const { APP_PORT_OWN: APP_PORT } = require("./support/env");
const SMTP_PORT = 2525;
const APP = `http://localhost:${APP_PORT}`;
const DB = "motif_sync_e2e";
const { psql } = require("./support/env");
const sql = (q) => psql(DB, q.split(`${DB}.`).join(""));
const PAT = "ghp_" + "S".repeat(36);

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};
const until = async (fn, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { if (await Promise.resolve(fn()).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

// ── Fake SMTP ───────────────────────────────────────────────────────────────
const mails = [];
const smtp = net.createServer((sock) => {
  let inData = false, buf = "", to = "";
  sock.write("220 fake ESMTP\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("latin1");
    for (;;) {
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end === -1) return;
        mails.push({ to, raw: buf.slice(0, end) });
        buf = buf.slice(end + 5);
        inData = false;
        sock.write("250 queued\r\n");
        continue;
      }
      const nl = buf.indexOf("\r\n");
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      if (/^EHLO/i.test(line)) sock.write("250-fake\r\n250 8BITMIME\r\n");
      else if (/^RCPT TO/i.test(line)) { to = (line.match(/<([^>]+)>/) ?? [])[1] ?? ""; sock.write("250 ok\r\n"); }
      else if (/^DATA/i.test(line)) { inData = true; sock.write("354 go\r\n"); }
      else if (/^QUIT/i.test(line)) { sock.write("221 bye\r\n"); sock.end(); }
      else sock.write("250 ok\r\n");
    }
  });
  sock.on("error", () => {});
});
const decodeQp = (s) => s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const linkIn = (mail) => (decodeQp(mail.raw).match(new RegExp(`${APP}/signin/confirm\\?[^\\s"<]+`)) ?? [])[0]?.replace(/&amp;/g, "&");

async function startApp() {
  const env = {
    ...process.env,
    DATABASE_URL: `${require("./support/env").DB_APP_URL}/${DB}`,
    ALLOWED_EMAILS: "ada@example.com, grace@example.com",
    APP_URL: APP,
    SMTP_URL: `smtp://localhost:${SMTP_PORT}`,
    MAIL_FROM: "Motif <hello@motif.test>",
  };
  const child = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], { cwd: require("./support/env").ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  child.log = () => log;
  for (let i = 0; i < 300 && !/Ready in/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  if (!/Ready in/.test(log)) throw new Error("the app did not start: " + log.slice(-800));
  return child;
}
let app = null;
const stopApp = () => { try { if (app) process.kill(-app.pid, "SIGTERM"); } catch { /* gone */ } };

(async () => {
  psql("postgres", `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  psql("postgres", `CREATE DATABASE ${DB} OWNER ${require("./support/env").DB_APP_ROLE}`);
  await new Promise((r) => smtp.listen(SMTP_PORT, r));
  app = await startApp();
  const browser = await chromium.launch();
  const errors = [];
  const H = { "x-requested-with": "motif", "content-type": "application/json" };

  const device = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    // A page of this site that loads nothing of the app, for setting up the browser's storage before it starts.
    await context.route(`${APP}/__blank`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body>blank</body></html>" }));
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });
    return { context, page };
  };
  const signIn = async ({ context, page }, email) => {
    const before = mails.length;
    await context.request.post(`${APP}/api/auth/email/start`, { headers: H, data: { email, returnTo: "/" } });
    await until(() => mails.length > before);
    await page.goto(linkIn(mails[mails.length - 1]));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${APP}/`, { timeout: 30000 });
    await page.getByRole("button", { name: "Your account" }).waitFor({ timeout: 60000 });
  };
  const storage = async (page, key) => { await page.waitForTimeout(700); return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key); };
  const projectsOf = async (page) => (await storage(page, "motif-projects"))?.state?.projects ?? [];
  const card = (page, id) => page.locator(`[data-project="${id}"]`);
  const row = (id) => sql(`SELECT concat_ws('|', name, version, CASE WHEN deleted_at IS NULL THEN 'live' ELSE 'deleted' END) FROM ${DB}.projects WHERE id='${id}'`);
  const focus = async (page) => { await page.waitForTimeout(1100); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); };
  const rename = async (page, id, name) => {
    await card(page, id).hover();
    await card(page, id).getByLabel("Project actions").click();
    await page.getByRole("button", { name: "Rename" }).click();
    const input = page.getByLabel("Project name");
    await input.fill(name);
    await input.press("Enter");
  };
  // Changes the browser's storage while the app isn't loaded in it, as a change made while it was closed or offline.
  const editStored = async (page, fn) => {
    await page.goto(`${APP}/__blank`);
    await page.evaluate((src) => {
      const edit = new Function("projects", src);
      const raw = JSON.parse(localStorage.getItem("motif-projects"));
      edit(raw.state.projects);
      localStorage.setItem("motif-projects", JSON.stringify(raw));
    }, fn);
  };

  // ── Device A: a project made before signing in is saved to the account ─────
  const A = await device();
  await seed(A.page, "alpha001", { repo: "acme/ds", token: PAT, name: "Alpha", extra: { docs: [] } });
  await A.page.goto(`${APP}/`);
  await card(A.page, "alpha001").waitFor({ timeout: 90000 });
  check("signed out, nothing is sent: the server has no projects table rows", sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_name='projects'`) !== "1" || sql(`SELECT COUNT(*) FROM ${DB}.projects`) === "0");
  await signIn(A, "ada@example.com");
  await A.page.locator("[data-sync-notice]").waitFor({ timeout: 30000 });
  check("signing in saves the project from this browser to the account, and says so", (await A.page.locator("[data-sync-notice]").innerText()).includes("“Alpha” is now saved to your account"));
  check("the server has it at version 1", await until(() => row("alpha001") === "Alpha|1|live"), row("alpha001"));
  const stored = sql(`SELECT data FROM ${DB}.projects WHERE id='alpha001'`);
  check("what is stored has no access token", !stored.includes("ghp_") && !stored.includes('"token"') && !stored.includes(PAT.slice(4)), stored.slice(0, 200));
  check("and the repository is there without it", JSON.parse(stored).connection.owner === "acme" && JSON.parse(stored).connection.repo === "ds");
  check("this browser still has its token", (await projectsOf(A.page))[0].repo.connection.token === PAT);
  const meta = await storage(A.page, "motif-sync");
  check("the browser remembers whose projects they are and the version", !!meta.state.userId && meta.state.meta.alpha001.version === 1, JSON.stringify(meta.state).slice(0, 200));
  await A.page.screenshot({ path: `${OUT}/sync-a.png` });

  // ── Device B: the same person on another device sees it ───────────────────
  const B = await device();
  await B.page.goto(`${APP}/`);
  await B.page.getByRole("button", { name: "Sign in", exact: true }).first().waitFor({ timeout: 60000 });
  check("a device that isn't signed in has no projects", (await projectsOf(B.page)).length === 0);
  await signIn(B, "ada@example.com");
  await card(B.page, "alpha001").waitFor({ timeout: 30000 });
  check("signing in on another device brings the project", (await card(B.page, "alpha001").innerText()).includes("Alpha") && (await card(B.page, "alpha001").innerText()).includes("acme/ds"));
  const onB = (await projectsOf(B.page))[0];
  check("without any access token: that stays on the first device", onB.repo.connection.token === "" && !JSON.stringify(await storage(B.page, "motif-projects")).includes("ghp_"));
  await B.page.screenshot({ path: `${OUT}/sync-b.png` });

  // ── A change on one device reaches the other ─────────────────────────────
  await rename(A.page, "alpha001", "Alpha renamed");
  check("a rename on A is saved to the server (version 2)", await until(() => row("alpha001") === "Alpha renamed|2|live"), row("alpha001"));
  await focus(B.page);
  check("and B shows it when it next looks", await until(async () => (await card(B.page, "alpha001").innerText()).includes("Alpha renamed")));
  check("B did not send anything back for it", row("alpha001") === "Alpha renamed|2|live");

  // ── Different parts changed on two devices are combined ──────────────────
  await rename(A.page, "alpha001", "Alpha 3");
  await until(() => row("alpha001") === "Alpha 3|3|live");
  await editStored(B.page, `projects[0].docs = [{ id: "doc-1", title: "Intro", blocks: [] }]; projects[0].updatedAt = Date.now();`);
  await B.page.goto(`${APP}/`);
  check("a name changed on A and the docs on B (while B was closed) are both kept", await until(async () => (await card(B.page, "alpha001").innerText()).includes("Alpha 3")));
  check("and the server has both, at version 4", await until(() => row("alpha001") === "Alpha 3|4|live") && JSON.parse(sql(`SELECT data FROM ${DB}.projects WHERE id='alpha001'`)).docs.length === 1, row("alpha001"));
  check("no question was asked", (await B.page.locator("[data-sync-conflict]").count()) === 0);
  await focus(A.page);
  check("A gets the docs too", await until(async () => (await projectsOf(A.page))[0].docs.length === 1));

  // ── A change that arrives while the project is open in the editor ─────────
  await A.page.goto(`${APP}/editor/alpha001`);
  await A.page.getByText("Layers", { exact: true }).waitFor({ timeout: 90000 });
  await rename(B.page, "alpha001", "Open elsewhere");
  await until(() => row("alpha001") === "Open elsewhere|5|live");
  await focus(A.page);
  check("the editor takes in a change from another device, without leaving", await until(async () => (await projectsOf(A.page))[0].name === "Open elsewhere") && (await A.page.getByText("Layers", { exact: true }).isVisible()));
  await A.page.waitForTimeout(2500);
  check("and does not write the old state back over it", row("alpha001") === "Open elsewhere|5|live", row("alpha001"));
  await A.page.goto(`${APP}/`);
  await card(A.page, "alpha001").waitFor({ timeout: 30000 });

  // ── The same part changed differently: a person decides ──────────────────
  await rename(A.page, "alpha001", "From A");
  await until(() => row("alpha001") === "From A|6|live");
  await editStored(B.page, `projects[0].name = "From B"; projects[0].updatedAt = Date.now();`);
  await B.page.goto(`${APP}/`);
  await B.page.locator("[data-sync-conflict]").waitFor({ timeout: 30000 });
  const text = await B.page.locator("[data-sync-conflict]").innerText();
  check("the question names the project and what clashed", text.includes("“From B” was changed on another device") && text.includes("both changed the name"), text);
  check("until it is answered, nothing is sent or replaced", row("alpha001") === "From A|6|live" && (await projectsOf(B.page))[0].name === "From B");
  await B.page.screenshot({ path: `${OUT}/sync-conflict.png` });
  await B.page.locator("[data-keep=server]").click();
  check("choosing the other version takes it here", await until(async () => (await card(B.page, "alpha001").innerText()).includes("From A")) && (await B.page.locator("[data-sync-conflict]").count()) === 0);
  check("and sends nothing", row("alpha001") === "From A|6|live");

  await rename(A.page, "alpha001", "A again");
  await until(() => row("alpha001") === "A again|7|live");
  await editStored(B.page, `projects[0].name = "B again"; projects[0].updatedAt = Date.now();`);
  await B.page.goto(`${APP}/`);
  await B.page.locator("[data-sync-conflict]").waitFor({ timeout: 30000 });
  await B.page.locator("[data-keep=local]").click();
  check("choosing this device's version sends it", await until(() => row("alpha001") === "B again|8|live"), row("alpha001"));
  await focus(A.page);
  check("and the other device gets it", await until(async () => (await card(A.page, "alpha001").innerText()).includes("B again")));

  // ── Deleting ─────────────────────────────────────────────────────────────
  await card(A.page, "alpha001").hover();
  await card(A.page, "alpha001").getByLabel("Project actions").click();
  await A.page.getByRole("button", { name: "Delete" }).click();
  check("deleting says it is deleted from the account, everywhere", (await card(A.page, "alpha001").innerText()).includes("Delete this project from your account?") && (await card(A.page, "alpha001").innerText()).includes("all your devices"));
  await card(A.page, "alpha001").getByRole("button", { name: "Delete" }).click();
  check("the server keeps a note without the content", await until(() => row("alpha001") === "|9|deleted") && sql(`SELECT data FROM ${DB}.projects WHERE id='alpha001'`) === "", row("alpha001"));
  await focus(B.page);
  check("the other device drops it", await until(async () => (await projectsOf(B.page)).length === 0));

  // ── Signing out takes saved projects off the browser ─────────────────────
  await seedMore(B.page);
  async function seedMore(page) {
    await editStored(page, `projects.push({ id: "beta0001", name: "Beta", createdAt: 1, updatedAt: 2, repo: { connection: { owner: "acme", repo: "kit", token: "${PAT}", defaultBranch: "main" }, analysis: null, tokenLink: null }, library: { source: null, components: [] }, tokens: { sets: [], colors: [], typography: [], spacing: [], radii: [], shadows: [], components: [] }, docs: [] });`);
    await page.goto(`${APP}/`);
  }
  await card(B.page, "beta0001").waitFor({ timeout: 30000 });
  check("a project made on B (while signed in) is saved", await until(() => row("beta0001") === "Beta|1|live"), row("beta0001"));
  await B.page.getByRole("button", { name: "Your account" }).click();
  check("the menu says projects are saved to the account", (await B.page.locator("[data-sync-status]").innerText()).includes("saved to your account"));
  await B.page.getByRole("menuitem", { name: "Sign out" }).click();
  await B.page.getByRole("button", { name: "Sign in", exact: true }).first().waitFor({ timeout: 30000 });
  check("signing out leaves none of the account's projects in the browser", await until(async () => (await projectsOf(B.page)).length === 0));
  check("they are still on the server", row("beta0001") === "Beta|1|live");
  check("and the browser has forgotten whose they were", (await storage(B.page, "motif-sync")).state.userId === null);

  // Someone else on the same browser
  await signIn(B, "grace@example.com");
  await B.page.waitForTimeout(1500);
  check("another person signing in on that browser doesn't get them", (await projectsOf(B.page)).length === 0 && sql(`SELECT COUNT(*) FROM ${DB}.projects p JOIN ${DB}.users u ON u.id=p.user_id WHERE u.email='grace@example.com'`) === "0");
  const graceGets = await B.context.request.get(`${APP}/api/projects/beta0001`, { headers: H });
  check("and cannot read them by asking for them", graceGets.status() === 404);
  const graceList = await (await B.context.request.get(`${APP}/api/projects`, { headers: H })).json();
  check("or see that they exist", graceList.projects.length === 0);
  const graceSteals = await B.context.request.put(`${APP}/api/projects/beta0001`, { headers: H, data: { baseVersion: 1, data: { name: "Mine now", connection: null, tokenLink: null, tokens: {}, docs: [] } } });
  check("or change them (a stale version for a project she doesn't have is refused)", graceSteals.status() === 409 && sql(`SELECT name FROM ${DB}.projects WHERE id='beta0001'`) === "Beta");
  await B.context.request.post(`${APP}/api/auth/logout`, { headers: H });

  // Ada comes back
  await signIn(B, "ada@example.com");
  await card(B.page, "beta0001").waitFor({ timeout: 30000 });
  check("signing in again brings the account's projects back", (await card(B.page, "beta0001").innerText()).includes("Beta"));

  // ── The API on its own ───────────────────────────────────────────────────
  const anon = await browser.newContext();
  check("without a session the API says to sign in", (await anon.request.get(`${APP}/api/projects`, { headers: H })).status() === 401 && (await anon.request.put(`${APP}/api/projects/x`, { headers: H, data: {} })).status() === 401);
  check("and without the app header it refuses", (await B.context.request.get(`${APP}/api/projects`)).status() === 400);
  await anon.close();
  const put = (id, body) => B.context.request.put(`${APP}/api/projects/${id}`, { headers: H, data: body });
  const good = { name: "API", connection: null, tokenLink: null, tokens: {}, docs: [] };
  const withToken = await put("api00001", { baseVersion: 0, data: { ...good, docs: [{ text: "my token is " + PAT }] } });
  check("a project containing something that looks like an access token is refused", withToken.status() === 422 && (await withToken.json()).error.includes("access token") && row("api00001") === "");
  const withConnToken = await put("api00002", { baseVersion: 0, data: { ...good, connection: { owner: "acme", repo: "ds", defaultBranch: "main", token: "plain-secret" } } });
  check("a token field on the repository is dropped, not stored", withConnToken.status() === 200 && !sql(`SELECT data FROM ${DB}.projects WHERE id='api00002'`).includes("plain-secret"));
  check("a bad id, version or body is refused", (await put("bad id!", { baseVersion: 0, data: good })).status() === 400 && (await put("api00003", { data: good })).status() === 400 && (await put("api00003", { baseVersion: 0, data: { ...good, name: "" } })).status() === 422);
  const stale = await put("api00002", { baseVersion: 0, data: good });
  const staleBody = await stale.json();
  check("a stale version is refused with what the server has", stale.status() === 409 && staleBody.conflict && staleBody.current.version === 1 && staleBody.current.data.name === "API", JSON.stringify(staleBody).slice(0, 200));
  const huge = await put("api00004", { baseVersion: 0, data: { ...good, docs: [{ text: "x".repeat(1_600_000) }] } });
  check("a project that is too large is refused", huge.status() === 422 || huge.status() === 413);
  const delStale = await B.context.request.delete(`${APP}/api/projects/api00002?baseVersion=0`, { headers: H });
  check("deleting with a stale version is refused", delStale.status() === 409);

  check("no errors in the page's console", errors.length === 0, errors.join(" | "));
  const leak = app.log().split("\n").filter((l) => !/^\s*(GET|POST|PUT|DELETE) /.test(l)).join("\n").match(/.{0,60}(ghp_|motif_session).{0,60}/);
  check("the server log has no token", !leak, leak && leak[0]);

  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  stopApp(); smtp.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); stopApp(); process.exit(1); });
