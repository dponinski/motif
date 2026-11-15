import { importPKCS8 } from "jose";
import { readConfig as readGithub, installUrl } from "../github-oauth.ts";
import { readAuthConfig, parseAllowed } from "./config.ts";
import { MIGRATIONS } from "./db.ts";
import { inviteMessage, loginMessage, type Message } from "./mail.ts";
import { appleClientSecret, discover, forgetDiscoveries, randomString, type Discovery } from "./oidc.ts";

// What `npm run doctor` finds out about a server's setup, with the real environment and the real providers. Signing in with Google or
// Apple, mailing a link and opening a pull request all depend on things outside this repository (an OAuth client, a key, a mail
// account, an app installed), and the tests can only stand in for those. This asks each of them whether what the server was given is
// accepted, as far as that can be known without a person pressing a consent button. Nothing is changed: no account, no row, no mail
// (unless a test address is given), no sign-in.

export type Status = "ok" | "warn" | "fail" | "skip";
export interface Check { id: string; title: string; status: Status; detail: string; hint?: string }

export interface SmtpTransport {
  verify(): Promise<unknown>;
  sendMail(message: { from: string } & Message): Promise<{ accepted?: unknown[]; rejected?: unknown[]; response?: string }>;
}
export interface Query { query(sql: string): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> }

export interface Deps {
  fetch: typeof fetch;
  smtp: (url: string) => SmtpTransport;
  db: (url: string, env: Record<string, string | undefined>) => Promise<Query>;
  now?: () => number;
}
export interface Options {
  // An address to send a real sign-in message and a real invitation to.
  sendTo?: string;
}

type Env = Record<string, string | undefined>;
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const check = (id: string, title: string, status: Status, detail: string, hint?: string): Check => ({ id, title, status, detail, ...(hint ? { hint } : {}) });
const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);

