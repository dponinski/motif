import { NextRequest, NextResponse } from "next/server";
import { authOf } from "@/lib/auth/http";
import { finishOidc } from "@/lib/auth/flows";

// Apple answers with a form posted from its own site (response_mode=form_post), so this is a POST.
export async function POST(req: NextRequest) {
  const auth = await authOf();
  if (!auth?.config.apple) return NextResponse.json({ error: "Signing in with Apple isn't set up on this server" }, { status: 503 });
  const form = await req.formData().catch(() => null);
  const field = (name: string) => (typeof form?.get(name) === "string" ? (form!.get(name) as string) : null);
  return finishOidc(req, auth, "apple", { code: field("code"), state: field("state"), error: field("error"), user: field("user") });
}
