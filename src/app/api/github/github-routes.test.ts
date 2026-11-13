import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { forgetRefreshes, decodeSession, encodeSession, encodeState, type Session } from "@/lib/github-oauth";
import { GET as login } from "./login/route";
import { GET as callback } from "./callback/route";
import { GET as sessionRoute } from "./session/route";
import { POST as logout } from "./logout/route";

const ENV = { GITHUB_APP_CLIENT_ID: "Iv1.abc", GITHUB_APP_CLIENT_SECRET: "shh", GITHUB_APP_SLUG: "motif-app", APP_URL: "https://motif.example", GITHUB_OAUTH_URL: "https://github.test", GITHUB_API_URL: "https://api.github.test" };
const saved = { ...process.env };

const req = (path: string, init: { headers?: Record<string, string>; cookie?: string; method?: string } = {}) =>
  new NextRequest(`https://motif.example${path}`, { method: init.method, headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers } });
const app = { "x-requested-with": "motif" };
const cookieOf = (res: Response, name: string) => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line ? { value: decodeURIComponent(line.split(";")[0].slice(name.length + 1)), line } : null;
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const live = (extra: Partial<Session> = {}): Session => ({ access: "ghu_old", accessExpires: Date.now() + 8 * 3600_000, refresh: "ghr_old", refreshExpires: Date.now() + 100 * 86400_000, ...extra });
const withSession = (s: Session) => `motif_gh=${encodeSession(s)}`;

let github: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(process.env, ENV);
  github = vi.fn(async () => reply({ error: "unexpected" }, 500));
  vi.stubGlobal("fetch", github);
  forgetRefreshes();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(ENV)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("without the app's credentials", () => {
  beforeEach(() => { for (const key of Object.keys(ENV)) delete process.env[key]; });

  it("offers nothing, and says so", async () => {
    const res = await sessionRoute(req("/api/github/session", { headers: app }));
    expect(await res.json()).toEqual({ configured: false, signedIn: false });
    expect((await login(req("/api/github/login"))).status).toBe(503);
    expect((await callback(req("/api/github/callback?code=c&state=s"))).status).toBe(503);
  });
});

