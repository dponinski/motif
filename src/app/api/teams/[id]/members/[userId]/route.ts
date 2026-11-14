import { NextRequest, NextResponse } from "next/server";
import { noStore, signedInFor, fail } from "@/lib/auth/projects-http";
import { setRole } from "@/lib/auth/teams";
import { done } from "@/lib/auth/teams-http";

type Ctx = { params: Promise<{ id: string; userId: string }> };

// Makes someone an owner or a member.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id, userId } = await ctx.params;
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => null)) as { role?: unknown } | null;
  if (body?.role !== "owner" && body?.role !== "member") return fail(400, "Say owner or member");
  return done(await setRole(who.auth.db, id, who.user.id, userId, body.role)) ?? NextResponse.json({ ok: true }, { headers: noStore });
}

// Takes someone out of the team; for the person themselves, leaving it.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, userId } = await ctx.params;
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  return done(await setRole(who.auth.db, id, who.user.id, userId, "remove")) ?? NextResponse.json({ ok: true }, { headers: noStore });
}
