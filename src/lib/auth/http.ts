import type { NextRequest } from "next/server";
import { sanitizeReturnTo } from "../github-oauth";
import { readAuthConfig, type AuthConfig } from "./config";
import { getDb, type Db } from "./db";
import { isAllowed } from "./allowlist";
import { getSession, hit, type User } from "./store";

// The parts of the account routes that are about the request: cookies, who is asking, where this site is.

export const SESSION_COOKIE = "motif_session";
export const FLOW_COOKIE = "motif_auth_flow";

export { sanitizeReturnTo };

// Where this site is, as providers will send the browser back to it: it has to match what they were told.
export function originOf(req: NextRequest, config: Pick<AuthConfig, "appUrl">): string {
  if (config.appUrl) return config.appUrl;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (host && proto) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

export const isSecure = (req: NextRequest, config: Pick<AuthConfig, "appUrl">) => originOf(req, config).startsWith("https:");

export const cookieOptions = (secure: boolean, maxAge: number, extra: { path?: string; sameSite?: "lax" | "none" | "strict" } = {}) => ({
  httpOnly: true,
  secure,
  sameSite: extra.sameSite ?? ("lax" as const),
  path: extra.path ?? "/",
  maxAge,
});

type CookieJar = { cookies: { set: (name: string, value: string, opts: ReturnType<typeof cookieOptions>) => unknown } };

export const setSessionCookie = (res: CookieJar, token: string, expiresAt: number, secure: boolean, now = Date.now()) =>
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(secure, Math.max(0, Math.floor((expiresAt - now) / 1000))));
export const clearSessionCookie = (res: CookieJar, secure: boolean) => res.cookies.set(SESSION_COOKIE, "", cookieOptions(secure, 0));

// A request that changes something must come from this app's own scripts, and from this site if it says where from:
// another site can't make the browser send the header without asking first, and the origin is not forged by pages.
export function fromThisApp(req: NextRequest, config: Pick<AuthConfig, "appUrl">): boolean {
  if (req.headers.get("x-requested-with") !== "motif") return false;
  const origin = req.headers.get("origin");
  return !origin || origin === originOf(req, config);
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export interface Auth { config: AuthConfig; db: Db }

// The accounts of this server, or null when it has none.
export async function authOf(env: Record<string, string | undefined> = process.env): Promise<Auth | null> {
  const config = readAuthConfig(env);
  if (!config) return null;
  return { config, db: await getDb(config.databaseUrl) };
}

// Who is signed in, for a request. The list of who may sign in is checked again each time, so taking someone off it
// ends their access at once, and a session that is not theirs any more is nothing.
export async function currentUser(req: NextRequest, auth: Auth, now = Date.now()): Promise<{ user: User; expiresAt: number } | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await getSession(auth.db, token, now);
  if (!session || !isAllowed(session.user.email, auth.config.allowed)) return null;
  return session;
}

// Counts a use of something that is limited, and says whether it is allowed. The count is kept in the database, so
// it holds across restarts and several servers.
export async function limited(auth: Auth, bucket: string, limit: number, windowMs: number): Promise<{ ok: boolean; resetsAt: number }> {
  if (limit <= 0) return { ok: true, resetsAt: 0 };
  const { ok, resetsAt } = await hit(auth.db, bucket, limit, windowMs);
  return { ok, resetsAt };
}
