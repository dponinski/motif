import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE as GITHUB_COOKIE, decodeSession as decodeGitHub, readConfig as readGitHubConfig, revokeToken } from "@/lib/github-oauth";
import { clearCookie as clearGitHubCookie } from "@/lib/github-oauth-http";
import { SESSION_COOKIE, authOf, clearSessionCookie, fromThisApp, isSecure } from "@/lib/auth/http";
import { deleteSession } from "@/lib/auth/store";

// Signs out: the session is ended in the database, not just forgotten by the browser, and the GitHub sign-in that
// came with it goes too (its token is revoked at GitHub) so nothing is left behind on a computer someone else uses.
export async function POST(req: NextRequest) {
  const auth = await authOf();
  if (!auth) return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  if (!fromThisApp(req, auth.config)) return NextResponse.json({ error: "Not from this app" }, { status: 400 });
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(auth.db, token);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const secure = isSecure(req, auth.config);
  clearSessionCookie(res, secure);

  const github = readGitHubConfig();
  const gh = decodeGitHub(req.cookies.get(GITHUB_COOKIE)?.value);
  if (github && gh) {
    await revokeToken(github, gh.access);
    clearGitHubCookie(res, GITHUB_COOKIE, secure);
  }
  return res;
}
