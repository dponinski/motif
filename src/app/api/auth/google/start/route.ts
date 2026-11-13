import { NextRequest, NextResponse } from "next/server";
import { authOf } from "@/lib/auth/http";
import { startOidc } from "@/lib/auth/flows";

export async function GET(req: NextRequest) {
  const auth = await authOf();
  if (!auth?.config.google) return NextResponse.json({ error: "Signing in with Google isn't set up on this server" }, { status: 503 });
  return startOidc(req, auth, "google");
}
