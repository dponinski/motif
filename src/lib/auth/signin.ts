import { allowedEmail, isAllowed } from "./allowlist";
import type { Provider } from "./config";
import type { Db } from "./db";
import { createUser, findIdentity, findUserByEmail, isDuplicate, linkIdentity, touchUser, type User } from "./store";

// Finishing a sign-in, whichever way the person came: a provider vouched for who they are, and now they are let in,
// or not. This is the one place that decides it.

export interface Claim {
  provider: Provider;
  // What the provider calls this person (its stable id for them; for email, the address).
  subject: string;
  // The addresses the provider has checked belong to them.
  emails: { email: string; verified: boolean }[];
  name?: string | null;
  avatar?: string | null;
}

export type SignInResult =
  | { ok: true; user: User; created: boolean; linked: boolean }
  // They share no address that has been verified, so there is no one to let in.
  | { ok: false; reason: "no-verified-email" }
  // Apple can hide the address behind a relay; the list can't name that, and nothing else says who they are.
  | { ok: false; reason: "private-email" }
  | { ok: false; reason: "not-allowed"; email: string | null };

const isRelay = (email: string) => /@privaterelay\.appleid\.com$/i.test(email);

export async function completeSignIn(db: Db, allowed: string[], claim: Claim, now = Date.now()): Promise<SignInResult> {
  // Someone who has signed in this way before is the same person, whatever address the provider reports now. They
  // are still let in only while their address is on the list.
  const known = await findIdentity(db, claim.provider, claim.subject);
  if (known) {
    if (!isAllowed(known.email, allowed)) return { ok: false, reason: "not-allowed", email: known.email };
    await touchUser(db, known.id, { name: claim.name, avatar: claim.avatar }, now);
    return { ok: true, user: known, created: false, linked: false };
  }

  const verified = claim.emails.filter((e) => e.verified);
  if (verified.length === 0) return { ok: false, reason: "no-verified-email" };
  const email = allowedEmail(verified, allowed);
  if (!email) {
    if (claim.provider === "apple" && verified.every((e) => isRelay(e.email))) return { ok: false, reason: "private-email" };
    return { ok: false, reason: "not-allowed", email: verified[0]?.email ?? null };
  }

  // The address is verified by the provider and is on the list, so the account that has it is theirs.
  let existing = await findUserByEmail(db, email);
  let user = existing;
  if (!user) {
    try {
      user = await createUser(db, { email, name: claim.name, avatar: claim.avatar }, now);
    } catch (err) {
      // The same person signing in twice at once: the other one got there first, and the account is theirs.
      if (!isDuplicate(err)) throw err;
      existing = user = await findUserByEmail(db, email);
      if (!user) throw err;
    }
  }
  await linkIdentity(db, user.id, claim.provider, claim.subject, email, now);
  await touchUser(db, user.id, { name: claim.name, avatar: claim.avatar }, now);
  return { ok: true, user, created: !existing, linked: !!existing };
}
