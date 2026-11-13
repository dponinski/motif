import type { NextRequest } from "next/server";
import { SESSION_COOKIE, STATE_COOKIE, cookieMaxAge, type OAuthConfig, type Session, encodeSession } from "./github-oauth";

// The parts of the sign-in routes that are about the request.

// Where this site is, as GitHub will send the browser back to it. It has to be exactly the callback URL that was
// given to the app, so a server behind a proxy can say so with APP_URL.
export function originOf(req: NextRequest, config: OAuthConfig): string {
  if (config.appUrl) return config.appUrl;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (host && proto) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

export const isSecure = (req: NextRequest, config: OAuthConfig) => originOf(req, config).startsWith("https:");

// A cookie only these routes can see, that the page's scripts can't read, and that other sites can't make the
// browser send.
export const cookieOptions = (secure: boolean, maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/api/github", maxAge });

export function setSession(res: { cookies: { set: (name: string, value: string, opts: ReturnType<typeof cookieOptions>) => unknown } }, session: Session, secure: boolean, now = Date.now()) {
  res.cookies.set(SESSION_COOKIE, encodeSession(session), cookieOptions(secure, cookieMaxAge(session, now)));
}

export function clearCookie(res: { cookies: { set: (name: string, value: string, opts: ReturnType<typeof cookieOptions>) => unknown } }, name: string, secure: boolean) {
  res.cookies.set(name, "", cookieOptions(secure, 0));
}

// The browser's own scripts send this; another site's can't without the browser asking us first.
export const fromThisApp = (req: NextRequest) => req.headers.get("x-requested-with") === "motif";

export { SESSION_COOKIE, STATE_COOKIE };
