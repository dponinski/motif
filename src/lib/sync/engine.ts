import { SECTIONS, sameHashes, type Hashes, type ProjectPayload, type Section } from "./payload";

// Deciding what to do about a project that exists on this device and on the server. Each project is compared in
// five parts (name, repository, token link, tokens, documentation) against what both had the last time they agreed:
// a part that only one side changed is taken from that side, so editing the docs on one device and the tokens on
// another needs no attention. Only a part changed differently on both is a conflict, and a person decides it.

// What the server had, and what the project held, the last time they were in agreement.
export interface Meta { version: number; hashes: Hashes }

export type Take = Record<Section, "local" | "server">;

export type Decision =
  // Already the same. (The server may have a newer version number of the same content.)
  | { kind: "idle" }
  // Only this device changed it.
  | { kind: "push" }
  // Only the server changed it.
  | { kind: "pull" }
  // Both changed it, in different parts: take each part from the side that changed it, then send the result.
  | { kind: "merge"; take: Take }
  | { kind: "conflict"; sections: Section[] };

export function decide(meta: Meta | null, local: Hashes, server: Hashes): Decision {
  if (sameHashes(local, server)) return { kind: "idle" };
  // Never in agreement (for example, the same project reached this device some other way): it can't be told who
  // changed what.
  if (!meta) return { kind: "conflict", sections: SECTIONS.filter((s) => local[s] !== server[s]) };

  const changedHere = SECTIONS.filter((s) => local[s] !== meta.hashes[s]);
  const changedThere = SECTIONS.filter((s) => server[s] !== meta.hashes[s]);
  if (changedHere.length === 0) return { kind: "pull" };
  if (changedThere.length === 0) return { kind: "push" };

  const clash = SECTIONS.filter((s) => changedHere.includes(s) && changedThere.includes(s) && local[s] !== server[s]);
  if (clash.length) return { kind: "conflict", sections: clash };
  const take = Object.fromEntries(SECTIONS.map((s) => [s, changedThere.includes(s) ? "server" : "local"])) as Take;
  return { kind: "merge", take };
}

export function applyTake(local: ProjectPayload, server: ProjectPayload, take: Take): ProjectPayload {
  const out = { ...local } as Record<Section, unknown>;
  for (const s of SECTIONS) out[s] = take[s] === "server" ? server[s] : local[s];
  return out as unknown as ProjectPayload;
}
