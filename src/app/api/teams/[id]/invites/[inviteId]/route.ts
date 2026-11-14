import { NextRequest, NextResponse } from "next/server";
import { noStore, signedInFor } from "@/lib/auth/projects-http";
import { revokeInvite } from "@/lib/auth/teams";
import { done } from "@/lib/auth/teams-http";

type Ctx = { params: Promise<{ id: string; inviteId: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, inviteId } = await ctx.params;
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  return done(await revokeInvite(who.auth.db, id, who.user.id, inviteId)) ?? NextResponse.json({ ok: true }, { headers: noStore });
}
