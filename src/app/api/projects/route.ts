import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/auth/projects";
import { noStore, signedInFor } from "@/lib/auth/projects-http";

// Which projects the signed-in person has, and at which version: a device compares this with what it has and fetches
// only what is new.
export async function GET(req: NextRequest) {
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ projects: await listProjects(who.auth.db, who.user.id) }, { headers: noStore });
}