// How the provider answers a request that is made with the app's own credentials and a code that can't be right. A provider that
// knows the credentials says the code is bad; one that doesn't says the client is.
async function probeToken(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<{ status: number; error: string | null; description: string | null }> {
  const res = await fetchImpl(url, { ...init, cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { error?: unknown; error_description?: unknown } | null;
  return { status: res.status, error: typeof body?.error === "string" ? body.error : null, description: typeof body?.error_description === "string" ? body.error_description : null };
}

// ── The parts ─────────────────────────────────────────────────────────────────

export async function checkDatabase(env: Env, deps: Deps): Promise<Check[]> {
  const url = env.DATABASE_URL?.trim();
  if (!url) return [check("database", "Database", "skip", "DATABASE_URL isn't set, so there are no accounts: everything stays in each person's browser, and the sign-in options below are not offered.")];
  const out: Check[] = [];
  let client: Query | null = null;
  try {
    client = await deps.db(url, env);
    const info = await client.query("SELECT current_database() AS name, current_setting('server_version') AS version");
    out.push(check("database", "Database", "ok", `connected to ${String(info.rows[0]?.name)} (PostgreSQL ${String(info.rows[0]?.version)})`));
    const tables = await client.query("SELECT to_regclass('public.users') AS users, to_regclass('public.schema_migrations') AS migrations");
    if (!tables.rows[0]?.users) out.push(check("migrations", "Tables", "warn", "the tables aren't there yet", "They are made by the app the first time it connects; start the server once."));
    else {
      const v = await client.query("SELECT max(version) AS version FROM schema_migrations");
      const have = Number(v.rows[0]?.version ?? 0);
      const latest = Math.max(...MIGRATIONS.map((m) => m.version));
      out.push(
        have === latest ? check("migrations", "Tables", "ok", `up to date (step ${have})`) :
        have < latest ? check("migrations", "Tables", "warn", `at step ${have}; this version of Motif is at ${latest}`, "They are brought up to date by the app when it starts.") :
        check("migrations", "Tables", "warn", `at step ${have}, which is newer than this version of Motif knows (${latest})`, "Something newer has used this database; running an older version against it is not safe."),
      );
    }
  } catch (err) {
    out.push(check("database", "Database", "fail", msg(err), "Supabase: Connect, Session pooler (the direct connection is IPv6 only), with the database password."));
  } finally {
    await client?.end().catch(() => undefined);
  }
  if (!env.DATABASE_CA?.trim() && !/(localhost|127\.0\.0\.1)/.test(url)) out.push(check("database-ca", "Database certificate", "warn", "DATABASE_CA isn't set: the connection is encrypted but the server isn't verified", "Supabase: Project settings, Database, SSL configuration, Download certificate."));
  return out;
}

export function checkAllowed(env: Env): Check[] {
  if (!env.DATABASE_URL?.trim()) return [];
  const allowed = parseAllowed(env.ALLOWED_EMAILS);
  if (allowed.length === 0) return [check("allowed", "Who may sign in", "fail", "ALLOWED_EMAILS is empty, and empty means nobody", "Addresses and @domain entries: ada@example.com, @acme.io. (A person invited to a team can sign in without being on it.)")];
  const odd = allowed.filter((e) => !/^@[^@\s]+\.[^@\s]+$/.test(e) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (odd.length) return [check("allowed", "Who may sign in", "warn", `${allowed.length} entries, but ${odd.map((e) => `"${e}"`).join(", ")} ${odd.length === 1 ? "isn't" : "aren't"} an address or an @domain`)];
  return [check("allowed", "Who may sign in", "ok", `${allowed.length} ${allowed.length === 1 ? "entry" : "entries"} (${allowed.filter((e) => e.startsWith("@")).length} domains)`)];
}

export function checkAppUrl(env: Env): Check[] {
  const raw = env.APP_URL?.trim();
  const providers = !!(env.GOOGLE_CLIENT_ID || env.APPLE_CLIENT_ID || env.GITHUB_APP_CLIENT_ID || env.SMTP_URL);
  if (!raw) return providers ? [check("app-url", "APP_URL", "warn", "not set: behind a proxy the callback addresses and the links in mail may be the wrong ones", "Set it to where the site is served, https://your-domain (no path).")] : [];
  let u: URL;
  try { u = new URL(raw); } catch { return [check("app-url", "APP_URL", "fail", `"${raw}" isn't an address`)]; }
  if (u.pathname !== "/" && u.pathname !== "") return [check("app-url", "APP_URL", "warn", `${raw} has a path: callbacks are made as ${u.origin}/api/...`, "Use just the address of the site.")];
  if (u.protocol !== "https:" && !isLocal(raw)) return [check("app-url", "APP_URL", "warn", `${raw} isn't https: cookies are not marked Secure, and Apple won't send people back to it`)];
  return [check("app-url", "APP_URL", "ok", raw.replace(/\/+$/, ""))];
}

export async function checkEmail(env: Env, deps: Deps, options: Options): Promise<Check[]> {
  const smtpUrl = env.SMTP_URL?.trim();
  if (!smtpUrl) return [check("email", "Email", "skip", "SMTP_URL isn't set: there are no sign-in links by email, and the team dialog shows an invitation's link to pass on instead of mailing it.")];
  let u: URL;
  try { u = new URL(smtpUrl); } catch { return [check("email", "Email", "fail", "SMTP_URL isn't an address", "smtps://user:password@smtp.example.com:465 (a password with symbols has to be percent-encoded).")]; }
  if (!/^smtps?:$/.test(u.protocol)) return [check("email", "Email", "fail", `SMTP_URL starts with ${u.protocol}//, not smtp:// or smtps://`)];
  const out: Check[] = [];
  const transport = deps.smtp(smtpUrl);
  try {
    await transport.verify();
    out.push(check("email", "Email server", "ok", `${u.hostname}:${u.port || (u.protocol === "smtps:" ? 465 : 587)} accepted the login${u.username ? ` as ${decodeURIComponent(u.username)}` : ""}`));
  } catch (err) {
    out.push(check("email", "Email server", "fail", msg(err), "Port 465 is smtps://, 587 is smtp:// (and starts TLS by itself). Check the user name, the password and that the host allows this server's address."));
    return out;
  }
  const from = env.MAIL_FROM?.trim() ?? "";
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  if (!from) out.push(check("mail-from", "Sender", "warn", "MAIL_FROM isn't set: mail goes out from no-reply@localhost, which most providers refuse or file as spam", `MAIL_FROM="Motif <no-reply@your-domain>"`));
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) out.push(check("mail-from", "Sender", "fail", `"${from}" has no address in it`));
  else if (/@(localhost|example\.com)$/.test(address)) out.push(check("mail-from", "Sender", "warn", `mail is sent from ${address}, which isn't an address of yours`));
  else out.push(check("mail-from", "Sender", "ok", from));

  if (options.sendTo) {
    const to = options.sendTo;
    const base = env.APP_URL?.trim().replace(/\/+$/, "") ?? "http://localhost:3000";
    const messages = [loginMessage(to, `${base}/signin/confirm?token=doctor-${randomString(6)}`, 15), inviteMessage(to, "Doctor check", "Motif doctor", `${base}/invite/doctor-${randomString(6)}`, 14)];
    for (const m of messages) {
      try {
        const sent = await transport.sendMail({ from: from || "Motif <no-reply@localhost>", ...m });
        const rejected = sent.rejected ?? [];
        out.push(rejected.length ? check("send", `Sent: ${m.subject}`, "fail", `${to} was refused: ${sent.response ?? "no reason given"}`) : check("send", `Sent: ${m.subject}`, "ok", `${to} accepted by the server${sent.response ? ` (${sent.response})` : ""}; check the inbox, and the spam folder`));
      } catch (err) {
        out.push(check("send", `Sent: ${m.subject}`, "fail", msg(err)));
      }
    }
  } else {
    out.push(check("send", "A real message", "skip", "not sent; add --send-to you@example.com to send a sign-in link and an invitation to an address"));
  }
  return out;
}

const callback = (base: string | null, provider: string) => `${base ?? "https://your-domain"}/api/${provider}/callback`;

export async function checkGoogle(env: Env, deps: Deps): Promise<Check[]> {
  const config = readAuthConfig({ ...env, DATABASE_URL: env.DATABASE_URL || "x" });
  if (!config?.google) return [check("google", "Google", "skip", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET aren't both set: Google isn't offered.")];
  const { clientId, clientSecret, issuer } = config.google;
  const out: Check[] = [];
  const redirect = callback(config.appUrl, "auth/google");
  if (!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) out.push(check("google-id", "Google client id", "warn", `${clientId} doesn't look like one (1234-abc.apps.googleusercontent.com)`));
  let d: Discovery;
  try {
    d = await discover(issuer, deps.fetch, deps.now?.());
    out.push(check("google", "Google", "ok", `${issuer} describes itself; sign-ins are sent to ${new URL(d.authorization_endpoint).host}`));
  } catch (err) {
    return [...out, check("google", "Google", "fail", msg(err))];
  }
  try {
    const keys = (await (await deps.fetch(d.jwks_uri)).json()) as { keys?: unknown[] };
    out.push(keys.keys?.length ? check("google-keys", "Google's signing keys", "ok", `${keys.keys.length} keys to check ID tokens against`) : check("google-keys", "Google's signing keys", "fail", "none were published"));
  } catch (err) {
    out.push(check("google-keys", "Google's signing keys", "fail", msg(err)));
  }
  try {
    const r = await probeToken(deps.fetch, d.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "doctor", redirect_uri: redirect, client_id: clientId, client_secret: clientSecret, code_verifier: randomString(48) }),
    });
    if (r.error === "invalid_client") out.push(check("google-secret", "Google client id and secret", "fail", `Google doesn't know this pair${r.description ? ` (${r.description})` : ""}`, "Cloud console, APIs & Services, Credentials: an OAuth client of type Web application. Copy the id and the secret again."));
    else if (r.error === "invalid_grant" || r.error === "redirect_uri_mismatch" || r.error === "invalid_request") out.push(check("google-secret", "Google client id and secret", "ok", "accepted (it refused the made-up code, as it should)"));
    else out.push(check("google-secret", "Google client id and secret", "warn", r.status === 403 || r.status === 407 ? `couldn't ask: ${d.token_endpoint} answered ${r.status}` : `unexpected answer ${r.status} ${r.error ?? ""}`));
  } catch (err) {
    out.push(check("google-secret", "Google client id and secret", "warn", `couldn't ask: ${msg(err)}`));
  }
  out.push(check("google-redirect", "Google redirect URI", "skip", `must be registered exactly: ${redirect}`, "Only Google can say whether it is; it is tried the first time someone signs in."));
  return out;
}

export async function checkApple(env: Env, deps: Deps): Promise<Check[]> {
  const config = readAuthConfig({ ...env, DATABASE_URL: env.DATABASE_URL || "x" });
  if (!config?.apple) return [check("apple", "Apple", "skip", "APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY aren't all set: Apple isn't offered.")];
  const apple = config.apple;
  const out: Check[] = [];
  const redirect = callback(config.appUrl, "auth/apple");
  if (!config.appUrl || !config.appUrl.startsWith("https://") || isLocal(config.appUrl)) out.push(check("apple-url", "Apple return URL", "fail", `${redirect} isn't an https address of a real domain, which Apple requires`, "Set APP_URL to the https address of the site, and register the domain and this return URL on the Services ID."));
  else out.push(check("apple-url", "Apple return URL", "skip", `must be registered exactly on the Services ID: ${redirect}`));
  // Apple only lets a Services ID use a domain once the file it gives for that domain is served from it.
  if (config.appUrl && config.appUrl.startsWith("https://") && !isLocal(config.appUrl)) {
    const file = `${config.appUrl}/.well-known/apple-developer-domain-association.txt`;
    try {
      const res = await deps.fetch(file, { cache: "no-store" });
      const text = res.ok ? (await res.text()).trim() : "";
      out.push(text && !/<html/i.test(text)
        ? check("apple-domain", "Apple domain verification file", "ok", `${file} is served`)
        : check("apple-domain", "Apple domain verification file", "fail", `${file} isn't served (${res.status})`, "Download the file from the Services ID's domain settings in Apple's developer account and put it in public/.well-known/ of this repository, then deploy. Apple fetches it when you press Verify."));
    } catch (err) {
      out.push(check("apple-domain", "Apple domain verification file", "warn", `couldn't ask ${config.appUrl}: ${msg(err)}`));
    }
  }
  if (/^[A-Z0-9]{10}$/.test(apple.clientId)) out.push(check("apple-id", "Apple client id", "warn", `${apple.clientId} looks like a Team ID; the client id is the Services ID (com.example.web)`));
  if (!/^[A-Z0-9]{10}$/.test(apple.teamId)) out.push(check("apple-team", "Apple team id", "warn", `${apple.teamId} isn't 10 letters and digits`));
  if (!/^[A-Z0-9]{10}$/.test(apple.keyId)) out.push(check("apple-key-id", "Apple key id", "warn", `${apple.keyId} isn't 10 letters and digits`));
  let secret: string;
  try {
    await importPKCS8(apple.privateKey, "ES256");
    secret = await appleClientSecret(apple, apple.issuer, deps.now?.());
    out.push(check("apple-key", "Apple private key", "ok", "reads as a P-256 key and signs the client secret"));
  } catch (err) {
    return [...out, check("apple-key", "Apple private key", "fail", msg(err), "The .p8 file's text, from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----; its line breaks written as \\n if it goes on one line.")];
  }
  let d: Discovery;
  try {
    d = await discover(apple.issuer, deps.fetch, deps.now?.());
    out.push(check("apple", "Apple", "ok", `${apple.issuer} describes itself`));
  } catch (err) {
    return [...out, check("apple", "Apple", "fail", `couldn't reach ${apple.issuer}: ${msg(err)}`)];
  }
  try {
    const r = await probeToken(deps.fetch, d.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "doctor", redirect_uri: redirect, client_id: apple.clientId, client_secret: secret }),
    });
    if (r.error === "invalid_client") out.push(check("apple-secret", "Apple Services ID, team and key", "fail", "Apple doesn't accept this combination", "The key must be one made for Sign in with Apple, with this Key ID, under this Team ID, and the Services ID must be set up for it (primary App ID, domain and return URL)."));
    else if (r.error === "invalid_grant" || r.error === "invalid_request") out.push(check("apple-secret", "Apple Services ID, team and key", "ok", "accepted (it refused the made-up code, as it should)"));
    else out.push(check("apple-secret", "Apple Services ID, team and key", "warn", r.status === 403 || r.status === 407 ? `couldn't ask: ${d.token_endpoint} answered ${r.status}` : `unexpected answer ${r.status} ${r.error ?? ""}`));
  } catch (err) {
    out.push(check("apple-secret", "Apple Services ID, team and key", "warn", `couldn't ask: ${msg(err)}`));
  }
  return out;
}

