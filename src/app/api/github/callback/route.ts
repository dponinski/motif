import { NextRequest, NextResponse } from "next/server";
import { signedIn } from "@/lib/auth/flows";
import { githubLogin } from "@/lib/auth/github-login";
import { authOf } from "@/lib/auth/http";
import { OAuthError, decodeState, exchangeCode, readConfig, revokeToken } from "@/lib/github-oauth";
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

    // Signing in to Motif as well: GitHub says who this is, and the sign-in only goes through for someone who may.
    if (started.purpose === "login") {
      const auth = await authOf();
      if (!auth) return back(started.returnTo, "failed");
      const result = await githubLogin(auth.db, auth.config.allowed, config, session.access);
      if (!result.ok) {
        await revokeToken(config, session.access);
        const reason = result.reason === "no-verified-email" ? "github-email" : result.reason;
        const res = NextResponse.redirect(new URL(`${started.returnTo}${started.returnTo.includes("?") ? "&" : "?"}auth_error=${reason}`, origin));
        clearCookie(res, STATE_COOKIE, secure);
        res.headers.set("Cache-Control", "no-store");
        return res;
      }
      return signedIn(req, auth, result.user.id, started.returnTo, 307, (res) => {
        setSession(res, session, secure);
        clearCookie(res, STATE_COOKIE, secure);
      });
    }

    const res = back(started.returnTo);
    setSession(res, session, secure);
    return res;
  } catch (err) {
    // What GitHub said, never the code or a token.
    console.error("GitHub sign-in failed:", err instanceof OAuthError ? err.code : "unexpected error");
    return back(started.returnTo, err instanceof OAuthError && !err.rejected ? "unavailable" : "failed");
  }
}
