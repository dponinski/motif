import { NextResponse } from "next/server";
import { fail } from "./projects-http";
import type { TeamResult } from "./teams";

// What a team operation that was refused says, with the status that goes with it.
const REFUSALS: Record<string, [number, string]> = {
  forbidden: [403, "Only an owner of the team can do that"],
  "not-found": [404, "There is no such team"],
  name: [400, "Give it a name of up to 80 characters"],
  "has-projects": [409, "Move or delete the team's design systems first"],
  "last-owner": [409, "A team always needs an owner. Make someone else an owner first"],
  limit: [409, "That is more people than a team can have"],
  "wrong-email": [403, "This invitation is for a different email address. Sign in with the address it was sent to"],
  expired: [410, "This invitation has expired. Ask for a new one"],
  exists: [409, "They are there already"],
  email: [400, "Enter a valid email address"],
  member: [409, "They are in the team already"],
};

export const refusal = (reason: string) => {
  const [status, message] = REFUSALS[reason] ?? [400, "That didn't work"];
  return fail(status, message, { reason });
};

export const done = (result: TeamResult): NextResponse | null => (result.ok ? null : refusal(result.reason));
