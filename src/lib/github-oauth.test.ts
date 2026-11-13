import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OAuthError, authorizeUrl, canRefresh, cookieMaxAge, decodeSession, decodeState, encodeSession, encodeState, exchangeCode, forgetRefreshes,
  installUrl, needsRefresh, readConfig, refreshShared, revokeToken, sanitizeReturnTo, type OAuthConfig, type Session,
} from "./github-oauth";

const config: OAuthConfig = { clientId: "Iv1.abc", clientSecret: "shh", slug: "motif-app", appUrl: null, oauthUrl: "https://github.com", apiUrl: "https://api.github.com" };
const NOW = 1_800_000_000_000;
const session = (extra: Partial<Session> = {}): Session => ({ access: "ghu_a", accessExpires: NOW + 8 * 3600_000, refresh: "ghr_a", refreshExpires: NOW + 180 * 86400_000, ...extra });

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => forgetRefreshes());

describe("configuration", () => {
  it("is there only when the server has the app's id and secret", () => {
    expect(readConfig({})).toBeNull();
    expect(readConfig({ GITHUB_APP_CLIENT_ID: "id" })).toBeNull();
    expect(readConfig({ GITHUB_APP_CLIENT_SECRET: "s" })).toBeNull();
    expect(readConfig({ GITHUB_APP_CLIENT_ID: " ", GITHUB_APP_CLIENT_SECRET: "s" })).toBeNull();
  });

  it("reads the rest, with GitHub's own addresses unless told otherwise", () => {
    expect(readConfig({ GITHUB_APP_CLIENT_ID: "id", GITHUB_APP_CLIENT_SECRET: "s" })).toEqual({
      clientId: "id", clientSecret: "s", slug: null, appUrl: null, oauthUrl: "https://github.com", apiUrl: "https://api.github.com",
    });
    expect(readConfig({ GITHUB_APP_CLIENT_ID: "id", GITHUB_APP_CLIENT_SECRET: "s", GITHUB_APP_SLUG: "my-app", APP_URL: "https://motif.example/", GITHUB_OAUTH_URL: "http://localhost:9/", GITHUB_API_URL: "http://localhost:9" }))
      .toMatchObject({ slug: "my-app", appUrl: "https://motif.example", oauthUrl: "http://localhost:9", apiUrl: "http://localhost:9" });
  });

  it("links to installing the app when it has a name", () => {
    expect(installUrl(config)).toBe("https://github.com/apps/motif-app/installations/new");
    expect(installUrl({ ...config, slug: null })).toBeNull();
  });
});

describe("the cookie", () => {
  it("round-trips a session, with and without expiry", () => {
    for (const s of [session(), session({ accessExpires: null, refresh: null, refreshExpires: null })]) expect(decodeSession(encodeSession(s))).toEqual(s);
  });

  it("is nothing when it is missing, damaged or not a session", () => {
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession("")).toBeNull();
    expect(decodeSession("not base64 json")).toBeNull();
    expect(decodeSession(Buffer.from("{}").toString("base64url"))).toBeNull();
    expect(decodeSession(Buffer.from(JSON.stringify({ a: 5, ae: null, r: null, re: null })).toString("base64url"))).toBeNull();
    expect(decodeSession(Buffer.from(JSON.stringify({ a: "x", ae: "soon", r: null, re: null })).toString("base64url"))).toBeNull();
    expect(decodeSession(Buffer.from(JSON.stringify({ a: "x", ae: null, r: 7, re: null })).toString("base64url"))).toBeNull();
  });

  it("lives as long as the sign-in can be renewed, and at most a year", () => {
    expect(cookieMaxAge(session(), NOW)).toBe(180 * 86400);
    expect(cookieMaxAge(session({ accessExpires: null, refresh: null, refreshExpires: null }), NOW)).toBe(365 * 86400);
    expect(cookieMaxAge(session({ refresh: null, refreshExpires: null, accessExpires: NOW + 3600_000 }), NOW)).toBe(3600);
    expect(cookieMaxAge(session({ refreshExpires: NOW + 900 * 86400_000 }), NOW)).toBe(365 * 86400);
    expect(cookieMaxAge(session({ refreshExpires: NOW - 1 }), NOW)).toBe(0);
  });

  it("says when a token needs renewing and when it can be", () => {
    expect(needsRefresh(session(), NOW)).toBe(false);
    expect(needsRefresh(session({ accessExpires: NOW + 4 * 60_000 }), NOW)).toBe(true);
    expect(needsRefresh(session({ accessExpires: null }), NOW)).toBe(false);
    expect(canRefresh(session(), NOW)).toBe(true);
    expect(canRefresh(session({ refresh: null }), NOW)).toBe(false);
    expect(canRefresh(session({ refreshExpires: NOW - 1 }), NOW)).toBe(false);
    expect(canRefresh(session({ refreshExpires: null }), NOW)).toBe(true);
  });
});

