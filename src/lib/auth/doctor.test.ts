import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAllowed, checkApple, checkAppUrl, checkDatabase, checkEmail, checkGithubApp, checkGoogle, failed, runDoctor, type Deps, type Query } from "./doctor";
import { MIGRATIONS } from "./db";
import { forgetDiscoveries } from "./oidc";

const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));

beforeEach(() => forgetDiscoveries());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
const fetcher = (routes: Record<string, Route>) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const hit = Object.keys(routes).find((k) => u.startsWith(k));
    return hit ? routes[hit](u, init) : json({ message: "not routed" }, 404);
  }) as unknown as typeof fetch;
const deps = (over: Partial<Deps> = {}): Deps => ({
  fetch: fetcher({}),
  smtp: () => { throw new Error("no smtp"); },
  db: async () => { throw new Error("no db"); },
  ...over,
});
const status = (checks: { id: string; status: string }[], id: string) => checks.find((c) => c.id === id)?.status;

describe("with nothing set up", () => {
  it("has nothing to check and nothing wrong", async () => {
    const checks = await runDoctor({}, deps());
    expect(checks.every((c) => c.status === "skip")).toBe(true);
    expect(failed(checks)).toEqual([]);
  });
});

describe("who may sign in", () => {
  it("is nobody when the list is empty", () => expect(status(checkAllowed({ DATABASE_URL: "x", ALLOWED_EMAILS: "" }), "allowed")).toBe("fail"));
  it("counts addresses and domains", () => {
    const [c] = checkAllowed({ DATABASE_URL: "x", ALLOWED_EMAILS: "ada@example.com, @acme.io" });
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("2 entries");
  });
  it("notices an entry that is neither", () => expect(status(checkAllowed({ DATABASE_URL: "x", ALLOWED_EMAILS: "ada@example.com acme.io" }), "allowed")).toBe("warn"));
  it("says nothing without accounts", () => expect(checkAllowed({})).toEqual([]));
});

describe("where the site is", () => {
  it("is fine as https", () => expect(status(checkAppUrl({ APP_URL: "https://motif.example.org/" }), "app-url")).toBe("ok"));
  it("is a warning when it is missing and a provider needs it", () => expect(status(checkAppUrl({ GOOGLE_CLIENT_ID: "a" }), "app-url")).toBe("warn"));
  it("is nothing to say when nothing needs it", () => expect(checkAppUrl({})).toEqual([]));
  it("warns about http, except on this machine", () => {
    expect(status(checkAppUrl({ APP_URL: "http://motif.example.org" }), "app-url")).toBe("warn");
    expect(status(checkAppUrl({ APP_URL: "http://localhost:3000" }), "app-url")).toBe("ok");
  });
  it("warns about a path, and refuses what isn't an address", () => {
    expect(status(checkAppUrl({ APP_URL: "https://example.org/motif" }), "app-url")).toBe("warn");
    expect(status(checkAppUrl({ APP_URL: "not a url" }), "app-url")).toBe("fail");
  });
});

