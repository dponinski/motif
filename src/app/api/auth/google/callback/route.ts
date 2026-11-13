import { NextRequest, NextResponse } from "next/server";
import { authOf } from "@/lib/auth/http";
import { finishOidc } from "@/lib/auth/flows";

export async function GET(req: NextRequest) {
  const auth = await authOf();
  if (!auth?.config.google) return NextResponse.json({ error: "Signing in with Google isn't set up on this server" }, { status: 503 });
  const p = req.nextUrl.searchParams;
  return finishOidc(req, auth, "google", { code: p.get("code"), state: p.get("state"), error: p.get("error") });
}
