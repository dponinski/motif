import { NextRequest, NextResponse } from "next/server";
import { isAllowed, normalizeEmail } from "@/lib/auth/allowlist";
import { authOf, clientIp, fromThisApp, limited, originOf, sanitizeReturnTo } from "@/lib/auth/http";
import { LOGIN_LINK_MINUTES, createLoginToken } from "@/lib/auth/store";
import { loginMessage, smtpSender } from "@/lib/auth/mail";

const HOUR = 3_600_000;
const noStore = { "Cache-Control": "no-store" };

// Asks for a sign-in link by email. Whether the address may sign in is not told: the answer is the same either way, so
// the form can't be used to find out who is on the list. Only an address that is on it is sent anything.
export async function POST(req: NextRequest) {
  const auth = await authOf();
  if (!auth?.config.email) return NextResponse.json({ error: "Signing in by email isn't set up on this server" }, { status: 503, headers: noStore });
  if (!fromThisApp(req, auth.config)) return NextResponse.json({ error: "Not from this app" }, { status: 400, headers: noStore });

  const body = (await req.json().catch(() => null)) as { email?: unknown; returnTo?: unknown } | null;
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400, headers: noStore });

  // A person is sent a few links an hour, and one address a few; so is one place.
  const [byIp, byEmail] = [await limited(auth, `mail-ip:${clientIp(req)}`, 20, HOUR), await limited(auth, `mail:${email}`, 5, HOUR)];
  if (!byIp.ok || !byEmail.ok) return NextResponse.json({ error: "Too many sign-in links have been asked for. Try again later." }, { status: 429, headers: noStore });

  if (isAllowed(email, auth.config.allowed)) {
    try {
      const token = await createLoginToken(auth.db, email);
      const returnTo = sanitizeReturnTo(typeof body?.returnTo === "string" ? body.returnTo : "/");
      const link = `${originOf(req, auth.config)}/signin/confirm?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(returnTo)}`;
      await smtpSender(auth.config.email)(loginMessage(email, link, LOGIN_LINK_MINUTES));
    } catch (err) {
      // For whoever runs the server; never to the page, which would show who is on the list.
      console.error("Sending a sign-in link failed:", err instanceof Error ? err.message : "unexpected error");
    }
  }
  return NextResponse.json({ ok: true }, { headers: noStore });
}
