import { ITEM_SECTIONS, itemsOf, mergeSection, type ItemConflict, type ItemSection, type Items } from "./items";
import { SECTIONS, hashSections, sameHashes, type Hashes, type ProjectPayload, type Section } from "./payload";

// Deciding what to do about a project that exists on this device and on the server. Each project is compared in
// five parts (name, repository, token link, tokens, documentation) against what both had the last time they agreed:
// a part that only one side changed is taken from that side, so editing the docs on one device and the tokens on
// another needs no attention. Only a part changed differently on both is a conflict, and a person decides it.

// What the server had, and what the project held, the last time they were in agreement. `items` says, for the tokens and
// the documentation, what each item was then (a hash of it), so a clash in one of those can be narrowed to the items that
// both sides changed. It is missing from metadata kept by an earlier version, and then a clash is the whole part.
export interface Meta { version: number; hashes: Hashes; items?: Items }

export const metaOf = (version: number, payload: ProjectPayload): Meta => ({ version, hashes: hashSections(payload), items: itemsOf(payload) });

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

export type Clash =
  // Every clash was in different items: the merged project, to be saved.
  | { kind: "merge"; payload: ProjectPayload }
  // What both sides changed differently: whole parts (name, repository, token link, or tokens and docs without item
  // history) and items. `withLocal` and `withServer` are the project with everything else merged and these taken from this
  // device, or from the server.
  | { kind: "conflict"; sections: Section[]; items: ItemConflict[]; withLocal: ProjectPayload; withServer: ProjectPayload };

// A part changed on both sides is narrowed to its items where it can be: the tokens and the documentation, when there is a
// record of what each item was. What is left is a person's to decide.
export function resolveClash(meta: Meta | null, local: ProjectPayload, server: ProjectPayload, clashing: Section[]): Clash {
  const lh = hashSections(local), sh = hashSections(server);
  const withLocal = { ...local } as Record<Section, unknown>;
  const withServer = { ...local } as Record<Section, unknown>;
  const sections: Section[] = [];
  const items: ItemConflict[] = [];
  for (const s of SECTIONS) {
    if (clashing.includes(s)) {
      const base = (ITEM_SECTIONS as readonly string[]).includes(s) ? meta?.items?.[s as ItemSection] : undefined;
      if (base) {
        const m = mergeSection(s as ItemSection, base, local[s], server[s]);
        withLocal[s] = m.withLocal;
        withServer[s] = m.withServer;
        items.push(...m.conflicts);
      } else {
        sections.push(s);
        withLocal[s] = local[s];
        withServer[s] = server[s];
      }
      continue;
    }
    // Changed by only one side (or by neither): from that side.
    const fromServer = !!meta && sh[s] !== meta.hashes[s] && lh[s] === meta.hashes[s];
    const value = fromServer || lh[s] === sh[s] ? server[s] : local[s];
    withLocal[s] = value;
    withServer[s] = value;
  }
  if (sections.length === 0 && items.length === 0) return { kind: "merge", payload: withLocal as unknown as ProjectPayload };
  return { kind: "conflict", sections, items, withLocal: withLocal as unknown as ProjectPayload, withServer: withServer as unknown as ProjectPayload };
}
