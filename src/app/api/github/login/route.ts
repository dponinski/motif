import { NextRequest, NextResponse } from "next/server";
import { readAuthConfig } from "@/lib/auth/config";
import { STATE_COOKIE, authorizeUrl, encodeState, newState, readConfig, sanitizeReturnTo } from "@/lib/github-oauth";
import { cookieOptions, isSecure, originOf } from "@/lib/github-oauth-http";

// Sends the browser to GitHub to approve the app. The state that GitHub will hand back is kept in a cookie, so the
// callback can tell that the sign-in it is finishing is one that was started here, in this browser.
export async function GET(req: NextRequest) {
  const config = readConfig();
  if (!config) return NextResponse.json({ error: "Signing in with GitHub isn't set up on this server" }, { status: 503 });
  const state = newState();
  const returnTo = sanitizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  // Signing in to Motif with GitHub (not just connecting repositories) is only for a server that has accounts.
  const purpose = req.nextUrl.searchParams.get("purpose") === "login" && readAuthConfig() ? "login" : "connect";
  const res = NextResponse.redirect(authorizeUrl(config, `${originOf(req, config)}/api/github/callback`, state));
  res.cookies.set(STATE_COOKIE, encodeState(state, returnTo, purpose), cookieOptions(isSecure(req, config), 600));
  res.headers.set("Cache-Control", "no-store");
  return res;
}
