import { NextRequest, NextResponse } from "next/server";
import {
  OAuthError, SESSION_COOKIE, canRefresh, decodeSession, installUrl, needsRefresh, readConfig, refreshShared,
} from "@/lib/github-oauth";
import { clearCookie, fromThisApp, isSecure, setSession } from "@/lib/github-oauth-http";

const noStore = { "Cache-Control": "no-store" };

// What the page needs to know: whether signing in is offered, whether this browser is signed in, and if it is, an
// access token that works. A token that is about to stop working is renewed first; `?force=1` renews it anyway,
// for a page that has just been told by GitHub that its token doesn't work.
export async function GET(req: NextRequest) {
  const config = readConfig();
  if (!config) return NextResponse.json({ configured: false, signedIn: false }, { headers: noStore });
  if (!fromThisApp(req)) return NextResponse.json({ error: "Not from this app" }, { status: 400, headers: noStore });

  const secure = isSecure(req, config);
  const base = { configured: true, installUrl: installUrl(config) };
  const out = (body: Record<string, unknown>, status = 200) => NextResponse.json({ ...base, ...body }, { status, headers: noStore });
  const gone = (reason: string) => {
    const res = out({ signedIn: false, reason });
    clearCookie(res, SESSION_COOKIE, secure);
    return res;
  };

  let session = decodeSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return out({ signedIn: false });

  const now = Date.now();
  const force = req.nextUrl.searchParams.get("force") === "1";
  let renewed = false;
  if (force || needsRefresh(session, now)) {
    if (!canRefresh(session, now)) {
      // A token that doesn't expire can't be renewed and doesn't need to be; an expired one can only be signed in again.
      if (session.accessExpires !== null && session.accessExpires <= now) return gone("expired");
      if (force) return gone("expired");
    } else {
      try {
        session = await refreshShared(config, session);
        renewed = true;
      } catch (err) {
        // GitHub saying no means this sign-in is over. GitHub being out of reach says nothing: keep it.
        if (err instanceof OAuthError && err.rejected) return gone("expired");
        return out({ error: "GitHub could not be reached" }, 502);
      }
    }
  }

  const res = out({ signedIn: true, accessToken: session.access, expiresAt: session.accessExpires });
  if (renewed) setSession(res, session, secure, now);
  return res;
}
