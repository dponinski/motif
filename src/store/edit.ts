import { create } from "zustand";
import { persist } from "zustand/middleware";
import { debouncedStorage } from "../lib/debounced-storage";
import { storageProblem } from "./storage-problem";

// Changes made to a repository's source in the component stage, kept until they are sent as a pull request.
// They are saved in this browser, for the repository and branch they were made on, so a reload doesn't lose them.
// That includes the text of the files that were changed, which for a private repository is its code: it stays in
// this browser, like the access token does.

// More steps than this and the oldest can no longer be undone, so what is saved stays small.
export const MAX_HISTORY = 60;

export interface EditSelection {
  path: string;
  start: number;
}

interface Entry {
  // The current text of every file that has been changed.
  texts: Record<string, string>;
  selection: EditSelection | null;
  summary: string;
}

// What a changed file was in the repository: its text and sha, or, for a file that is new, no sha and no text.
export interface Base {
  text: string;
  sha: string | null;
}

export const NEW_FILE: Base = { text: "", sha: null };

interface EditStore {
  // The repository and branch these changes are for; a different one starts clean.
  scope: string | null;
  // The files as read from the repository, with the sha each had (none, for files made here).
  bases: Record<string, Base>;
  history: Entry[];
  index: number;
  selection: EditSelection | null;
  // Counts every change, undo and redo, so the preview knows when to update.
  revision: number;
  adopt: (scope: string) => void;
  select: (selection: EditSelection | null) => void;
  change: (path: string, text: string, selection: EditSelection | null, summary: string, base?: Base) => void;
  // Several files in one step, so one undo takes back all of them (a new component and its stylesheet, an element and
  // the rule that styles it). Files with no base yet are given the one that is passed for them.
  changeMany: (texts: Record<string, string>, selection: EditSelection | null, summary: string, bases?: Record<string, Base>) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  // Gives up the changes to some files, for example because the repository has changed them since.
  discard: (paths: string[]) => void;
  // After a pull request is merged: these files are what the repository has now, so they are the files' new starting
  // point, and only what was edited after the last sync is still a change. Undo doesn't go back past this.
  rebase: (files: Record<string, Base>) => void;
}

const START: Entry = { texts: {}, selection: null, summary: "" };

// What is kept in the browser. Each step keeps only the files it changed, not the text of every changed file again
// (60 steps of a large stylesheet would be megabytes, and past what the browser lets a page keep).
interface Saved {
  scope: string | null;
  bases: Record<string, Base>;
  // The files as the first step has them, then what each later step set.
  start: Record<string, string>;
  steps: { summary: string; set: Record<string, Patch> }[];
  index: number;
}

// A file's new text as a change to its old one: how much they share at the start and at the end, and what lies between
// in the new one. An edit touches a few characters of a file, so this is a few characters. A file with no earlier text is
// kept whole (a plain string).
export type Patch = string | [prefix: number, suffix: number, middle: string];

export function patchOf(before: string | undefined, after: string): Patch {
  if (before === undefined) return after;
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  const patch: Patch = [prefix, suffix, after.slice(prefix, after.length - suffix)];
  // Where little is shared, the whole text is no more.
  return patch[2].length + 16 >= after.length ? after : patch;
}

export function applyPatch(before: string | undefined, patch: Patch): string | null {
  if (typeof patch === "string") return patch;
  if (!Array.isArray(patch) || before === undefined || typeof patch[0] !== "number" || typeof patch[1] !== "number" || typeof patch[2] !== "string") return null;
  if (patch[0] + patch[1] > before.length) return null;
  return before.slice(0, patch[0]) + patch[2] + before.slice(before.length - patch[1]);
}

// Each entry's changes against the one before it, worked out once: entries don't change.
// A file's first change is a change to the text it had in the repository (its base).
const deltas = new WeakMap<Entry, { prev: Entry; bases: Record<string, Base>; set: Record<string, Patch> }>();

function deltaOf(prev: Entry, entry: Entry, bases: Record<string, Base>): Record<string, Patch> {
  const known = deltas.get(entry);
  if (known && known.prev === prev && known.bases === bases) return known.set;
  const set: Record<string, Patch> = {};
  for (const [path, text] of Object.entries(entry.texts)) if (prev.texts[path] !== text) set[path] = patchOf(prev.texts[path] ?? bases[path]?.text, text);
  deltas.set(entry, { prev, bases, set });
  return set;
}

