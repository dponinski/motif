import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, decodeSession, readConfig, revokeToken } from "@/lib/github-oauth";
import { clearCookie, fromThisApp, isSecure } from "@/lib/github-oauth-http";

// Signs out: the cookie goes, and the access token is revoked at GitHub so a copy of it stops working.
export async function POST(req: NextRequest) {
  const config = readConfig();
  if (!config) return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  if (!fromThisApp(req)) return NextResponse.json({ error: "Not from this app" }, { status: 400 });
  const session = decodeSession(req.cookies.get(SESSION_COOKIE)?.value);
  const revoked = session ? await revokeToken(config, session.access) : true;
  const res = NextResponse.json({ ok: true, revoked }, { headers: { "Cache-Control": "no-store" } });
  clearCookie(res, SESSION_COOKIE, isSecure(req, config));
  return res;
}
