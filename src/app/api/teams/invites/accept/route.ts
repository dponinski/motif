import { NextRequest, NextResponse } from "next/server";
import { fail, noStore, signedInFor } from "@/lib/auth/projects-http";
import { acceptInviteById, acceptInviteByToken } from "@/lib/auth/teams";
import { refusal } from "@/lib/auth/teams-http";

// Takes up an invitation: from the link that was mailed (`token`) or from the dashboard (`inviteId`). Either way it is the
// address the person signed in with that has to be the one invited.
export async function POST(req: NextRequest) {
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => null)) as { token?: unknown; inviteId?: unknown } | null;
  const result = typeof body?.token === "string" && body.token
    ? await acceptInviteByToken(who.auth.db, who.user, body.token)
    : typeof body?.inviteId === "string" && body.inviteId
      ? await acceptInviteById(who.auth.db, who.user, body.inviteId)
      : null;
  if (!result) return fail(400, "Say which invitation");
  if (!result.ok) return refusal(result.reason);
  return NextResponse.json({ teamId: result.teamId, teamName: result.teamName }, { headers: noStore });
}
