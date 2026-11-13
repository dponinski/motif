import { NextRequest, NextResponse } from "next/server";
import { isAllowed } from "@/lib/auth/allowlist";
import { authOf, clientIp, fromThisApp, isSecure, limited, sanitizeReturnTo, setSessionCookie } from "@/lib/auth/http";
import { completeSignIn } from "@/lib/auth/signin";
import { consumeLoginToken, createSession, hashToken } from "@/lib/auth/store";

const noStore = { "Cache-Control": "no-store" };
const GONE = "This link has expired or was already used. Ask for a new one.";

// What a link was sent to, without using it up: the page that opens from the email shows who it would sign in as and
// waits for a press, so a mail program that opens links to check them can't use the link before the person does.
export async function GET(req: NextRequest) {
  const auth = await authOf();
  if (!auth?.config.email) return NextResponse.json({ error: "Signing in by email isn't set up on this server" }, { status: 503, headers: noStore });
  if (!fromThisApp(req, auth.config)) return NextResponse.json({ error: "Not from this app" }, { status: 400, headers: noStore });
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const rows = await auth.db.query<{ email: string }>("SELECT email FROM login_tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?", [hashToken(token), Date.now()]);
  if (!rows[0]) return NextResponse.json({ error: GONE }, { status: 400, headers: noStore });
  return NextResponse.json({ email: rows[0].email }, { headers: noStore });
}

// Uses a link up and signs the person in.
export async function POST(req: NextRequest) {
  const auth = await authOf();
  if (!auth?.config.email) return NextResponse.json({ error: "Signing in by email isn't set up on this server" }, { status: 503, headers: noStore });
  if (!fromThisApp(req, auth.config)) return NextResponse.json({ error: "Not from this app" }, { status: 400, headers: noStore });
  const attempts = await limited(auth, `verify:${clientIp(req)}`, 30, 10 * 60_000);
  if (!attempts.ok) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429, headers: noStore });

  const body = (await req.json().catch(() => null)) as { token?: unknown; returnTo?: unknown } | null;
  const email = typeof body?.token === "string" ? await consumeLoginToken(auth.db, body.token) : null;
  if (!email) return NextResponse.json({ error: GONE }, { status: 400, headers: noStore });
  // The list may have changed since the link was sent.
  if (!isAllowed(email, auth.config.allowed)) return NextResponse.json({ error: "This address isn't allowed to sign in here." }, { status: 403, headers: noStore });

  const result = await completeSignIn(auth.db, auth.config.allowed, { provider: "email", subject: email, emails: [{ email, verified: true }] });
  if (!result.ok) return NextResponse.json({ error: "This address isn't allowed to sign in here." }, { status: 403, headers: noStore });
  const { token, expiresAt } = await createSession(auth.db, result.user.id, req.headers.get("user-agent"));
  const res = NextResponse.json({ ok: true, returnTo: sanitizeReturnTo(typeof body?.returnTo === "string" ? body.returnTo : "/") }, { headers: noStore });
  setSessionCookie(res, token, expiresAt, isSecure(req, auth.config));
  return res;
}