describe("where to go back to", () => {
  it("is a path on this site and nothing else", () => {
    expect(sanitizeReturnTo("/editor/abc")).toBe("/editor/abc");
    expect(sanitizeReturnTo("/?a=b#c")).toBe("/?a=b#c");
    for (const bad of [null, undefined, "", "editor", "https://evil.test/", "//evil.test", "/\\evil.test", "/a\nb", "/" + "x".repeat(400), "javascript:alert(1)"]) expect(sanitizeReturnTo(bad)).toBe("/");
  });

  it("is kept with the state, and read back the same", () => {
    expect(decodeState(encodeState("abc", "/editor/x"))).toEqual({ state: "abc", returnTo: "/editor/x" });
    expect(decodeState(encodeState("abc", "https://evil.test"))).toEqual({ state: "abc", returnTo: "/" });
    expect(decodeState(undefined)).toBeNull();
    expect(decodeState("garbage")).toBeNull();
    expect(decodeState(Buffer.from(JSON.stringify({ s: "" })).toString("base64url"))).toBeNull();
  });

  it("builds GitHub's address for approving the app", () => {
    const url = new URL(authorizeUrl(config, "https://motif.example/api/github/callback", "st4te"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "Iv1.abc", redirect_uri: "https://motif.example/api/github/callback", state: "st4te" });
  });
});

describe("the tokens", () => {
  it("exchanges the code for a session, and says when it ends", async () => {
    const fetchImpl = vi.fn(async () => reply({ access_token: "ghu_x", expires_in: 28800, refresh_token: "ghr_x", refresh_token_expires_in: 15897600, token_type: "bearer" }));
    const s = await exchangeCode(config, "the-code", "https://motif.example/api/github/callback", fetchImpl as unknown as typeof fetch, NOW);
    expect(s).toEqual({ access: "ghu_x", accessExpires: NOW + 28800_000, refresh: "ghr_x", refreshExpires: NOW + 15897600_000 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(JSON.parse(init.body as string)).toEqual({ client_id: "Iv1.abc", client_secret: "shh", code: "the-code", redirect_uri: "https://motif.example/api/github/callback" });
  });

  it("takes a token that doesn't expire", async () => {
    const fetchImpl = async () => reply({ access_token: "ghu_forever", token_type: "bearer" });
    expect(await exchangeCode(config, "c", "r", fetchImpl as unknown as typeof fetch, NOW)).toEqual({ access: "ghu_forever", accessExpires: null, refresh: null, refreshExpires: null });
  });

  it("says no when GitHub does, even though GitHub answers 200", async () => {
    const fetchImpl = async () => reply({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." });
    const err = await exchangeCode(config, "c", "r", fetchImpl as unknown as typeof fetch).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err).toMatchObject({ code: "bad_verification_code", rejected: true });
  });

  it("tells GitHub being out of reach from GitHub saying no", async () => {
    for (const fetchImpl of [async () => { throw new TypeError("network"); }, async () => reply({}, 502)]) {
      const err = await exchangeCode(config, "c", "r", fetchImpl as unknown as typeof fetch).catch((e) => e);
      expect(err).toMatchObject({ code: "unavailable", rejected: false });
    }
  });

  it("renews with the refresh token", async () => {
    const fetchImpl = vi.fn(async () => reply({ access_token: "ghu_2", expires_in: 28800, refresh_token: "ghr_2", refresh_token_expires_in: 15897600 }));
    const next = await refreshShared(config, session(), fetchImpl as unknown as typeof fetch, NOW);
    expect(next.access).toBe("ghu_2");
    expect(next.refresh).toBe("ghr_2");
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ grant_type: "refresh_token", refresh_token: "ghr_a", client_secret: "shh" });
  });

  it("renews once when several ask with the same refresh token, then for a minute gives them the same new session", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return reply({ access_token: `ghu_${calls}`, expires_in: 28800, refresh_token: `ghr_${calls}`, refresh_token_expires_in: 15897600 }); };
    const f = fetchImpl as unknown as typeof fetch;
    const [a, b] = await Promise.all([refreshShared(config, session(), f, NOW), refreshShared(config, session(), f, NOW)]);
    expect(a).toEqual(b);
    // A tab that still holds the old cookie asks a moment later.
    const c = await refreshShared(config, session(), f, NOW + 20_000);
    expect(c).toEqual(a);
    expect(calls).toBe(1);
    // After that the old token is just an old token, and GitHub is asked again (and refuses).
    await refreshShared(config, session(), f, NOW + 120_000);
    expect(calls).toBe(2);
  });

  it("doesn't remember a refresh that failed", async () => {
    let calls = 0;
    const f = (async () => { calls++; return calls === 1 ? reply({ error: "bad_refresh_token" }) : reply({ access_token: "ghu_ok", expires_in: 28800, refresh_token: "ghr_ok", refresh_token_expires_in: 1000 }); }) as unknown as typeof fetch;
    await expect(refreshShared(config, session(), f, NOW)).rejects.toMatchObject({ code: "bad_refresh_token" });
    await expect(refreshShared(config, session(), f, NOW)).resolves.toMatchObject({ access: "ghu_ok" });
  });

  it("revokes the access token with the app's own credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await revokeToken(config, "ghu_a", fetchImpl as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/applications/Iv1.abc/token");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("Iv1.abc:shh").toString("base64")}`);
    expect(JSON.parse(init.body as string)).toEqual({ access_token: "ghu_a" });
    expect(await revokeToken(config, "x", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe(false);
    expect(await revokeToken(config, "x", (async () => new Response(null, { status: 401 })) as unknown as typeof fetch)).toBe(false);
  });
});