describe("the database", () => {
  const client = (rows: Record<string, unknown>[][]): Query => ({ query: vi.fn(async () => ({ rows: rows.shift() ?? [] })), end: vi.fn(async () => undefined) });

  it("connects, and finds the tables up to date", async () => {
    const c = client([[{ name: "postgres", version: "16.4" }], [{ users: "users", migrations: "schema_migrations" }], [{ version: LATEST }]]);
    const out = await checkDatabase({ DATABASE_URL: "postgresql://u:p@db.example.org:5432/postgres", DATABASE_CA: "pem" }, deps({ db: async () => c }));
    expect(status(out, "database")).toBe("ok");
    expect(out.find((x) => x.id === "migrations")?.status).toBe("ok");
    expect(out.find((x) => x.id === "database-ca")).toBeUndefined();
    expect(c.end).toHaveBeenCalled();
  });
  it("says when the tables are not made yet, and when the server is not verified", async () => {
    const c = client([[{ name: "postgres", version: "16.4" }], [{ users: null, migrations: null }]]);
    const out = await checkDatabase({ DATABASE_URL: "postgresql://u:p@db.example.org:5432/postgres" }, deps({ db: async () => c }));
    expect(status(out, "migrations")).toBe("warn");
    expect(status(out, "database-ca")).toBe("warn");
  });
  it("says when the tables are behind this version, or ahead of it", async () => {
    const at = async (version: number) => checkDatabase({ DATABASE_URL: "postgresql://u:p@localhost:5432/postgres" }, deps({ db: async () => client([[{ name: "p", version: "16" }], [{ users: "users", migrations: "m" }], [{ version }]]) }));
    expect(status(await at(LATEST - 1), "migrations")).toBe("warn");
    expect((await at(LATEST - 1)).find((x) => x.id === "migrations")?.hint).toContain("when it starts");
    expect(status(await at(LATEST + 1), "migrations")).toBe("warn");
  });
  it("fails with what the database said", async () => {
    const out = await checkDatabase({ DATABASE_URL: "postgresql://u:p@db.example.org:5432/postgres" }, deps({ db: async () => { throw new Error("password authentication failed for user \"u\""); } }));
    expect(out[0]).toMatchObject({ id: "database", status: "fail" });
    expect(out[0].detail).toContain("password authentication failed");
  });
});

describe("email", () => {
  const transport = (over: Partial<ReturnType<Deps["smtp"]>> = {}) => ({ verify: vi.fn(async () => true), sendMail: vi.fn(async () => ({ accepted: ["a@b.co"], rejected: [], response: "250 OK" })), ...over });
  const env = { SMTP_URL: "smtps://user:pw@smtp.example.org:465", MAIL_FROM: "Motif <hello@motif.example.org>", APP_URL: "https://motif.example.org" };

  it("is skipped without a mail server", async () => expect((await checkEmail({}, deps(), {}))[0].status).toBe("skip"));
  it("logs in, and likes a sender of its own", async () => {
    const out = await checkEmail(env, deps({ smtp: () => transport() }), {});
    expect(status(out, "email")).toBe("ok");
    expect(out[0].detail).toContain("smtp.example.org:465");
    expect(status(out, "mail-from")).toBe("ok");
  });
  it("fails with what the server said when the login is refused", async () => {
    const out = await checkEmail(env, deps({ smtp: () => transport({ verify: async () => { throw new Error("Invalid login: 535 Authentication failed"); } }) }), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "fail" });
    expect(out[0].detail).toContain("535");
  });
  it("refuses an address that isn't one, and a scheme that isn't mail", async () => {
    expect(status(await checkEmail({ SMTP_URL: "https://smtp.example.org" }, deps(), {}), "email")).toBe("fail");
    expect(status(await checkEmail({ SMTP_URL: "nonsense" }, deps(), {}), "email")).toBe("fail");
  });
  it("warns about a sender that is nobody's", async () => {
    expect(status(await checkEmail({ ...env, MAIL_FROM: "" }, deps({ smtp: () => transport() }), {}), "mail-from")).toBe("warn");
    expect(status(await checkEmail({ ...env, MAIL_FROM: "Motif <no-reply@example.com>" }, deps({ smtp: () => transport() }), {}), "mail-from")).toBe("warn");
    expect(status(await checkEmail({ ...env, MAIL_FROM: "Motif" }, deps({ smtp: () => transport() }), {}), "mail-from")).toBe("fail");
  });
  it("sends a sign-in link and an invitation to the address it is given, with the site's own links", async () => {
    const t = transport();
    const out = await checkEmail(env, deps({ smtp: () => t }), { sendTo: "ada@example.com" });
    expect(t.sendMail).toHaveBeenCalledTimes(2);
    const [login, invite] = (t.sendMail as unknown as { mock: { calls: [{ from: string; to: string; subject: string; text: string }][] } }).mock.calls.map((c) => c[0]);
    expect(login).toMatchObject({ to: "ada@example.com", from: "Motif <hello@motif.example.org>", subject: "Your Motif sign-in link" });
    expect(login.text).toContain("https://motif.example.org/signin/confirm?token=");
    expect(invite.subject).toContain("invited you to Doctor check");
    expect(invite.text).toContain("https://motif.example.org/invite/");
    expect(out.filter((c) => c.id === "send").every((c) => c.status === "ok")).toBe(true);
  });
  it("says when the server refused the address, or the sending", async () => {
    const refused = transport({ sendMail: vi.fn(async () => ({ accepted: [], rejected: ["ada@example.com"], response: "550 not allowed" })) });
    const out = await checkEmail(env, deps({ smtp: () => refused }), { sendTo: "ada@example.com" });
    expect(out.filter((c) => c.id === "send").every((c) => c.status === "fail" && c.detail.includes("550"))).toBe(true);
    const broken = transport({ sendMail: vi.fn(async () => { throw new Error("Message rejected: sender not verified"); }) });
    const out2 = await checkEmail(env, deps({ smtp: () => broken }), { sendTo: "ada@example.com" });
    expect(out2.filter((c) => c.id === "send").every((c) => c.status === "fail")).toBe(true);
  });
});

