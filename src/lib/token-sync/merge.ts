import { mergeJson, setAt } from "../motif-document";
import type { SyncDoc, SyncToken } from "./doc";

export interface TokenConflict {
  path: string[];
  name: string;
  theme: string | null;
  label: string;
  mine: string;
  theirs: string;
  theirsValue: unknown;
}

export interface TokenMerge {
  merged: SyncDoc;
  conflicts: TokenConflict[];
  // Tokens deleted in Motif that are restored because tokens are never deleted from a repository by a sync.
  restored: string[];
}

const summary = (value: unknown): string => {
  if (value === undefined) return "Not set";
  if (typeof value === "string") return value;
  return Object.entries((value as SyncToken).values).map(([theme, v]) => `${theme} ${v}`).join(" · ");
};

// base: the repository as of the last sync; mine: Motif now; theirs: the repository now.
export function mergeTokens(base: SyncDoc, mine: SyncDoc, theirs: SyncDoc): TokenMerge {
  const restored: string[] = [];
  const local: SyncDoc = { ...mine };
  for (const name of Object.keys(base)) {
    if (!(name in mine) && name in theirs) {
      local[name] = theirs[name];
      restored.push(name);
    }
  }

  const { merged, conflicts } = mergeJson(base, local, theirs);
  return {
    merged: merged as SyncDoc,
    restored,
    conflicts: conflicts.map((c) => {
      const [name, , theme] = c.path;
      return {
        path: c.path,
        name,
        theme: theme ?? null,
        label: theme ? `${name} · ${theme}` : name,
        mine: c.mine === undefined && !theme ? "Removed" : summary(c.mine),
        theirs: c.theirs === undefined && !theme ? "Removed" : summary(c.theirs),
        theirsValue: c.theirs,
      };
    }),
  };
}

export function resolveTokenMerge(result: TokenMerge, takeTheirs: number[]): SyncDoc {
  let doc: unknown = result.merged;
  for (const index of takeTheirs) doc = setAt(doc, result.conflicts[index].path, result.conflicts[index].theirsValue);
  return doc as SyncDoc;
}

// Values are compared as bare numbers for lengths; people read them with their unit.
export const displayValue = (kind: SyncToken["kind"], value: string | undefined) =>
  value !== undefined && (kind === "radius" || kind === "spacing") ? `${value}px` : value;

export interface TokenChange {
  name: string;
  kind: SyncToken["kind"];
  // null when the whole token is added or removed.
  theme: string | null;
  type: "added" | "changed" | "removed";
  before?: string;
  after?: string;
}

export function describeChanges(from: SyncDoc, to: SyncDoc): TokenChange[] {
  const changes: TokenChange[] = [];
  for (const name of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const a = from[name];
    const b = to[name];
    if (!b) { changes.push({ name, kind: a.kind, theme: null, type: "removed" }); continue; }
    for (const theme of new Set([...Object.keys(a?.values ?? {}), ...Object.keys(b.values)])) {
      const before = a?.values[theme];
      const after = b.values[theme];
      if (after === undefined || before === after) continue;
      changes.push({ name, kind: b.kind, theme, type: before === undefined ? "added" : "changed", before, after });
    }
  }
  return changes;
}

// What a pull request would contain: additions and edits, never removals.
export const changesToRepo = (merged: SyncDoc, theirs: SyncDoc) => describeChanges(theirs, merged).filter((c) => c.type !== "removed");
