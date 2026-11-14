import { NextRequest, NextResponse } from "next/server";
import { noStore, signedInFor } from "@/lib/auth/projects-http";
import { createTeam, invitesFor, listTeams } from "@/lib/auth/teams";
import { refusal } from "@/lib/auth/teams-http";

// The teams the signed-in person is in (with their members, and for owners the invitations that haven't been taken up),
// and the invitations waiting for their address.
export async function GET(req: NextRequest) {
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  const [teams, invites] = await Promise.all([listTeams(who.auth.db, who.user.id), invitesFor(who.auth.db, who.user.email)]);
  return NextResponse.json({ teams, invites }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  // A guest is in someone's team; starting teams is for the people the server lists.
  if (who.user.guest) return refusal("forbidden");
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const result = await createTeam(who.auth.db, who.user.id, body?.name);
  if (!result.ok) return refusal(result.reason === "limit" ? "limit" : "name");
  return NextResponse.json({ id: result.id }, { status: 201, headers: noStore });
}
