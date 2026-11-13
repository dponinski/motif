import { NextRequest, NextResponse } from "next/server";
import { authOf, currentUser, fromThisApp, limited, type Auth } from "./http";
import type { User } from "./store";

// What every request about projects starts with: accounts exist, the request is from the app, and a person who may
// use them is signed in. Sync is frequent, so the limit is high; it is there to stop a loop, not a person.
export const noStore = { "Cache-Control": "no-store" };
const HOUR = 3_600_000;
const PER_HOUR = 4000;

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status, headers: noStore });

export async function signedInFor(req: NextRequest): Promise<{ auth: Auth; user: User } | NextResponse> {
  const auth = await authOf();
  if (!auth) return fail(404, "Accounts aren't set up on this server", { configured: false });
  if (!fromThisApp(req, auth.config)) return fail(400, "Not from this app");
  const session = await currentUser(req, auth);
  if (!session) return fail(401, "Sign in to save your projects", { signInRequired: true });
  const allowance = await limited(auth, `projects:${session.user.id}`, PER_HOUR, HOUR);
  if (!allowance.ok) return fail(429, "Too many requests. Try again in a few minutes.");
  return { auth, user: session.user };
}