describe("starting", () => {
  it("sends the browser to GitHub with a state it will check, from the registered address", async () => {
    const res = await login(req("/api/github/login?returnTo=/editor/abc"));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://github.test/login/oauth/authorize");
    expect(to.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(to.searchParams.get("redirect_uri")).toBe("https://motif.example/api/github/callback");
    const state = to.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(20);
    const kept = cookieOf(res, "motif_gh_state")!;
    expect(Buffer.from(kept.value, "base64url").toString()).toBe(JSON.stringify({ s: state, to: "/editor/abc" }));
    expect(kept.line).toMatch(/HttpOnly/i);
    expect(kept.line).toMatch(/SameSite=lax/i);
    expect(kept.line).toMatch(/Secure/i);
    expect(kept.line).toMatch(/Path=\/api\/github/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("makes a new state each time, and sends nowhere but this site afterwards", async () => {
    const a = new URL((await login(req("/api/github/login"))).headers.get("location")!).searchParams.get("state");
    const b = new URL((await login(req("/api/github/login"))).headers.get("location")!).searchParams.get("state");
    expect(a).not.toBe(b);
    const res = await login(req("/api/github/login?returnTo=https://evil.test/"));
    expect(Buffer.from(cookieOf(res, "motif_gh_state")!.value, "base64url").toString()).toContain('"to":"/"');
  });

  it("isn't Secure on plain http, as when it is run locally", async () => {
    process.env.APP_URL = "http://localhost:3000";
    const res = await login(req("/api/github/login"));
    expect(cookieOf(res, "motif_gh_state")!.line).not.toMatch(/Secure/i);
    expect(new URL(res.headers.get("location")!).searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/github/callback");
  });
});

describe("coming back", () => {
  const started = (state = "good-state", to = "/editor/abc") => `motif_gh_state=${encodeState(state, to)}`;

  it("finishes a sign-in that was started here: the tokens go in a cookie, not the address", async () => {
    github.mockResolvedValueOnce(reply({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new", refresh_token_expires_in: 15897600 }));
    const res = await callback(req("/api/github/callback?code=the-code&state=good-state", { cookie: started() }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://motif.example/editor/abc");
    const session = decodeSession(cookieOf(res, "motif_gh")!.value)!;
    expect(session).toMatchObject({ access: "ghu_new", refresh: "ghr_new" });
    expect(cookieOf(res, "motif_gh")!.line).toMatch(/HttpOnly/i);
    expect(cookieOf(res, "motif_gh")!.line).toMatch(/Max-Age=15897\d{3}/);
    expect(res.headers.get("location")).not.toContain("ghu_");
    expect(cookieOf(res, "motif_gh_state")!.line).toMatch(/Max-Age=0/);
    const [url, init] = github.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://github.test/login/oauth/access_token");
    expect(JSON.parse(init.body as string)).toMatchObject({ client_id: "Iv1.abc", client_secret: "shh", code: "the-code", redirect_uri: "https://motif.example/api/github/callback" });
  });

  it("is not finished when the state isn't the one that was started with, or there was none", async () => {
    for (const cookie of [started("other"), undefined]) {
      const res = await callback(req("/api/github/callback?code=c&state=good-state", { cookie }));
      expect(res.headers.get("location")).toBe("https://motif.example/?github_error=state");
      expect(cookieOf(res, "motif_gh")).toBeNull();
    }
    expect(github).not.toHaveBeenCalled();
    const noState = await callback(req("/api/github/callback?code=c", { cookie: started() }));
    expect(noState.headers.get("location")).toContain("github_error=state");
  });

  it("goes back to the page with what happened when the person said no, or GitHub failed", async () => {
    const denied = await callback(req("/api/github/callback?error=access_denied&state=good-state", { cookie: started() }));
    expect(denied.headers.get("location")).toBe("https://motif.example/editor/abc?github_error=denied");
    const failed = await callback(req("/api/github/callback?error=redirect_uri_mismatch&state=good-state", { cookie: started() }));
    expect(failed.headers.get("location")).toContain("github_error=failed");
    const noCode = await callback(req("/api/github/callback?state=good-state", { cookie: started() }));
    expect(noCode.headers.get("location")).toContain("github_error=failed");
    expect(github).not.toHaveBeenCalled();
  });

  it("says so when the code was refused, or GitHub couldn't be reached, and sets no session", async () => {
    github.mockResolvedValueOnce(reply({ error: "bad_verification_code" }));
    const refused = await callback(req("/api/github/callback?code=c&state=good-state", { cookie: started() }));
    expect(refused.headers.get("location")).toContain("github_error=failed");
    expect(cookieOf(refused, "motif_gh")).toBeNull();
    github.mockRejectedValueOnce(new TypeError("network"));
    const down = await callback(req("/api/github/callback?code=c&state=good-state", { cookie: started() }));
    expect(down.headers.get("location")).toContain("github_error=unavailable");
  });

  it("keeps a token and the code out of the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    github.mockResolvedValueOnce(reply({ error: "bad_verification_code", error_description: "ghu_secret in here" }));
    await callback(req("/api/github/callback?code=secret-code&state=good-state", { cookie: started() }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret/);
    log.mockRestore();
  });
});

describe("the session", () => {
  it("is signed out without a cookie, and says whether the app can be installed", async () => {
    const res = await sessionRoute(req("/api/github/session", { headers: app }));
    expect(await res.json()).toEqual({ configured: true, installUrl: "https://github.test/apps/motif-app/installations/new", signedIn: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is only for this app's own scripts", async () => {
    const res = await sessionRoute(req("/api/github/session", { cookie: withSession(live()) }));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("ghu_");
  });

  it("gives the access token, as long as it will keep working for a while", async () => {
    const s = live();
    const res = await sessionRoute(req("/api/github/session", { headers: app, cookie: withSession(s) }));
    expect(await res.json()).toMatchObject({ configured: true, signedIn: true, accessToken: "ghu_old", expiresAt: s.accessExpires });
    expect(github).not.toHaveBeenCalled();
    expect(cookieOf(res, "motif_gh")).toBeNull();
  });

  it("renews a token that is about to stop working, and keeps the new tokens in the cookie", async () => {
    github.mockResolvedValueOnce(reply({ access_token: "ghu_fresh", expires_in: 28800, refresh_token: "ghr_fresh", refresh_token_expires_in: 15897600 }));
    const res = await sessionRoute(req("/api/github/session", { headers: app, cookie: withSession(live({ accessExpires: Date.now() + 60_000 })) }));
    expect(await res.json()).toMatchObject({ signedIn: true, accessToken: "ghu_fresh" });
    expect(decodeSession(cookieOf(res, "motif_gh")!.value)).toMatchObject({ access: "ghu_fresh", refresh: "ghr_fresh" });
    expect(JSON.parse((github.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({ grant_type: "refresh_token", refresh_token: "ghr_old" });
  });

  it("renews on request, for a page whose token GitHub has refused", async () => {
    github.mockResolvedValueOnce(reply({ access_token: "ghu_fresh", expires_in: 28800, refresh_token: "ghr_fresh", refresh_token_expires_in: 15897600 }));
    const res = await sessionRoute(req("/api/github/session?force=1", { headers: app, cookie: withSession(live()) }));
    expect(await res.json()).toMatchObject({ accessToken: "ghu_fresh" });
  });

  it("answers two requests with the same old cookie with the same new token, and signs nobody out", async () => {
    github.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); return reply({ access_token: "ghu_fresh", expires_in: 28800, refresh_token: "ghr_fresh", refresh_token_expires_in: 15897600 }); });
    const cookie = withSession(live({ accessExpires: Date.now() + 60_000 }));
    const [a, b] = await Promise.all([sessionRoute(req("/api/github/session", { headers: app, cookie })), sessionRoute(req("/api/github/session", { headers: app, cookie }))]);
    expect(await a.json()).toMatchObject({ signedIn: true, accessToken: "ghu_fresh" });
    expect(await b.json()).toMatchObject({ signedIn: true, accessToken: "ghu_fresh" });
    expect(github).toHaveBeenCalledTimes(1);
  });

  it("is signed out, and the cookie goes, when GitHub refuses the refresh token", async () => {
    github.mockResolvedValueOnce(reply({ error: "bad_refresh_token" }));
    const res = await sessionRoute(req("/api/github/session", { headers: app, cookie: withSession(live({ accessExpires: Date.now() - 1000 })) }));
    expect(await res.json()).toMatchObject({ configured: true, signedIn: false, reason: "expired" });
    expect(cookieOf(res, "motif_gh")!.line).toMatch(/Max-Age=0/);
  });

  it("is signed out when the token has expired and can't be renewed", async () => {
    const res = await sessionRoute(req("/api/github/session", { headers: app, cookie: withSession(live({ accessExpires: Date.now() - 1000, refresh: null, refreshExpires: null })) }));
    expect(await res.json()).toMatchObject({ signedIn: false, reason: "expired" });
    expect(github).not.toHaveBeenCalled();
  });

  it("stays signed in when GitHub can't be reached, and says so", async () => {
    github.mockRejectedValueOnce(new TypeError("network"));
    const res = await sessionRoute(req("/api/github/session", { headers: app, cookie: withSession(live({ accessExpires: Date.now() + 60_000 })) }));
    expect(res.status).toBe(502);
    expect(cookieOf(res, "motif_gh")).toBeNull();
  });

  it("gives a token that doesn't expire as it is", async () => {
    const res = await sessionRoute(req("/api/github/session", { headers: app, cookie: withSession({ access: "ghu_forever", accessExpires: null, refresh: null, refreshExpires: null }) }));
    expect(await res.json()).toMatchObject({ signedIn: true, accessToken: "ghu_forever", expiresAt: null });
  });

  it("is signed out for a cookie that isn't one", async () => {
    const res = await sessionRoute(req("/api/github/session", { headers: app, cookie: "motif_gh=garbage" }));
    expect(await res.json()).toMatchObject({ signedIn: false });
  });
});

describe("signing out", () => {
  it("revokes the token at GitHub and clears the cookie", async () => {
    github.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await logout(req("/api/github/logout", { method: "POST", headers: app, cookie: withSession(live()) }));
    expect(await res.json()).toEqual({ ok: true, revoked: true });
    expect(cookieOf(res, "motif_gh")!.line).toMatch(/Max-Age=0/);
    const [url, init] = github.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.test/applications/Iv1.abc/token");
    expect(JSON.parse(init.body as string)).toEqual({ access_token: "ghu_old" });
  });

  it("signs out even when GitHub can't be told", async () => {
    github.mockRejectedValueOnce(new TypeError("network"));
    const res = await logout(req("/api/github/logout", { method: "POST", headers: app, cookie: withSession(live()) }));
    expect(await res.json()).toEqual({ ok: true, revoked: false });
    expect(cookieOf(res, "motif_gh")!.line).toMatch(/Max-Age=0/);
  });

  it("is only for this app's own scripts", async () => {
    const res = await logout(req("/api/github/logout", { method: "POST", cookie: withSession(live()) }));
    expect(res.status).toBe(400);
    expect(github).not.toHaveBeenCalled();
  });
});
