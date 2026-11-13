import { NextRequest, NextResponse } from "next/server";
import { readConfig as readGitHubConfig } from "@/lib/github-oauth";
import { providersOf } from "@/lib/auth/config";
import { authOf, currentUser, fromThisApp } from "@/lib/auth/http";

const noStore = { "Cache-Control": "no-store" };

// What the page needs to know about accounts: whether there are any, how to sign in, and who is signed in.
export async function GET(req: NextRequest) {
  const auth = await authOf();
  if (!auth) return NextResponse.json({ configured: false }, { headers: noStore });
  if (!fromThisApp(req, auth.config)) return NextResponse.json({ error: "Not from this app" }, { status: 400, headers: noStore });
  const session = await currentUser(req, auth);
  return NextResponse.json({
    configured: true,
    providers: providersOf(auth.config, !!readGitHubConfig()),
    // A server that hasn't been told who may sign in lets nobody, and says so rather than failing quietly.
    nobodyAllowed: auth.config.allowed.length === 0,
    user: session ? { id: session.user.id, email: session.user.email, name: session.user.name, avatar: session.user.avatar } : null,
  }, { headers: noStore });
}
