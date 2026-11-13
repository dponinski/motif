// Signing in with a GitHub App, on the server. The browser is sent to GitHub to approve, GitHub sends it back
// with a code, and the code is exchanged for a token here, because the exchange needs the app's client secret,
// which must never reach the browser. The tokens are kept in a cookie the page's scripts can't read; the
// browser gets the access token (which lasts hours) from /api/github/session and holds it in memory only.
// Refreshing needs the client secret too, so a refresh token alone is of no use to anyone who gets hold of it.

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  // The app's URL name, for the link to install it on more repositories.
  slug: string | null;
  // Where this site is served, when the request can't say (behind a proxy that doesn't forward its host).
  appUrl: string | null;
  // GitHub's addresses. Only a test points them anywhere else.
  oauthUrl: string;
  apiUrl: string;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

// Null unless the server has been given the app's client id and secret: then sign-in isn't offered.
export function readConfig(env: Record<string, string | undefined> = process.env): OAuthConfig | null {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    slug: env.GITHUB_APP_SLUG?.trim() || null,
    appUrl: env.APP_URL?.trim() ? trimSlash(env.APP_URL.trim()) : null,
    oauthUrl: trimSlash(env.GITHUB_OAUTH_URL?.trim() || "https://github.com"),
    apiUrl: trimSlash(env.GITHUB_API_URL?.trim() || "https://api.github.com"),
  };
}

export const installUrl = (config: OAuthConfig) => (config.slug ? `${config.oauthUrl}/apps/${encodeURIComponent(config.slug)}/installations/new` : null);

// ── What the cookie holds ─────────────────────────────────────────────────────

export interface Session {
  access: string;
  // When the access token stops working, in ms; null when the app's tokens don't expire.
  accessExpires: number | null;
  refresh: string | null;
  refreshExpires: number | null;
}

export const SESSION_COOKIE = "motif_gh";
export const STATE_COOKIE = "motif_gh_state";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url").toString("utf8");

export const encodeSession = (s: Session) => b64(JSON.stringify({ a: s.access, ae: s.accessExpires, r: s.refresh, re: s.refreshExpires }));

const maybeTime = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function decodeSession(text: string | undefined | null): Session | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(unb64(text)) as Record<string, unknown>;
    const accessExpires = maybeTime(raw.ae);
    const refreshExpires = maybeTime(raw.re);
    if (typeof raw.a !== "string" || !raw.a || accessExpires === undefined || refreshExpires === undefined) return null;
    if (raw.r !== null && typeof raw.r !== "string") return null;
    return { access: raw.a, accessExpires, refresh: (raw.r as string | null) || null, refreshExpires };
  } catch {
    return null;
  }
}

// How long the cookie should live: as long as the session can be renewed, and at most a year.
export function cookieMaxAge(s: Session, now: number): number {
  const until = s.refresh ? s.refreshExpires : s.accessExpires;
  const seconds = until === null ? 365 * 86400 : Math.floor((until - now) / 1000);
  return Math.max(0, Math.min(seconds, 365 * 86400));
}

export const needsRefresh = (s: Session, now: number, margin = 5 * 60_000) => s.accessExpires !== null && s.accessExpires - now < margin;
export const canRefresh = (s: Session, now: number) => !!s.refresh && (s.refreshExpires === null || s.refreshExpires > now);

// ── Where to go back to ───────────────────────────────────────────────────────

// A path on this site, so the sign-in can't be used to send someone elsewhere.
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if ([...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return "/";
  return value.length > 300 ? "/" : value;
}

// What a sign-in is for: only to use the person's repositories ("connect"), or also to sign them in to Motif ("login").
export type Purpose = "connect" | "login";

export const encodeState = (state: string, returnTo: string, purpose: Purpose = "connect") => b64(JSON.stringify({ s: state, to: returnTo, ...(purpose === "login" ? { for: "login" } : {}) }));

export function decodeState(text: string | undefined | null): { state: string; returnTo: string; purpose: Purpose } | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(unb64(text)) as { s?: unknown; to?: unknown; for?: unknown };
    return typeof raw.s === "string" && raw.s ? { state: raw.s, returnTo: sanitizeReturnTo(typeof raw.to === "string" ? raw.to : "/"), purpose: raw.for === "login" ? "login" : "connect" } : null;
  } catch {
    return null;
  }
}

export function newState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function authorizeUrl(config: OAuthConfig, redirectUri: string, state: string): string {
  const url = new URL(`${config.oauthUrl}/login/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

// ── Talking to GitHub ─────────────────────────────────────────────────────────

export class OAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
  // GitHub said no: the code or refresh token is wrong, used already, expired or revoked. Anything else (GitHub
  // being down, the network) says nothing about whether the sign-in is still good.
  get rejected() {
    return this.code !== "unavailable";
  }
}

type Fetch = typeof fetch;

async function tokenRequest(config: OAuthConfig, body: Record<string, string>, fetchImpl: Fetch, now: number): Promise<Session> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.oauthUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...body }),
      cache: "no-store",
    });
  } catch {
    throw new OAuthError("unavailable", "GitHub could not be reached");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status >= 500) throw new OAuthError("unavailable", `GitHub answered ${res.status}`);
  if (!json || typeof json.error === "string" || typeof json.access_token !== "string") {
    throw new OAuthError(typeof json?.error === "string" ? json.error : "bad_response", typeof json?.error_description === "string" ? json.error_description : "GitHub did not give a token");
  }
  const seconds = (v: unknown) => (typeof v === "number" && v > 0 ? now + v * 1000 : null);
  return {
    access: json.access_token,
    accessExpires: seconds(json.expires_in),
    refresh: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : null,
    refreshExpires: seconds(json.refresh_token_expires_in),
  };
}

export const exchangeCode = (config: OAuthConfig, code: string, redirectUri: string, fetchImpl: Fetch = fetch, now = Date.now()) =>
  tokenRequest(config, { code, redirect_uri: redirectUri }, fetchImpl, now);

export const refreshSession = (config: OAuthConfig, session: Session, fetchImpl: Fetch = fetch, now = Date.now()) =>
  tokenRequest(config, { grant_type: "refresh_token", refresh_token: session.refresh ?? "" }, fetchImpl, now);

// GitHub gives a refresh token once: using it replaces it. Two requests that carry the same one (two tabs, or a
// page that asks twice) would otherwise race, and the loser would find its token dead and sign the person out.
// So a refresh in flight is shared, and for a minute afterwards the same old token gets the same new session.
const inflight = new Map<string, Promise<Session>>();
const rotated = new Map<string, { session: Session; at: number }>();
const KEEP = 60_000;

export function refreshShared(config: OAuthConfig, session: Session, fetchImpl: Fetch = fetch, now = Date.now()): Promise<Session> {
  const key = session.refresh!;
  for (const [k, v] of rotated) if (now - v.at > KEEP || rotated.size > 200) rotated.delete(k);
  const done = rotated.get(key);
  if (done) return Promise.resolve(done.session);
  let pending = inflight.get(key);
  if (!pending) {
    pending = refreshSession(config, session, fetchImpl, now)
      .then((next) => { rotated.set(key, { session: next, at: now }); return next; })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, pending);
  }
  return pending;
}

export function forgetRefreshes() {
  inflight.clear();
  rotated.clear();
}

// Ends the grant at GitHub, so a token that was copied out of a browser stops working.
export async function revokeToken(config: OAuthConfig, access: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${config.apiUrl}/applications/${encodeURIComponent(config.clientId)}/token`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({ access_token: access }),
      cache: "no-store",
    });
    return res.status === 204 || res.status === 404;
  } catch {
    return false;
  }
}
