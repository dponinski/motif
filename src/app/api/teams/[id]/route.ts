import { NextRequest, NextResponse } from "next/server";
import { noStore, signedInFor } from "@/lib/auth/projects-http";
import { deleteTeam, renameTeam } from "@/lib/auth/teams";
import { done } from "@/lib/auth/teams-http";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  return done(await renameTeam(who.auth.db, id, who.user.id, body?.name)) ?? NextResponse.json({ ok: true }, { headers: noStore });
}

// A team can be deleted when it has no design systems left.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  return done(await deleteTeam(who.auth.db, id, who.user.id)) ?? NextResponse.json({ ok: true }, { headers: noStore });
}