export function encodeEdits(s: Pick<EditStore, "scope" | "bases" | "history" | "index">): Saved {
  const [first, ...rest] = s.history;
  return {
    scope: s.scope,
    bases: s.bases,
    start: first.texts,
    steps: rest.map((entry, i) => ({ summary: entry.summary, set: deltaOf(s.history[i], entry, s.bases) })),
    index: s.index,
  };
}

// The history from what was saved, in either shape: the one with each step's changes only, or the earlier one with
// every step's whole text. Null when it isn't well formed.
export function decodeEdits(saved: unknown): Pick<EditStore, "scope" | "bases" | "history" | "index"> | null {
  const p = saved as Record<string, unknown> | undefined;
  if (!p || typeof p.index !== "number" || typeof p.bases !== "object" || p.bases === null) return null;
  let history: Entry[] | null = null;
  if (Array.isArray(p.history) && p.history.length > 0) {
    history = (p.history as Entry[]).map((e) => ({ texts: e?.texts ?? {}, selection: null, summary: e?.summary ?? "" }));
  } else if (typeof p.start === "object" && p.start !== null && Array.isArray(p.steps)) {
    history = [{ texts: p.start as Record<string, string>, selection: null, summary: "" }];
    for (const step of p.steps as { summary?: string; set?: Record<string, Patch> }[]) {
      const prev = history[history.length - 1];
      const texts = { ...prev.texts };
      for (const [path, patch] of Object.entries(step?.set ?? {})) {
        const text = applyPatch(prev.texts[path] ?? (p.bases as Record<string, Base>)[path]?.text, patch);
        if (text === null) return null;
        texts[path] = text;
      }
      history.push({ texts, selection: null, summary: step?.summary ?? "" });
    }
  }
  if (!history || p.index < 0 || p.index >= history.length) return null;
  return { scope: (p.scope as string | null) ?? null, bases: p.bases as Record<string, Base>, history, index: p.index };
}

// What is kept, worked out again only when something that is kept has changed.
let kept: { history: Entry[]; bases: Record<string, Base>; index: number; scope: string | null; saved: Saved } | null = null;
function keptState(s: EditStore): Saved {
  if (kept && kept.history === s.history && kept.bases === s.bases && kept.index === s.index && kept.scope === s.scope) return kept.saved;
  const saved = encodeEdits(s);
  kept = { history: s.history, bases: s.bases, index: s.index, scope: s.scope, saved };
  return saved;
}

