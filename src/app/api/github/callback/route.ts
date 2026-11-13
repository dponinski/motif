import { NextRequest, NextResponse } from "next/server";
import { OAuthError, decodeState, exchangeCode, readConfig } from "@/lib/github-oauth";
import { STATE_COOKIE, clearCookie, isSecure, originOf, setSession } from "@/lib/github-oauth-http";

// Where GitHub sends the browser back to. The code it brings is exchanged for tokens here; the browser is then sent
// on to the page it started from, with nothing about the tokens in the address.
export async function GET(req: NextRequest) {
  const config = readConfig();
  if (!config) return NextResponse.json({ error: "Signing in with GitHub isn't set up on this server" }, { status: 503 });
  const origin = originOf(req, config);
  const secure = isSecure(req, config);
  const params = req.nextUrl.searchParams;
  const started = decodeState(req.cookies.get(STATE_COOKIE)?.value);

  const back = (returnTo: string, error?: string) => {
    const url = new URL(returnTo, origin);
    if (error) url.searchParams.set("github_error", error);
    const res = NextResponse.redirect(url);
    clearCookie(res, STATE_COOKIE, secure);
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  // A sign-in that wasn't started here, or has been tampered with, is not finished.
  if (!started || started.state !== params.get("state")) return back("/", "state");
  if (params.get("error")) return back(started.returnTo, params.get("error") === "access_denied" ? "denied" : "failed");
  const code = params.get("code");
  if (!code) return back(started.returnTo, "failed");

  try {
    const session = await exchangeCode(config, code, `${origin}/api/github/callback`);
    const res = back(started.returnTo);
    setSession(res, session, secure);
    return res;
  } catch (err) {
    // What GitHub said, never the code or a token.
    console.error("GitHub sign-in failed:", err instanceof OAuthError ? err.code : "unexpected error");
    return back(started.returnTo, err instanceof OAuthError && !err.rejected ? "unavailable" : "failed");
  }
}