export async function checkGithubApp(env: Env, deps: Deps): Promise<Check[]> {
  const config = readGithub(env);
  if (!config) return [check("github", "GitHub App", "skip", "GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET aren't both set: there is no sign-in with GitHub, and projects use access tokens.")];
  const out: Check[] = [];
  const redirect = callback(config.appUrl, "github");
  try {
    const r = await probeToken(deps.fetch, `${config.oauthUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code: "doctor", redirect_uri: redirect }),
    });
    if (r.error === "incorrect_client_credentials") out.push(check("github", "GitHub App client id and secret", "fail", "GitHub doesn't know this pair", "The app's Client ID (Iv23...) and a client secret generated for it, not the App ID or a private key."));
    else if (r.error === "bad_verification_code" || r.error === "redirect_uri_mismatch") out.push(check("github", "GitHub App client id and secret", "ok", "accepted (it refused the made-up code, as it should)"));
    else out.push(check("github", "GitHub App client id and secret", "warn", r.status === 403 || r.status === 407 ? `couldn't ask: ${config.oauthUrl} answered ${r.status} (a network that only lets some addresses through?)` : `unexpected answer ${r.status} ${r.error ?? ""}`));
  } catch (err) {
    out.push(check("github", "GitHub App client id and secret", "warn", `couldn't ask: ${msg(err)}`));
  }
  if (!config.slug) out.push(check("github-slug", "GitHub App name", "warn", "GITHUB_APP_SLUG isn't set: there is no link to install the app on more repositories"));
  else {
    try {
      const res = await deps.fetch(`${config.apiUrl}/apps/${encodeURIComponent(config.slug)}`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
      const app = res.ok ? ((await res.json()) as { client_id?: string; permissions?: Record<string, string> }) : null;
      if (!app && res.status !== 404) out.push(check("github-slug", "GitHub App name", "warn", `couldn't look it up: GitHub answered ${res.status}`));
      else if (!app) out.push(check("github-slug", "GitHub App name", "fail", `github.com/apps/${config.slug} doesn't exist`, "The last part of the app's public link."));
      else if (app.client_id && app.client_id !== config.clientId) out.push(check("github-slug", "GitHub App name", "fail", `${config.slug} is a different app from the one this client id belongs to`));
      else {
        const p = app.permissions ?? {};
        const missing = [["contents", "write", "Contents: Read and write"], ["pull_requests", "write", "Pull requests: Read and write"], ["emails", "read", "Email addresses (account): Read-only"]].filter(([k, level]) => !(p[k] === level || (level === "read" && p[k] === "write")));
        out.push(missing.length ? check("github-slug", "GitHub App permissions", "warn", `missing: ${missing.map((m) => m[2]).join("; ")}`, "App settings, Permissions & events. Email addresses is what lets people sign in to Motif with GitHub.") : check("github-slug", "GitHub App", "ok", `${config.slug}, with the permissions Motif needs; install link ${installUrl(config)}`));
      }
    } catch (err) {
      out.push(check("github-slug", "GitHub App name", "warn", `couldn't ask: ${msg(err)}`));
    }
  }
  out.push(check("github-redirect", "GitHub callback URL", "skip", `must be among the app's callback URLs: ${redirect}`, "Only GitHub can say whether it is; it is tried the first time someone signs in."));
  return out;
}

export async function runDoctor(env: Env, deps: Deps, options: Options = {}): Promise<Check[]> {
  forgetDiscoveries();
  return [
    ...(await checkDatabase(env, deps)),
    ...checkAllowed(env),
    ...checkAppUrl(env),
    ...(await checkEmail(env, deps, options)),
    ...(await checkGoogle(env, deps)),
    ...(await checkApple(env, deps)),
    ...(await checkGithubApp(env, deps)),
  ];
}

export const failed = (checks: Check[]) => checks.filter((c) => c.status === "fail");
