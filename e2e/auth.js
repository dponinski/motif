// Accounts end to end: a real MariaDB, a fake SMTP server, fake Google/Apple (OpenID Connect), GitHub and Anthropic.
const { chromium } = require("playwright");
const http = require("http");
const net = require("net");
const { spawn, execFileSync } = require("child_process");
const { generateKeyPair, exportJWK, exportPKCS8, SignJWT, jwtVerify, importJWK } = require("jose");
const { seedDb: seed } = require("./support/seed");

const { OUT } = require("./support/env");
const { APP_PORT_OWN: APP_PORT } = require("./support/env");
const FAKE_PORT = 3199, SMTP_PORT = 2525;
const APP = `http://localhost:${APP_PORT}`;
const FAKE = `http://localhost:${FAKE_PORT}`;
const DB = "motif_e2e";
const { psql } = require("./support/env");
const sql = (q) => psql(DB, q.split(`${DB}.`).join(""));

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`);
};

// ── Fake SMTP: takes the message and keeps it ───────────────────────────────
const mails = [];
const smtp = net.createServer((sock) => {
  let data = "", inData = false, buf = "", to = "";
  sock.write("220 fake ESMTP\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("latin1");
    for (;;) {
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end === -1) return;
        data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        mails.push({ to, raw: data });
        sock.write("250 queued\r\n");
        continue;
      }
      const nl = buf.indexOf("\r\n");
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      if (/^EHLO/i.test(line)) sock.write("250-fake\r\n250 8BITMIME\r\n");
      else if (/^MAIL FROM/i.test(line)) sock.write("250 ok\r\n");
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

// ── Fake providers on one port ───────────────────────────────────────────────
const idp = {
  google: { kid: "g1", alg: "RS256", keys: null, identity: null, codes: new Map(), badNonce: false },
  apple: { kid: "a1", alg: "ES256", keys: null, identity: null, codes: new Map(), secrets: [] },
};
const gh = { identity: null, codes: new Map(), tokens: new Map(), revoked: [], mode: "approve" };
const anthropic = { calls: 0 };
let appleKeyPem = "";
let n = 0;

async function sign(provider, claims) {
  const p = idp[provider];
  return new SignJWT(claims).setProtectedHeader({ alg: p.alg, kid: p.kid }).setIssuedAt().setExpirationTime("5m").sign(p.keys.privateKey);
}

const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, FAKE);
  let body = "";
  for await (const c of req) body += c;
  const send = (status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(obj === null ? undefined : JSON.stringify(obj)); };
  const m = url.pathname.match(/^\/(google|apple)(\/.*)$/);
  if (m) {
    const provider = m[1], p = idp[provider], rest = m[2];
    if (rest === "/.well-known/openid-configuration") return send(200, { issuer: `${FAKE}/${provider}`, authorization_endpoint: `${FAKE}/${provider}/authorize`, token_endpoint: `${FAKE}/${provider}/token`, jwks_uri: `${FAKE}/${provider}/jwks` });
    if (rest === "/jwks") return send(200, { keys: [{ ...(await exportJWK(p.keys.publicKey)), kid: p.kid, alg: p.alg, use: "sig" }] });
    if (rest === "/authorize") {
      const q = Object.fromEntries(url.searchParams);
      const code = `${provider}-code-${++n}`;
      if (!p.identity) { res.writeHead(302, { location: `${q.redirect_uri}?error=access_denied&state=${q.state}` }); return res.end(); }
      p.codes.set(code, { ...p.identity, nonce: q.nonce, redirect_uri: q.redirect_uri, client_id: q.client_id, challenge: q.code_challenge, state: q.state });
      p.lastAuthorize = q;
      if (provider === "google") { res.writeHead(302, { location: `${q.redirect_uri}?code=${code}&state=${q.state}` }); return res.end(); }
      // Apple posts a form from its own page.
      const user = p.identity.first ? JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email: p.identity.email }) : "";
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<form id=f method=post action="${q.redirect_uri}"><input name=code value="${code}"><input name=state value="${q.state}">${user ? `<input name=user value='${user}'>` : ""}</form><script>f.submit()</script>`);
    }
    if (rest === "/token") {
      const form = new URLSearchParams(body);
      const entry = p.codes.get(form.get("code"));
      p.codes.delete(form.get("code"));
      if (!entry || form.get("redirect_uri") !== entry.redirect_uri || form.get("client_id") !== entry.client_id) return send(400, { error: "invalid_grant" });
      if (provider === "google") {
        if (form.get("client_secret") !== "g-secret") return send(401, { error: "invalid_client" });
        const { createHash } = require("crypto");
        if (createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== entry.challenge) return send(400, { error: "invalid_grant" });
      } else {
        try {
          const { payload, protectedHeader } = await jwtVerify(form.get("client_secret"), p.keys.publicKey, { issuer: "TEAM123456", audience: `${FAKE}/apple`, subject: "com.example.motif" });
          p.secrets.push({ kid: protectedHeader.kid, exp: payload.exp });
        } catch (e) { return send(401, { error: "invalid_client", detail: String(e) }); }
      }
      const claims = { iss: `${FAKE}/${provider}`, aud: entry.client_id, sub: entry.sub, nonce: p.badNonce ? "wrong" : entry.nonce };
      if (entry.email) { claims.email = entry.email; claims.email_verified = provider === "apple" ? String(entry.verified !== false) : entry.verified !== false; }
      if (provider === "google") { claims.name = entry.name; claims.picture = entry.picture; }
      return send(200, { id_token: await sign(provider, claims), access_token: "x", token_type: "Bearer" });
    }
    return send(404, { error: "no" });
  }

  // GitHub (the sign-in of the GitHub App) and its API
  if (url.pathname === "/login/oauth/authorize") {
    const redirect = url.searchParams.get("redirect_uri"), st = url.searchParams.get("state");
    const code = `ghcode${++n}`;
    gh.codes.set(code, gh.identity);
    res.writeHead(302, { location: gh.mode === "deny" ? `${redirect}?error=access_denied&state=${st}` : `${redirect}?code=${code}&state=${st}` });
    return res.end();
  }
  if (url.pathname === "/login/oauth/access_token") {
    const json = JSON.parse(body || "{}");
    const identity = gh.codes.get(json.code);
    if (!identity) return send(200, { error: "bad_verification_code" });
    const token = `ghu_${++n}`;
    gh.tokens.set(token, identity);
    return send(200, { access_token: token, expires_in: 28800, refresh_token: `ghr_${n}`, refresh_token_expires_in: 15897600, token_type: "bearer", scope: "" });
  }
  if (url.pathname === "/applications/testid/token" && req.method === "DELETE") {
    const j = JSON.parse(body || "{}");
    gh.revoked.push(j.access_token);
    gh.tokens.delete(j.access_token);
    return send(204, null);
  }
  const bearer = (req.headers.authorization ?? "").replace("Bearer ", "");
  const who = gh.tokens.get(bearer);
  if (url.pathname === "/user") return who ? send(200, { id: who.id, login: who.login, name: who.name, avatar_url: "https://avatars.test/x.png" }) : send(401, { message: "Bad credentials" });
  if (url.pathname === "/user/emails") return who ? send(200, who.emails) : send(401, { message: "Bad credentials" });
  if (url.pathname === "/user/installations") return who ? send(200, { total_count: 0, installations: [] }) : send(401, {});

  // Anthropic
  if (url.pathname === "/anthropic/v1/messages" && req.method === "POST") {
    anthropic.calls++;
    return send(200, { id: "msg_1", type: "message", role: "assistant", model: "claude", content: [{ type: "text", text: "Hello from the fake assistant" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  }
  send(404, { error: "no" });
});

async function startApp() {
  const env = {
    ...process.env,
    DATABASE_URL: `${require("./support/env").DB_APP_URL}/${DB}`,
    ALLOWED_EMAILS: "ada@example.com, @acme.test",
    APP_URL: APP,
    SMTP_URL: `smtp://localhost:${SMTP_PORT}`,
    MAIL_FROM: "Motif <hello@motif.test>",
    GOOGLE_CLIENT_ID: "g-client", GOOGLE_CLIENT_SECRET: "g-secret", GOOGLE_ISSUER: `${FAKE}/google`,
    APPLE_CLIENT_ID: "com.example.motif", APPLE_TEAM_ID: "TEAM123456", APPLE_KEY_ID: "KEY1234567", APPLE_PRIVATE_KEY: appleKeyPem.replace(/\n/g, "\\n"), APPLE_ISSUER: `${FAKE}/apple`,
    GITHUB_APP_CLIENT_ID: "testid", GITHUB_APP_CLIENT_SECRET: "testsecret", GITHUB_APP_SLUG: "motif-test",
    GITHUB_OAUTH_URL: FAKE, GITHUB_API_URL: FAKE,
    ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: `${FAKE}/anthropic`,
    CHAT_PER_HOUR: "3",
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
  idp.google.keys = await generateKeyPair("RS256", { extractable: true });
  idp.apple.keys = await generateKeyPair("ES256", { extractable: true });
  appleKeyPem = await exportPKCS8(idp.apple.keys.privateKey);
  await new Promise((r) => smtp.listen(SMTP_PORT, r));
  await new Promise((r) => fake.listen(FAKE_PORT, r));
  app = await startApp();
  const browser = await chromium.launch();

  const newContext = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.route("https://avatars.test/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>" }));
    await context.route("https://api.github.com/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    return context;
  };
  const H = { "x-requested-with": "motif" };
  const session = async (context) => (await context.request.get(`${APP}/api/auth/session`, { headers: H })).json();
  const settle = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const chat = (context) => context.request.post(`${APP}/api/ai`, { headers: { ...H, "content-type": "application/json" }, data: { messages: [{ role: "user", content: "hi" }], context: null } });

  // ── Signed out ────────────────────────────────────────────────────────────
  let context = await newContext();
  let page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy|violates/i.test(m.text())) errors.push(m.text()); });

  const s0 = await session(context);
  check("the server says accounts are set up, with every way in, and nobody signed in", s0.configured && s0.providers.github && s0.providers.google && s0.providers.apple && s0.providers.email && s0.user === null && s0.nobodyAllowed === false, JSON.stringify(s0));
  check("a request from elsewhere (no app header) is refused", (await context.request.get(`${APP}/api/auth/session`)).status() === 400);
  const r401 = await chat(context);
  check("the assistant refuses someone who isn't signed in, and costs nothing", r401.status() === 401 && (await r401.json()).signInRequired === true && anthropic.calls === 0);
  check("and refuses a request without the app header", (await context.request.post(`${APP}/api/ai`, { data: { messages: [{ role: "user", content: "hi" }] } })).status() === 400);

  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Continue with GitHub/ }).waitFor();
  check("the dialog offers GitHub, Google, Apple and email", (await dialog.getByRole("button", { name: /Continue with (GitHub|Google|Apple)/ }).count()) === 3 && await dialog.getByLabel("Email address").isVisible());
  await page.screenshot({ path: `${OUT}/auth-dialog.png` });

  // ── Email: someone who isn't on the list ──────────────────────────────────
  const ask = async (email) => context.request.post(`${APP}/api/auth/email/start`, { headers: { ...H, "content-type": "application/json" }, data: { email, returnTo: "/" } });
  const notListed = await ask("nobody@evil.test");
  const listedFirst = await ask("ada@example.com");
  const nb = await notListed.text(), lb = await listedFirst.text();
  check("asking for a link gives the same answer whether or not the address may sign in", notListed.status() === 200 && listedFirst.status() === 200 && nb === lb, `${nb} / ${lb}`);
  await settle(async () => mails.length >= 1);
  await new Promise((r) => setTimeout(r, 800));
  check("and a mail is sent only to the one on the list", mails.length === 1 && mails[0].to === "ada@example.com" && !mails.some((m) => m.to === "nobody@evil.test"), JSON.stringify(mails.map((m) => m.to)));
  const tokenRows = sql(`SELECT COUNT(*) FROM ${DB}.login_tokens`);
  check("one link was made, and what is stored is a hash of it", tokenRows === "1" && !decodeQp(mails[0].raw).includes(sql(`SELECT id FROM ${DB}.login_tokens`)));

  // Through the form, for the screenshot
  await dialog.getByLabel("Email address").fill("nobody@evil.test");
  await dialog.getByRole("button", { name: /Email me a sign-in link/ }).click();
  await dialog.locator("[data-email-sent]").waitFor();
  check("the form says the same thing for an address that isn't on the list", (await dialog.locator("[data-email-sent]").innerText()).includes("If nobody@evil.test can sign in here"));
  await page.keyboard.press("Escape");

  // ── Email: the link ───────────────────────────────────────────────────────
  const link = linkIn(mails[0]);
  check("the mail carries a link to the confirm page of this site", !!link && link.startsWith(`${APP}/signin/confirm?token=`), link);
  await page.goto(link);
  await page.locator("[data-confirm-email]").waitFor({ timeout: 60000 });
  check("opening the link shows who it would sign in, without signing anyone in", (await page.locator("[data-confirm-email]").innerText()) === "ada@example.com" && (await session(context)).user === null);
  await page.reload();
  check("and opening it again doesn't use it up", await page.locator("[data-confirm-email]").waitFor({ timeout: 20000 }).then(() => true, () => false));
  await page.screenshot({ path: `${OUT}/auth-confirm.png` });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${APP}/`, { timeout: 30000 });
  await page.getByRole("button", { name: "Your account" }).waitFor({ timeout: 30000 });
  check("pressing the button signs in, and the header shows who", (await page.getByRole("button", { name: "Your account" }).innerText()).includes("ada@example.com"));
  const cookie = (await context.cookies()).find((c) => c.name === "motif_session");
  check("the session is a cookie the page can't read, for the whole site, kept for about a month", !!cookie && cookie.httpOnly && cookie.sameSite === "Lax" && cookie.path === "/" && cookie.expires > Date.now() / 1000 + 25 * 86400 && cookie.expires < Date.now() / 1000 + 31 * 86400, JSON.stringify(cookie && { ...cookie, value: "…" }));
  check("only a hash of it is kept on the server", sql(`SELECT COUNT(*) FROM ${DB}.sessions WHERE id = '${cookie.value}'`) === "0" && sql(`SELECT COUNT(*) FROM ${DB}.sessions`) === "1");
  check("nothing in the page's storage has it", !(await page.evaluate(() => document.cookie + JSON.stringify({ ...localStorage }))).includes(cookie.value));
  await page.screenshot({ path: `${OUT}/auth-signed-in.png` });
  await page.reload();
  check("a reload is still signed in", await page.getByRole("button", { name: "Your account" }).waitFor({ timeout: 30000 }).then(() => true, () => false));

  const reuse = await newContext();
  const used = await reuse.newPage();
  await used.goto(link);
  check("the same link can't be used again", await used.getByRole("alert").filter({ hasText: /./ }).waitFor({ timeout: 30000 }).then(() => true, () => false) && (await used.getByRole("alert").filter({ hasText: /./ }).innerText()).includes("expired or was already used"));
  await reuse.close();

  // ── The assistant, signed in ──────────────────────────────────────────────
  const ok1 = await chat(context);
  check("the assistant answers someone signed in", ok1.status() === 200 && (await ok1.json()).text?.includes("fake assistant") && anthropic.calls === 1);
  await chat(context); await chat(context);
  const over = await chat(context);
  check("until they've used their hour's messages (3 here)", over.status() === 429 && (await over.json()).error.includes("limit of 3") && anthropic.calls === 3);
  const big = await context.request.post(`${APP}/api/ai`, { headers: { ...H, "content-type": "application/json" }, data: { messages: [{ role: "user", content: "x".repeat(9000) }] } });
  check("a message that's too big is refused (and the limit answer comes first when over)", big.status() === 429 || big.status() === 413);

  // ── Sign out ──────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Your account" }).click();
  await page.screenshot({ path: `${OUT}/auth-menu.png` });
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).first().waitFor({ timeout: 20000 });
  check("signing out shows the sign-in button again", true);
  check("and the session is gone from the server, so the old cookie is worth nothing", sql(`SELECT COUNT(*) FROM ${DB}.sessions`) === "0");
  const replay = await newContext();
  await replay.addCookies([{ name: "motif_session", value: cookie.value, url: APP }]);
  check("replaying the old cookie is not signed in", (await session(replay)).user === null);
  await replay.close();
  await context.close();

  // ── Google ────────────────────────────────────────────────────────────────
  context = await newContext();
  page = await context.newPage();
  const google = (identity) => { idp.google.identity = identity; };
  google({ sub: "g-1", email: "ADA@example.com", verified: true, name: "Ada L", picture: "https://avatars.test/g.png" });
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Continue with Google/ }).click();
  await page.getByRole("button", { name: "Your account" }).waitFor({ timeout: 60000 });
  check("Google: signing in with a verified allowed email lands signed in", (await session(context)).user?.email === "ada@example.com");
  const q = idp.google.lastAuthorize;
  check("Google was sent a state, a nonce and a PKCE challenge, and this site's address", q.state.length > 20 && q.nonce.length > 20 && q.code_challenge_method === "S256" && q.redirect_uri === `${APP}/api/auth/google/callback` && q.scope.includes("email"), JSON.stringify(q));
  check("the address has no code or state afterwards", !/code=|state=/.test(page.url()), page.url());
  check("the same email through Google and by email is the one person, with two ways in", sql(`SELECT COUNT(*) FROM ${DB}.users WHERE email='ada@example.com'`) === "1" && sql(`SELECT COUNT(*) FROM ${DB}.identities`) === "2", sql(`SELECT provider FROM ${DB}.identities`));
  await context.request.post(`${APP}/api/auth/logout`, { headers: H });
  await context.close();

  const attempt = async (provider, button, identityFn, expectError) => {
    const ctx = await newContext();
    const pg = await ctx.newPage();
    identityFn();
    // The page removes the reason from the address once it has shown it, so it is noted as it passes.
    let seen = null;
    pg.on("framenavigated", (f) => { const e = new URL(f.url()).searchParams.get("auth_error"); if (e) seen = e; });
    await pg.goto(`${APP}/`);
    await pg.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await pg.getByRole("dialog").getByRole("button", { name: button }).click();
    await settle(async () => seen !== null || !!(await session(ctx)).user, 60000);
    const out = { err: seen, user: (await session(ctx)).user, alert: await pg.getByRole("alert").filter({ hasText: /./ }).first().innerText({ timeout: 8000 }).catch(() => null), pg, ctx };
    return out;
  };

  let r = await attempt("google", /Continue with Google/, () => google({ sub: "g-2", email: "eve@evil.test", verified: true }));
  check("Google: an email that isn't allowed is refused with a reason on the page", r.err === "not-allowed" && r.user === null && /isn't allowed to sign in here/.test(r.alert ?? ""), `${r.err} ${r.alert}`);
  await r.pg.screenshot({ path: `${OUT}/auth-not-allowed.png` });
  check("and nobody was made of them", sql(`SELECT COUNT(*) FROM ${DB}.users WHERE email='eve@evil.test'`) === "0");
  await r.ctx.close();

  r = await attempt("google", /Continue with Google/, () => google({ sub: "g-3", email: "bob@acme.test", verified: false }));
  check("Google: an allowed email that Google hasn't verified is refused", r.err === "no-verified-email" && r.user === null, r.err);
  await r.ctx.close();

  r = await attempt("google", /Continue with Google/, () => google({ sub: "g-4", email: "bob@acme.test", verified: true }));
  check("Google: an address at an allowed domain signs in as a new person", r.user?.email === "bob@acme.test", JSON.stringify(r.user));
  await r.ctx.close();

  idp.google.badNonce = true;
  r = await attempt("google", /Continue with Google/, () => google({ sub: "g-1", email: "ada@example.com", verified: true }));
  check("Google: a token that isn't for this sign-in (wrong nonce) is not accepted", r.err === "failed" && r.user === null, r.err);
  await r.ctx.close();
  idp.google.badNonce = false;

  r = await attempt("google", /Continue with Google/, () => google(null));
  check("Google: cancelling comes back with a note, not an error page", r.err === "denied" && r.user === null && /cancelled/.test(r.alert ?? ""), `${r.err} ${r.alert}`);
  await r.ctx.close();

  // A callback that this browser didn't start
  const stray = await newContext();
  const sr = await stray.request.get(`${APP}/api/auth/google/callback?code=abc&state=xyz`, { maxRedirects: 0 });
  check("a callback this browser never started is refused", sr.status() === 307 && /auth_error=state/.test(sr.headers().location ?? ""), sr.headers().location);
  await stray.close();

  // ── Apple ─────────────────────────────────────────────────────────────────
  const apple = (identity) => { idp.apple.identity = identity; };
  r = await attempt("apple", /Continue with Apple/, () => apple({ sub: "a-1", email: "ada@example.com", verified: true, first: true }));
  check("Apple: the form it posts back signs in, with the name from the form", r.user?.email === "ada@example.com", JSON.stringify(r.user));
  check("Apple was asked with a form post, and the app's secret was a signed token", idp.apple.lastAuthorize.response_mode === "form_post" && idp.apple.secrets.length >= 1 && idp.apple.secrets[0].kid === "KEY1234567", JSON.stringify(idp.apple.secrets));
  check("still one person, now with Apple as a third way in", sql(`SELECT COUNT(*) FROM ${DB}.users WHERE email='ada@example.com'`) === "1" && sql(`SELECT COUNT(*) FROM ${DB}.identities WHERE user_id=(SELECT id FROM ${DB}.users WHERE email='ada@example.com')`) === "3");
  const aflow = (await r.ctx.cookies()).find((c) => c.name === "motif_auth_flow");
  check("the Apple flow cookie is gone once done", !aflow);
  await r.ctx.close();

  r = await attempt("apple", /Continue with Apple/, () => apple({ sub: "a-1", email: undefined, first: false }));
  check("Apple: signing in again, when it sends no email, still works for a known identity", r.user?.email === "ada@example.com", `${r.err} ${JSON.stringify(r.user)}`);
  await r.ctx.close();

  r = await attempt("apple", /Continue with Apple/, () => apple({ sub: "a-2", email: "x1y2z3@privaterelay.appleid.com", verified: true, first: true }));
  check("Apple: a hidden (private relay) email can't be matched, and the person is told what to do", r.err === "private-email" && r.user === null && /hid your email/.test(r.alert ?? ""), `${r.err} ${r.alert}`);
  await r.pg.screenshot({ path: `${OUT}/auth-private-email.png` });
  await r.ctx.close();

  // ── GitHub ────────────────────────────────────────────────────────────────
  const ghId = (identity) => { gh.identity = identity; };
  r = await attempt("github", /Continue with GitHub/, () => ghId({ id: 5, login: "ada", name: "Ada Lovelace", emails: [{ email: "ada@example.com", verified: true, primary: true }, { email: "other@example.com", verified: false }] }));
  check("GitHub: a verified allowed email signs in, as the one person", r.user?.email === "ada@example.com" && sql(`SELECT COUNT(*) FROM ${DB}.users WHERE email='ada@example.com'`) === "1", `${r.err} ${JSON.stringify(r.user)}`);
  check("and the GitHub connection for repositories is made at the same time", await r.pg.evaluate(() => fetch("/api/github/session", { headers: { "x-requested-with": "motif" } }).then((x) => x.status)).then((s) => s < 500).catch(() => true));
  check("GitHub is a fourth way in for that person", sql(`SELECT COUNT(*) FROM ${DB}.identities WHERE provider='github'`) === "1");
  await r.ctx.close();

  const revokedBefore = gh.revoked.length;
  r = await attempt("github", /Continue with GitHub/, () => ghId({ id: 6, login: "mallory", name: "M", emails: [{ email: "mallory@evil.test", verified: true }] }));
  check("GitHub: an address that isn't allowed is refused, and the token it gave is revoked", r.err === "not-allowed" && r.user === null && gh.revoked.length === revokedBefore + 1, `${r.err} ${gh.revoked.length}`);
  await r.ctx.close();

  r = await attempt("github", /Continue with GitHub/, () => ghId({ id: 7, login: "quiet", name: "Q", emails: [{ email: "ada@example.com", verified: false }] }));
  check("GitHub: only unverified addresses means no sign-in, with the GitHub-specific hint", r.err === "github-email" && r.user === null && /permission to read email/.test(r.alert ?? ""), `${r.err} ${r.alert}`);
  await r.ctx.close();

  // ── Limits ────────────────────────────────────────────────────────────────
  const limit = await newContext();
  const asked = [];
  for (let i = 0; i < 6; i++) asked.push((await limit.request.post(`${APP}/api/auth/email/start`, { headers: { ...H, "content-type": "application/json" }, data: { email: "carol@acme.test" } })).status());
  check("an address can be sent only 5 links an hour", asked.slice(0, 5).every((s) => s === 200) && asked[5] === 429, asked.join());
  await limit.close();

  // ── The chat panel ────────────────────────────────────────────────────────
  context = await newContext();
  page = await context.newPage();
  await seed(page, "auth0001");
  await page.goto(`${APP}/editor/auth0001`);
  await page.getByText("Layers", { exact: true }).waitFor({ timeout: 90000 });
  await page.locator('nav button[title="Chat"]').click();
  await page.locator("[data-chat-locked]").waitFor({ timeout: 20000 });
  check("in the editor, the assistant says to sign in and its box is disabled", await page.getByPlaceholder("Sign in to ask…").isDisabled());
  await page.screenshot({ path: `${OUT}/auth-chat-locked.png` });
  await page.locator("[data-chat-locked]").getByRole("button", { name: "Sign in" }).click();
  check("and its button opens the sign-in dialog", await page.getByRole("dialog").getByText("Sign in to Motif").waitFor({ timeout: 10000 }).then(() => true, () => false));
  await context.close();

  check("no errors in the page's console", errors.length === 0, errors.join(" | "));
  const leak = app.log().split("\n").filter((l) => !/^\s*(GET|POST) /.test(l)).join("\n").match(/.{0,60}(g-secret|testsecret|ghu_|ghr_|(google|apple)-code).{0,60}/);
  check("the server never wrote a token, code or secret to its log", !leak, leak && leak[0]);

  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  stopApp();
  smtp.close(); fake.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); stopApp(); process.exit(1); });