const google = (token: Route) => fetcher({
  "https://accounts.google.com/.well-known": () => json({ issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "https://oauth2.googleapis.com/token", jwks_uri: "https://www.googleapis.com/oauth2/v3/certs" }),
  "https://www.googleapis.com/oauth2/v3/certs": () => json({ keys: [{ kid: "1" }, { kid: "2" }] }),
  "https://oauth2.googleapis.com/token": token,
});
const googleEnv = { GOOGLE_CLIENT_ID: "123456789012-abc.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "GOCSPX-x", APP_URL: "https://motif.example.org" };

describe("Google", () => {
  it("is skipped unless both halves are set", async () => expect((await checkGoogle({ GOOGLE_CLIENT_ID: "x" }, deps()))[0].status).toBe("skip"));
  it("is fine when Google knows the pair and only refuses the made-up code", async () => {
    let sent: URLSearchParams | null = null;
    const out = await checkGoogle(googleEnv, deps({ fetch: google((_, init) => { sent = init?.body as URLSearchParams; return json({ error: "invalid_grant", error_description: "Bad Request" }, 400); }) }));
    expect(failed(out)).toEqual([]);
    expect(status(out, "google-secret")).toBe("ok");
    expect(status(out, "google-keys")).toBe("ok");
    expect(sent!.get("redirect_uri")).toBe("https://motif.example.org/api/auth/google/callback");
    expect(sent!.get("client_id")).toBe(googleEnv.GOOGLE_CLIENT_ID);
    expect(out.find((c) => c.id === "google-redirect")?.detail).toContain("https://motif.example.org/api/auth/google/callback");
  });
  it("fails when Google doesn't know the client", async () => {
    const out = await checkGoogle(googleEnv, deps({ fetch: google(() => json({ error: "invalid_client", error_description: "The OAuth client was not found." }, 401)) }));
    expect(status(out, "google-secret")).toBe("fail");
    expect(out.find((c) => c.id === "google-secret")?.detail).toContain("not found");
  });
  it("fails when Google can't be reached for its description", async () => {
    const out = await checkGoogle(googleEnv, deps({ fetch: fetcher({ "https://accounts.google.com/.well-known": () => json({}, 503) }) }));
    expect(out.at(-1)).toMatchObject({ id: "google", status: "fail" });
  });
  it("doesn't call it wrong when it just couldn't ask", async () => {
    const out = await checkGoogle(googleEnv, deps({ fetch: google(() => json({}, 403)) }));
    expect(status(out, "google-secret")).toBe("warn");
  });
  it("notices a client id that isn't one", async () => {
    const out = await checkGoogle({ ...googleEnv, GOOGLE_CLIENT_ID: "my-client" }, deps({ fetch: google(() => json({ error: "invalid_grant" }, 400)) }));
    expect(status(out, "google-id")).toBe("warn");
  });
});

const pem = () => (generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string);
const apple = (token: Route, file: Route = () => new Response("apple-domain-association-text\n")) => fetcher({
  "https://motif.example.org/.well-known/apple-developer-domain-association.txt": file,
  "https://appleid.apple.com/.well-known": () => json({ issuer: "https://appleid.apple.com", authorization_endpoint: "https://appleid.apple.com/auth/authorize", token_endpoint: "https://appleid.apple.com/auth/token", jwks_uri: "https://appleid.apple.com/auth/keys" }),
  "https://appleid.apple.com/auth/token": token,
});
const appleEnv = () => ({ APPLE_CLIENT_ID: "org.example.motif", APPLE_TEAM_ID: "ABCDE12345", APPLE_KEY_ID: "KEY1234567", APPLE_PRIVATE_KEY: pem().replace(/\n/g, "\\n"), APP_URL: "https://motif.example.org" });

describe("Apple", () => {
  it("is skipped unless all four are set", async () => expect((await checkApple({ APPLE_CLIENT_ID: "x" }, deps()))[0].status).toBe("skip"));
  it("signs its client secret with the key, and is fine when Apple only refuses the made-up code", async () => {
    let secret = "";
    const out = await checkApple(appleEnv(), deps({ fetch: apple((_, init) => { secret = (init?.body as URLSearchParams).get("client_secret")!; return json({ error: "invalid_grant" }, 400); }) }));
    expect(failed(out)).toEqual([]);
    expect(status(out, "apple-key")).toBe("ok");
    expect(status(out, "apple-secret")).toBe("ok");
    expect(decodeProtectedHeader(secret)).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(decodeJwt(secret)).toMatchObject({ iss: "ABCDE12345", sub: "org.example.motif", aud: "https://appleid.apple.com" });
  });
  it("fails when Apple says the client is wrong", async () => {
    const out = await checkApple(appleEnv(), deps({ fetch: apple(() => json({ error: "invalid_client" }, 400)) }));
    expect(status(out, "apple-secret")).toBe("fail");
  });
  it("fails on a private key that isn't one, without asking Apple anything", async () => {
    const f = apple(() => json({}, 400));
    const out = await checkApple({ ...appleEnv(), APPLE_PRIVATE_KEY: "not a key" }, deps({ fetch: f }));
    expect(status(out, "apple-key")).toBe("fail");
    // The site's own domain file may be asked for; Apple is not.
    expect((f as unknown as { mock: { calls: [string][] } }).mock.calls.some(([url]) => url.includes("appleid.apple.com"))).toBe(false);
  });
  it("checks that the domain verification file is served by the site, and that it is a file and not a page", async () => {
    const ok = await checkApple(appleEnv(), deps({ fetch: apple(() => json({ error: "invalid_grant" }, 400)) }));
    expect(status(ok, "apple-domain")).toBe("ok");
    const missing = await checkApple(appleEnv(), deps({ fetch: apple(() => json({ error: "invalid_grant" }, 400), () => new Response("Not found", { status: 404 })) }));
    expect(status(missing, "apple-domain")).toBe("fail");
    expect(missing.find((c) => c.id === "apple-domain")?.hint).toContain("public/.well-known");
    const page = await checkApple(appleEnv(), deps({ fetch: apple(() => json({ error: "invalid_grant" }, 400), () => new Response("<html><body>Welcome</body></html>")) }));
    expect(status(page, "apple-domain")).toBe("fail");
  });
  it("fails on a return URL Apple won't use", async () => {
    for (const APP_URL of ["http://motif.example.org", "https://localhost:3000", undefined]) {
      const out = await checkApple({ ...appleEnv(), APP_URL }, deps({ fetch: apple(() => json({ error: "invalid_grant" }, 400)) }));
      expect(status(out, "apple-url")).toBe("fail");
    }
  });
  it("notices ids put in the wrong place", async () => {
    const out = await checkApple({ ...appleEnv(), APPLE_CLIENT_ID: "ABCDE12345", APPLE_KEY_ID: "short" }, deps({ fetch: apple(() => json({ error: "invalid_grant" }, 400)) }));
    expect(status(out, "apple-id")).toBe("warn");
    expect(status(out, "apple-key-id")).toBe("warn");
  });
  it("says it couldn't reach Apple, which is not the same as the setup being wrong", async () => {
    const out = await checkApple(appleEnv(), deps({ fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch }));
    expect(out.at(-1)).toMatchObject({ id: "apple", status: "fail" });
    expect(out.at(-1)!.detail).toContain("couldn't reach");
  });
});

const githubEnv = { GITHUB_APP_CLIENT_ID: "Iv23abc", GITHUB_APP_CLIENT_SECRET: "s", GITHUB_APP_SLUG: "motif-app", APP_URL: "https://motif.example.org" };
const github = (token: Route, app: Route) => fetcher({ "https://github.com/login/oauth/access_token": token, "https://api.github.com/apps/motif-app": app });
const goodApp = () => json({ client_id: "Iv23abc", permissions: { contents: "write", pull_requests: "write", emails: "read", metadata: "read" } });

describe("the GitHub App", () => {
  it("is skipped without its client id and secret", async () => expect((await checkGithubApp({}, deps()))[0].status).toBe("skip"));
  it("is fine when GitHub knows the pair and the app has the permissions", async () => {
    let body: Record<string, string> = {};
    const out = await checkGithubApp(githubEnv, deps({ fetch: github((_, init) => { body = JSON.parse(String(init?.body)); return json({ error: "bad_verification_code" }); }, goodApp) }));
    expect(failed(out)).toEqual([]);
    expect(status(out, "github")).toBe("ok");
    expect(status(out, "github-slug")).toBe("ok");
    expect(body).toMatchObject({ client_id: "Iv23abc", client_secret: "s", redirect_uri: "https://motif.example.org/api/github/callback" });
  });
  it("fails when GitHub doesn't know the pair", async () => {
    const out = await checkGithubApp(githubEnv, deps({ fetch: github(() => json({ error: "incorrect_client_credentials" }), goodApp) }));
    expect(status(out, "github")).toBe("fail");
  });
  it("fails when the name is of no app, and when it is another app's", async () => {
    const none = await checkGithubApp(githubEnv, deps({ fetch: github(() => json({ error: "bad_verification_code" }), () => json({ message: "Not Found" }, 404)) }));
    expect(status(none, "github-slug")).toBe("fail");
    const other = await checkGithubApp(githubEnv, deps({ fetch: github(() => json({ error: "bad_verification_code" }), () => json({ client_id: "Iv23other", permissions: {} })) }));
    expect(status(other, "github-slug")).toBe("fail");
  });
  it("warns about permissions the app lacks", async () => {
    const out = await checkGithubApp(githubEnv, deps({ fetch: github(() => json({ error: "bad_verification_code" }), () => json({ client_id: "Iv23abc", permissions: { contents: "read", pull_requests: "write" } })) }));
    const c = out.find((x) => x.id === "github-slug")!;
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("Contents: Read and write");
    expect(c.detail).toContain("Email addresses");
    expect(c.detail).not.toContain("Pull requests");
  });
  it("doesn't call a refusal to answer a wrong setup", async () => {
    const out = await checkGithubApp(githubEnv, deps({ fetch: github(() => json({}, 403), () => json({}, 403)) }));
    expect(failed(out)).toEqual([]);
    expect(status(out, "github")).toBe("warn");
    expect(status(out, "github-slug")).toBe("warn");
  });
});
