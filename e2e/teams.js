// Teams: an owner, a teammate on the server's list, a guest the team invites, and an outsider, on one real server.
const { chromium } = require("playwright");
const net = require("net");
const { spawn, execFileSync } = require("child_process");
const { seedDb: seed } = require("./support/seed");

const { OUT } = require("./support/env");
const { APP_PORT_OWN: APP_PORT } = require("./support/env");
const SMTP_PORT = 2525;
const APP = `http://localhost:${APP_PORT}`;
const DB = "motif_teams_e2e";
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
const inviteLinkIn = (mail) => (decodeQp(mail.raw).match(new RegExp(`${APP}/invite/[^\\s"<]+`)) ?? [])[0]?.replace(/&amp;/g, "&");
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

  const sections = (page) => page.locator("[data-section]").evaluateAll((els) => els.map((e) => ({ name: e.getAttribute("data-section"), projects: [...e.querySelectorAll("[data-project]")].map((p) => p.getAttribute("data-project")) })));
  const teamRows = (q) => sql(q);
  const api = (ctx, method, path, data) => ctx.request.fetch(`${APP}${path}`, { method, headers: H, data });

  // ── The owner: a project of her own, a team, and the project moved into it ──
  const ada = await device();
  await seed(ada.page, "shared01", { repo: "acme/ds", token: PAT, name: "Shared system" });
  await ada.page.goto(`${APP}/`);
  await card(ada.page, "shared01").waitFor({ timeout: 90000 });
  await signIn(ada, "ada@example.com");
  check("her project is saved to her account", await until(() => row("shared01") === "Shared system|1|live"), row("shared01"));
  await ada.page.getByRole("button", { name: "New team" }).click();
  await ada.page.getByLabel("Team name").fill("Design team");
  await ada.page.getByRole("button", { name: "Create team" }).click();
  await ada.page.locator('[data-section="team:Design team"]').waitFor({ timeout: 30000 });
  check("a new team shows as a section of the dashboard, with her as its owner", (await ada.page.locator('[data-section="team:Design team"]').innerText()).includes("Owner · 1 person"));
  const teamId = teamRows("SELECT id FROM " + DB + ".teams LIMIT 1");
  check("the server has the team with her as its owner", teamRows(`SELECT role FROM ${DB}.team_members WHERE team_id='${teamId}'`) === "owner");
  await card(ada.page, "shared01").hover();
  await card(ada.page, "shared01").getByLabel("Project actions").click();
  await ada.page.getByRole("button", { name: "Move to Design team" }).click();
  check("moving the project puts it in the team's section", await until(async () => (await sections(ada.page)).find((s) => s.name === "team:Design team")?.projects.includes("shared01")), JSON.stringify(await sections(ada.page)));
  check("on the server it is the team's now, and her own copy is only a deleted note", await until(() => teamRows(`SELECT concat_ws('|', name, version, team_id = '${teamId}') FROM ${DB}.team_projects WHERE id='shared01'`).startsWith("Shared system|")) && row("shared01").endsWith("|deleted"), row("shared01"));
  check("it is not lost from her browser by being 'deleted' in the old place", (await projectsOf(ada.page)).some((p) => p.id === "shared01" && p.teamId === teamId));
  await ada.page.screenshot({ path: `${OUT}/teams-owner.png` });

  // ── Inviting ──────────────────────────────────────────────────────────────
  await ada.page.getByLabel("Manage Design team").click();
  await ada.page.getByLabel("Invite by email").fill("grace@example.com");
  await ada.page.getByRole("button", { name: "Invite", exact: true }).click();
  await ada.page.locator("[data-invite-sent]").waitFor({ timeout: 15000 });
  check("inviting someone mails them the invitation and says so", (await ada.page.locator("[data-invite-sent]").innerText()).includes("emailed to grace@example.com") && await until(() => mails.some((m) => m.to === "grace@example.com" && /invite/i.test(decodeQp(m.raw)))));
  await ada.page.getByLabel("Invite by email").fill("linus@guests.test");
  await ada.page.getByRole("button", { name: "Invite", exact: true }).click();
  await until(() => mails.some((m) => m.to === "linus@guests.test"));
  const linusMail = mails.find((m) => m.to === "linus@guests.test");
  const inviteLink = inviteLinkIn(linusMail);
  check("the mail carries a link to this site", !!inviteLink, decodeQp(linusMail.raw).slice(0, 300));
  check("only the hash of the invitation is kept", !teamRows(`SELECT string_agg(token_hash, ',') FROM ${DB}.team_invites`).includes(inviteLink.split("/invite/")[1].slice(0, 12)));
  check("owners see who is waiting to join", await until(async () => (await ada.page.locator("[data-invite]").count()) === 2));
  await ada.page.screenshot({ path: `${OUT}/teams-dialog.png` });
  await ada.page.keyboard.press("Escape");

  // ── An outsider can't get in, and a guest can't before being invited ─────
  const mallory = await browser.newContext();
  const before = mails.length;
  const asked = await mallory.request.post(`${APP}/api/auth/email/start`, { headers: H, data: { email: "mallory@outsider.test", returnTo: "/" } });
  await new Promise((r) => setTimeout(r, 800));
  check("someone nobody listed or invited is sent nothing, and told the same as anyone", asked.status() === 200 && mails.length === before);
  check("and has no teams to see", (await api(mallory, "GET", "/api/teams")).status() === 401);

  // ── The guest: invited, not on the server's list ──────────────────────────
  const linus = await device();
  await linus.page.goto(inviteLink);
  await linus.page.getByRole("button", { name: "Sign in to join" }).click();
  const mailsBefore = mails.length;
  await linus.page.getByLabel("Email address").fill("linus@guests.test");
  await linus.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  check("an invited address is sent a sign-in link though it isn't on the list", await until(() => mails.length > mailsBefore && mails[mails.length - 1].to === "linus@guests.test" && !!linkIn(mails[mails.length - 1])));
  await linus.page.goto(linkIn(mails[mails.length - 1]));
  await linus.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await linus.page.waitForURL(/\/invite\//, { timeout: 30000 });
  await linus.page.getByRole("button", { name: "Join", exact: true }).waitFor({ timeout: 60000 });
  check("signing in brings him back to the invitation, as the address that was invited", (await linus.page.locator("[data-invite-email]").innerText()) === "linus@guests.test");
  await linus.page.screenshot({ path: `${OUT}/teams-invite.png` });
  await linus.page.getByRole("button", { name: "Join", exact: true }).click();
  await linus.page.getByText("You're in Design team.").waitFor({ timeout: 15000 });
  check("joining makes him a member", teamRows(`SELECT role FROM ${DB}.team_members m JOIN ${DB}.users u ON u.id = m.user_id WHERE u.email='linus@guests.test'`) === "member");
  await linus.page.getByRole("link", { name: "Open the dashboard" }).click();
  await card(linus.page, "shared01").waitFor({ timeout: 60000 });
  check("the team's design system is on his dashboard, in the team's section", (await sections(linus.page)).find((s) => s.name === "team:Design team")?.projects.join() === "shared01");
  const session = await (await api(linus.context, "GET", "/api/auth/session")).json();
  check("the server knows him as a guest", session.user.email === "linus@guests.test" && session.user.guest === true);
  const chatTry = await api(linus.context, "POST", "/api/ai", { messages: [{ role: "user", content: "hi" }] });
  check("the assistant, which the server pays for, is refused to him", chatTry.status() === 403 && (await chatTry.json()).error.includes("guests"));
  check("and he can't start teams of his own", (await api(linus.context, "POST", "/api/teams", { name: "Mine" })).status() === 403);
  check("the dashboard doesn't offer him one", (await linus.page.getByRole("button", { name: "New team" }).count()) === 0);
  await linus.page.screenshot({ path: `${OUT}/teams-guest.png` });
  const onLinus = (await projectsOf(linus.page)).find((p) => p.id === "shared01");
  check("he has the project without any access token", onLinus.repo.connection.token === "" && onLinus.teamId === teamId);

  // ── The teammate on the list takes up her invitation from the dashboard ──
  const grace = await device();
  await grace.page.goto(`${APP}/`);
  await grace.page.getByRole("button", { name: "Sign in", exact: true }).first().waitFor({ timeout: 60000 });
  await signIn(grace, "grace@example.com");
  await grace.page.locator('[data-invitation="Design team"]').waitFor({ timeout: 30000 });
  await grace.page.getByRole("button", { name: "Join", exact: true }).click();
  await card(grace.page, "shared01").waitFor({ timeout: 30000 });
  check("an invitation waiting for her address is on her dashboard, and Join brings the design system", (await sections(grace.page)).find((s) => s.name === "team:Design team")?.projects.join() === "shared01");

  // ── Working together ──────────────────────────────────────────────────────
  await rename(grace.page, "shared01", "Shared by Grace");
  check("a teammate's change is saved to the team's design system, with who made it", await until(() => teamRows(`SELECT concat_ws('|', name, version, updated_by = (SELECT id FROM ${DB}.users WHERE email='grace@example.com')) FROM ${DB}.team_projects WHERE id='shared01'`) .startsWith("Shared by Grace|")));
  await focus(ada.page);
  check("the owner sees it when she next looks, and who changed it", await until(async () => { const t = await card(ada.page, "shared01").innerText(); return t.includes("Shared by Grace") && t.includes("by Grace"); }));
  await focus(linus.page);
  check("and so does the guest", await until(async () => (await card(linus.page, "shared01").innerText()).includes("Shared by Grace")));
  await rename(ada.page, "shared01", "Owner's title");
  await until(() => teamRows(`SELECT name FROM ${DB}.team_projects WHERE id='shared01'`) === "Owner's title");
  await focus(grace.page);
  check("changes made by two people in turn both go through", await until(async () => (await card(grace.page, "shared01").innerText()).includes("Owner's title")));
  await ada.page.screenshot({ path: `${OUT}/teams-shared.png` });

  // ── Roles ─────────────────────────────────────────────────────────────────
  await card(grace.page, "shared01").hover();
  await card(grace.page, "shared01").getByLabel("Project actions").click();
  check("a member isn't offered Delete (only an owner deletes for the whole team)", (await grace.page.getByRole("button", { name: "Delete", exact: true }).count()) === 0 && await grace.page.getByRole("button", { name: "Rename" }).isVisible());
  await grace.page.keyboard.press("Escape");
  const version = Number(teamRows(`SELECT version FROM ${DB}.team_projects WHERE id='shared01'`));
  const del = await api(grace.context, "DELETE", `/api/projects/shared01?baseVersion=${version}`);
  check("and the server refuses it if asked", del.status() === 403 && teamRows(`SELECT deleted_at IS NULL FROM ${DB}.team_projects WHERE id='shared01'`) === "t");
  const invites = await api(grace.context, "POST", `/api/teams/${teamId}/invites`, { email: "someone@else.test" });
  check("a member can't invite either", invites.status() === 403);
  check("an outsider can't read the team's design system or the team", (await api(mallory, "GET", "/api/projects/shared01")).status() === 401);

  // ── Taking someone out ends their access ──────────────────────────────────
  await ada.page.getByLabel("Manage Design team").click();
  await ada.page.getByLabel("Remove linus@guests.test").click();
  await until(async () => (await ada.page.locator('[data-member="linus@guests.test"]').count()) === 0);
  check("removing the guest takes him out of the team", teamRows(`SELECT COUNT(*) FROM ${DB}.team_members m JOIN ${DB}.users u ON u.id = m.user_id WHERE u.email='linus@guests.test'`) === "0");
  const gone = await api(linus.context, "GET", "/api/projects");
  check("and, being in no team, he can't use the server at all any more", gone.status() === 401);
  await ada.page.getByLabel("Remove grace@example.com").click();
  await until(async () => (await ada.page.locator('[data-member="grace@example.com"]').count()) === 0);
  await ada.page.keyboard.press("Escape");
  await focus(grace.page);
  check("a teammate who is removed loses the design system from her browser, and is told", await until(async () => (await card(grace.page, "shared01").count()) === 0 && (await projectsOf(grace.page)).every((p) => p.id !== "shared01")));
  check("she is told why", (await grace.page.locator("[data-sync-notice]").innerText()).includes("no longer in the team"), await grace.page.locator("[data-sync-notice]").innerText().catch(() => ""));
  check("but she can still sign in: she is on the server's list", (await api(grace.context, "GET", "/api/projects")).status() === 200);

  // ── The owner deletes it, and then the team ───────────────────────────────
  await card(ada.page, "shared01").hover();
  await card(ada.page, "shared01").getByLabel("Project actions").click();
  await ada.page.getByRole("button", { name: "Delete", exact: true }).click();
  check("deleting a team's design system warns that everyone loses it", (await ada.page.getByText(/for everyone in Design team/).count()) > 0);
  await ada.page.getByRole("button", { name: "Delete", exact: true }).last().click();
  check("an owner's delete is the team's: the server keeps only a deleted note", await until(() => teamRows(`SELECT deleted_at IS NOT NULL FROM ${DB}.team_projects WHERE id='shared01'`) === "t"));
  await ada.page.getByLabel("Manage Design team").click();
  await ada.page.getByRole("button", { name: "Delete team" }).click();
  await ada.page.getByRole("button", { name: "Delete team" }).last().click();
  check("with no design systems left, the team can be deleted", await until(() => teamRows(`SELECT COUNT(*) FROM ${DB}.teams`) === "0"));

  check("no errors in the page's console", errors.length === 0, errors.join(" | "));
  const leak = app.log().split("\n").filter((l) => !/^\s*(GET|POST|PUT|DELETE|PATCH) /.test(l)).join("\n").match(/.{0,60}(ghp_|motif_session).{0,60}/);
  check("the server log has no token", !leak, leak && leak[0]);
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  stopApp(); smtp.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); stopApp(); process.exit(1); });
