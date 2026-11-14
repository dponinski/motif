import { NextRequest, NextResponse } from "next/server";
import { clientIp, limited, originOf } from "@/lib/auth/http";
import { INVITE_DAYS, createInvite, listTeams } from "@/lib/auth/teams";
import { inviteMessage, smtpSender } from "@/lib/auth/mail";
import { noStore, signedInFor } from "@/lib/auth/projects-http";
import { fail } from "@/lib/auth/projects-http";
import { refusal } from "@/lib/auth/teams-http";

const HOUR = 3_600_000;
type Ctx = { params: Promise<{ id: string }> };

// Invites an address to the team. The invitation is mailed when this server can send mail, and the link comes back
// either way so an owner can pass it on themselves.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;

  // An owner invites a few dozen people an hour, from one place a few more, and one address is mailed a few times.
  const byUser = await limited(who.auth, `invite:${who.user.id}`, 30, HOUR);
  const byIp = await limited(who.auth, `invite-ip:${clientIp(req)}`, 60, HOUR);
  if (!byUser.ok || !byIp.ok) return fail(429, "Too many invitations. Try again later.");

  const result = await createInvite(who.auth.db, id, who.user.id, body?.email);
  if (!result.ok) return refusal(result.reason);
  const link = `${originOf(req, who.auth.config)}/invite/${encodeURIComponent(result.token)}`;

  let mailed = false;
  const perAddress = await limited(who.auth, `invite-mail:${result.email}`, 5, HOUR);
  if (who.auth.config.email && perAddress.ok) {
    try {
      const team = (await listTeams(who.auth.db, who.user.id)).find((t) => t.id === id);
      await smtpSender(who.auth.config.email)(inviteMessage(result.email, team?.name ?? "a team", who.user.name ?? who.user.email, link, INVITE_DAYS));
      mailed = true;
    } catch (err) {
      console.error("Sending an invitation failed:", err instanceof Error ? err.message : "unexpected error");
    }
  }
  return NextResponse.json({ invite: { id: result.id, email: result.email }, link, mailed }, { status: 201, headers: noStore });
}
