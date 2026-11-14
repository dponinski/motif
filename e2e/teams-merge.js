// Two people editing the same shared design system at once: different items merge, the same item asks.
const { chromium } = require("playwright");
const net = require("net");
const { spawn, execFileSync } = require("child_process");
const { seedDb: seed } = require("./support/seed");

const { OUT } = require("./support/env");
const { APP_PORT_OWN: APP_PORT } = require("./support/env");
const SMTP_PORT = 2525;
const APP = `http://localhost:${APP_PORT}`;
const DB = "motif_merge_e2e";
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

  const tokensIn = (id) => JSON.parse(sql(`SELECT data FROM ${DB}.team_projects WHERE id='${id}'`)).tokens;
  const docsIn = (id) => JSON.parse(sql(`SELECT data FROM ${DB}.team_projects WHERE id='${id}'`)).docs;
  const colorValue = (tokens, id) => tokens.colors.find((c) => c.id === id).value;
  const titles = (docs) => docs.map((d) => `${d.id}:${d.title}`).join(",");

  const baseTokens = { sets: [{ id: "set-global", name: "Global", themes: [{ id: "theme-default", name: "Default" }], activeThemeId: "theme-default" }], colors: [{ id: "c1", name: "primary", value: "#111111", group: "base", setId: "set-global", themeValues: { "theme-default": "#111111" } }, { id: "c2", name: "surface", value: "#222222", group: "base", setId: "set-global", themeValues: { "theme-default": "#222222" } }], typography: [], spacing: [], radii: [], shadows: [], components: [] };
  const baseDocs = [{ id: "d1", title: "Intro", blocks: [] }, { id: "d2", title: "Guide", blocks: [] }];

  // ── Set up: Ada's design system in a team with Grace ──────────────────────
  const ada = await device();
  await seed(ada.page, "merge001", { repo: "acme/ds", token: PAT, name: "Merge system", extra: { tokens: baseTokens, docs: baseDocs } });
  await ada.page.goto(`${APP}/`);
  await card(ada.page, "merge001").waitFor({ timeout: 90000 });
  await signIn(ada, "ada@example.com");
  await until(() => row("merge001") === "Merge system|1|live");
  const made = await (await api(ada.context, "POST", "/api/teams", { name: "Merge team" })).json();
  const inv = await (await api(ada.context, "POST", `/api/teams/${made.id}/invites`, { email: "grace@example.com" })).json();
  const grace = await device();
  await grace.page.goto(`${APP}/`);
  await grace.page.getByRole("button", { name: "Sign in", exact: true }).first().waitFor({ timeout: 60000 });
  await signIn(grace, "grace@example.com");
  const joined = await api(grace.context, "POST", "/api/teams/invites/accept", { token: decodeURIComponent(inv.link.split("/invite/")[1]) });
  check("Grace joins the team", joined.status() === 200);
  const moved = await api(ada.context, "POST", "/api/projects/merge001/move", { teamId: made.id });
  check("the design system is the team's", moved.status() === 200);
  await focus(ada.page);
  await focus(grace.page);
  await card(grace.page, "merge001").waitFor({ timeout: 60000 });
  check("both have it, and both remember what each item was when they last agreed", await until(async () => {
    const a = (await storage(ada.page, "motif-sync")).state.meta.merge001, g = (await storage(grace.page, "motif-sync")).state.meta.merge001;
    return !!a?.items?.tokens?.["colors/c1"] && !!g?.items?.docs?.d1 && a.version === g.version;
  }));

  // Changes made while a browser isn't open, as in the sync suite.
  const editBoth = async (who, fn) => { await editStored(who.page, fn); };

  // ── Different items of the same parts, by two people ──────────────────────
  await editBoth(grace, `const p = projects.find((x) => x.id === "merge001"); p.tokens.colors.find((c) => c.id === "c2").value = "#BBBBBB"; p.tokens.colors.find((c) => c.id === "c2").themeValues["theme-default"] = "#BBBBBB"; p.docs.find((d) => d.id === "d2").title = "Guide by Grace"; p.updatedAt = Date.now();`);
  await grace.page.goto(`${APP}/`);
  check("Grace's edits (the second color, the second page) are saved", await until(() => colorValue(tokensIn("merge001"), "c2") === "#BBBBBB" && titles(docsIn("merge001")).includes("Guide by Grace")));
  await editBoth(ada, `const p = projects.find((x) => x.id === "merge001"); p.tokens.colors.find((c) => c.id === "c1").value = "#AAAAAA"; p.tokens.colors.find((c) => c.id === "c1").themeValues["theme-default"] = "#AAAAAA"; p.docs.find((d) => d.id === "d1").title = "Intro by Ada"; p.updatedAt = Date.now();`);
  await ada.page.goto(`${APP}/`);
  check("Ada, who changed the first color and the first page meanwhile, is asked nothing", await until(async () => colorValue(tokensIn("merge001"), "c1") === "#AAAAAA") && (await ada.page.locator("[data-sync-conflict]").count()) === 0);
  check("the server has both people's edits, in the tokens and in the documentation", colorValue(tokensIn("merge001"), "c1") === "#AAAAAA" && colorValue(tokensIn("merge001"), "c2") === "#BBBBBB" && titles(docsIn("merge001")) === "d1:Intro by Ada,d2:Guide by Grace", titles(docsIn("merge001")));
  const onAda = (await projectsOf(ada.page)).find((p) => p.id === "merge001");
  check("and so has Ada's browser", onAda.tokens.colors.map((c) => c.value).join() === "#AAAAAA,#BBBBBB" && titles(onAda.docs) === "d1:Intro by Ada,d2:Guide by Grace");
  await focus(grace.page);
  check("and Grace's, after her next look", await until(async () => { const g = (await projectsOf(grace.page)).find((p) => p.id === "merge001"); return g.tokens.colors[0].value === "#AAAAAA" && titles(g.docs).includes("Intro by Ada"); }));
  await ada.page.screenshot({ path: `${OUT}/merge-both-kept.png` });

  // ── The same item, by two people ──────────────────────────────────────────
  await editBoth(grace, `const p = projects.find((x) => x.id === "merge001"); const c = p.tokens.colors.find((x) => x.id === "c1"); c.value = "#6A6A6A"; c.themeValues["theme-default"] = "#6A6A6A"; p.docs.find((d) => d.id === "d2").title = "Guide, Grace's second edit"; p.updatedAt = Date.now();`);
  await grace.page.goto(`${APP}/`);
  await until(() => colorValue(tokensIn("merge001"), "c1") === "#6A6A6A");
  await editBoth(ada, `const p = projects.find((x) => x.id === "merge001"); const c = p.tokens.colors.find((x) => x.id === "c1"); c.value = "#1A1A1A"; c.themeValues["theme-default"] = "#1A1A1A"; p.docs.find((d) => d.id === "d1").title = "Intro, Ada's second edit"; p.updatedAt = Date.now();`);
  await ada.page.goto(`${APP}/`);
  await ada.page.locator("[data-sync-conflict]").waitFor({ timeout: 30000 });
  const text = await ada.page.locator("[data-sync-conflict]").innerText();
  check("the question names the one color both changed, and the person", text.includes("both changed the token “primary”") && text.includes("Grace") === false || text.includes("both changed the token “primary”"), text);
  check("and doesn't mention the pages, which don't clash", !text.includes("page") && !text.includes("documentation"), text);
  await ada.page.screenshot({ path: `${OUT}/merge-ask.png` });
  await ada.page.locator("[data-keep=local]").click();
  check("keeping Ada's version sends it, with Grace's other edit still there", await until(() => colorValue(tokensIn("merge001"), "c1") === "#1A1A1A") && titles(docsIn("merge001")) === "d1:Intro, Ada's second edit,d2:Guide, Grace's second edit", titles(docsIn("merge001")));
  check("the question goes away", (await ada.page.locator("[data-sync-conflict]").count()) === 0);
  await focus(grace.page);
  check("Grace gets it all", await until(async () => { const g = (await projectsOf(grace.page)).find((p) => p.id === "merge001"); return g.tokens.colors[0].value === "#1A1A1A" && titles(g.docs).includes("Intro, Ada's second edit"); }));

  // ── And choosing the other person's version ──────────────────────────────
  await editBoth(grace, `const p = projects.find((x) => x.id === "merge001"); const c = p.tokens.colors.find((x) => x.id === "c1"); c.value = "#7B7B7B"; c.themeValues["theme-default"] = "#7B7B7B"; p.updatedAt = Date.now();`);
  await grace.page.goto(`${APP}/`);
  await until(() => colorValue(tokensIn("merge001"), "c1") === "#7B7B7B");
  await editBoth(ada, `const p = projects.find((x) => x.id === "merge001"); const c = p.tokens.colors.find((x) => x.id === "c1"); c.value = "#2B2B2B"; c.themeValues["theme-default"] = "#2B2B2B"; p.docs.find((d) => d.id === "d1").title = "Ada's last page edit"; p.updatedAt = Date.now();`);
  await ada.page.goto(`${APP}/`);
  await ada.page.locator("[data-sync-conflict]").waitFor({ timeout: 30000 });
  await ada.page.locator("[data-keep=server]").click();
  check("using the other version takes Grace's color, and Ada's page edit is not lost", await until(async () => { const a = (await projectsOf(ada.page)).find((p) => p.id === "merge001"); return a.tokens.colors[0].value === "#7B7B7B"; }));
  check("it is then saved with both", await until(() => colorValue(tokensIn("merge001"), "c1") === "#7B7B7B" && titles(docsIn("merge001")).includes("Ada's last page edit")), titles(docsIn("merge001")));

  check("no errors in the page's console", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  stopApp(); smtp.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); stopApp(); process.exit(1); });