export const useEditStore = create<EditStore>()(
  persist(
    (set, get) => ({
      scope: null,
      bases: {},
      history: [START],
      index: 0,
      selection: null,
      revision: 0,
      adopt: (scope) => {
        if (get().scope === scope) return;
        set({ scope, bases: {}, history: [START], index: 0, selection: null, revision: get().revision + 1 });
      },
      select: (selection) => set({ selection }),
      change: (path, text, selection, summary, base) =>
        set((s) => {
          const current = s.history[s.index];
          // Nothing to record when the text is what it already is.
          if ((current.texts[path] ?? base?.text ?? s.bases[path]?.text) === text) return s;
          let history = [...s.history.slice(0, s.index + 1), { texts: { ...current.texts, [path]: text }, selection, summary }];
          if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
          return { bases: base && !s.bases[path] ? { ...s.bases, [path]: base } : s.bases, history, index: history.length - 1, selection, revision: s.revision + 1 };
        }),
      changeMany: (texts, selection, summary, bases = {}) =>
        set((s) => {
          const current = s.history[s.index];
          const changed = Object.entries(texts).filter(([path, text]) => (current.texts[path] ?? bases[path]?.text ?? s.bases[path]?.text) !== text);
          if (changed.length === 0) return s;
          let history = [...s.history.slice(0, s.index + 1), { texts: { ...current.texts, ...Object.fromEntries(changed) }, selection, summary }];
          if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
          const added = Object.fromEntries(changed.filter(([path]) => !s.bases[path] && bases[path]).map(([path]) => [path, bases[path]]));
          return { bases: { ...s.bases, ...added }, history, index: history.length - 1, selection, revision: s.revision + 1 };
        }),
      undo: () =>
        set((s) => (s.index === 0 ? s : { index: s.index - 1, selection: s.history[s.index - 1].selection, revision: s.revision + 1 })),
      redo: () =>
        set((s) => (s.index >= s.history.length - 1 ? s : { index: s.index + 1, selection: s.history[s.index + 1].selection, revision: s.revision + 1 })),
      clear: () => set((s) => ({ bases: {}, history: [START], index: 0, selection: null, revision: s.revision + 1 })),
      discard: (paths) =>
        set((s) => {
          const drop = new Set(paths);
          const keep = (rec: Record<string, string>) => Object.fromEntries(Object.entries(rec).filter(([p]) => !drop.has(p)));
          // What is left starts from here: the steps taken on the other files are kept as one state.
          const texts = keep(s.history[s.index].texts);
          return {
            bases: Object.fromEntries(Object.entries(s.bases).filter(([p]) => !drop.has(p))),
            history: [{ texts, selection: null, summary: "" }],
            index: 0,
            selection: null,
            revision: s.revision + 1,
          };
        }),
      rebase: (files) =>
        set((s) => {
          const paths = Object.keys(files).filter((p) => p in s.bases);
          if (paths.length === 0) return s;
          const now = s.history[s.index].texts;
          const bases = { ...s.bases };
          const texts = { ...now };
          for (const p of paths) {
            // A file that is what the repository has now isn't a change, and nothing about it needs keeping.
            if (!(p in now) || now[p] === files[p].text) { delete bases[p]; delete texts[p]; }
            else bases[p] = files[p];
          }
          return { bases, history: [{ texts, selection: null, summary: "" }], index: 0, selection: null, revision: s.revision + 1 };
        }),
    }),
    {
      name: "motif-edits",
      version: 2,
      storage: debouncedStorage<Saved>({
        onProblem: (failed) => storageProblem.getState().set("changes", failed ? "Your changes couldn't be saved in this browser (it is out of room, or blocks storage), so a reload would lose them. Sync sends them to the repository." : null),
      }),
      // Which element was selected isn't kept: it is a position in a file, and picking again is one click.
      partialize: keptState as never,
      // What was saved by the version before (every step's whole text) is read as it is.
      migrate: (saved) => saved as never,
      // A store from an unknown version, or one that isn't well formed, is dropped rather than trusted.
      merge: (saved, current) => {
        const decoded = decodeEdits(saved);
        return decoded ? { ...current, ...decoded } : current;
      },
    }
  )
);

// The text of a file as it is now, or null when it hasn't been changed.
export const currentText = (s: Pick<EditStore, "history" | "index">, path: string): string | null => s.history[s.index].texts[path] ?? null;

export interface ChangedFile {
  path: string;
  before: string;
  after: string;
  // Null for a file that is new.
  sha: string | null;
  isNew: boolean;
}

// The files made here that the repository doesn't have, as they are now: what the preview needs to run a new component.
export function createdTexts(s: Pick<EditStore, "history" | "index" | "bases">): Record<string, string> {
  const texts = s.history[s.index].texts;
  return Object.fromEntries(Object.entries(texts).filter(([path]) => s.bases[path]?.sha === null));
}

// Several parts of the page ask for this on every change (including a selection, which changes nothing here), and comparing
// the texts of large files is not free: it is worked out once for a state of the files and their starting points.
const changed = new WeakMap<Record<string, string>, { bases: Record<string, Base>; files: ChangedFile[] }>();

// Files whose text differs from the repository's, which is what a pull request would contain. The list is shared between
// callers, and is the same array for as long as nothing in it has changed: it is not to be changed.
export function changedFiles(s: Pick<EditStore, "history" | "index" | "bases">): ChangedFile[] {
  const texts = s.history[s.index].texts;
  const known = changed.get(texts);
  if (known && known.bases === s.bases) return known.files;
  const files = Object.entries(texts)
    .filter(([path, text]) => s.bases[path] && text !== s.bases[path].text)
    .map(([path, after]) => ({ path, before: s.bases[path].text, after, sha: s.bases[path].sha, isNew: s.bases[path].sha === null }));
  changed.set(texts, { bases: s.bases, files });
  return files;
}

// What was done, one line per change, in order, for the pull request description.
export function editLog(s: Pick<EditStore, "history" | "index">): string[] {
  return s.history.slice(1, s.index + 1).map((e) => e.summary);
}
