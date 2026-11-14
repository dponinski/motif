import { NextRequest, NextResponse } from "next/server";
import { PROJECT_ID, moveProject } from "@/lib/auth/projects";
import { fail, noStore, signedInFor } from "@/lib/auth/projects-http";

type Ctx = { params: Promise<{ id: string }> };

// Moves a design system into a team the person is in (`teamId`), or, for an owner of its team, out of it to their own
// (`teamId: null`).
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!PROJECT_ID.test(id)) return fail(400, "Not a project");
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => null)) as { teamId?: unknown } | null;
  if (!body || !("teamId" in body) || (body.teamId !== null && typeof body.teamId !== "string")) return fail(400, "Say which team");
  const result = await moveProject(who.auth.db, who.user.id, id, { teamId: body.teamId });
  if (result.ok) return NextResponse.json({ version: result.version, teamId: result.teamId }, { headers: noStore });
  const errors = {
    "not-found": [404, "There is no such project"],
    forbidden: [403, "You can't move it there"],
    limit: [409, "That is at its limit of design systems"],
    exists: [409, "It is there already"],
  } as const;
  const [status, message] = errors[result.reason];
  return fail(status, message);
}
