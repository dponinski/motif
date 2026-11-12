import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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

interface EditStore {
  // The repository and branch these changes are for; a different one starts clean.
  scope: string | null;
  // The files as read from the repository, with the sha each had.
  bases: Record<string, { text: string; sha: string }>;
  history: Entry[];
  index: number;
  selection: EditSelection | null;
  // Counts every change, undo and redo, so the preview knows when to update.
  revision: number;
  adopt: (scope: string) => void;
  select: (selection: EditSelection | null) => void;
  change: (path: string, text: string, selection: EditSelection | null, summary: string, base?: { text: string; sha: string }) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  // Gives up the changes to some files, for example because the repository has changed them since.
  discard: (paths: string[]) => void;
}

const START: Entry = { texts: {}, selection: null, summary: "" };

// Storage that never throws: a full or blocked browser store just means the changes aren't kept past this page.
const safeStorage = {
  getItem: (name: string) => { try { return localStorage.getItem(name); } catch { return null; } },
  setItem: (name: string, value: string) => { try { localStorage.setItem(name, value); } catch { /* not kept */ } },
  removeItem: (name: string) => { try { localStorage.removeItem(name); } catch { /* nothing to remove */ } },
};

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
    }),
    {
      name: "motif-edits",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      // Which element was selected isn't kept: it is a position in a file, and picking again is one click.
      partialize: (s) => ({ scope: s.scope, bases: s.bases, history: s.history.map((e) => ({ ...e, selection: null })), index: s.index }),
      // A store from an unknown version, or one that isn't well formed, is dropped rather than trusted.
      merge: (saved, current) => {
        const p = saved as Partial<EditStore> | undefined;
        const ok = p && Array.isArray(p.history) && p.history.length > 0 && typeof p.index === "number" && p.index >= 0 && p.index < p.history.length && typeof p.bases === "object" && p.bases !== null;
        return ok ? { ...current, scope: p.scope ?? null, bases: p.bases!, history: p.history!, index: p.index! } : current;
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
  sha: string;
}

// Files whose text differs from the repository's, which is what a pull request would contain.
export function changedFiles(s: Pick<EditStore, "history" | "index" | "bases">): ChangedFile[] {
  const texts = s.history[s.index].texts;
  return Object.entries(texts)
    .filter(([path, text]) => s.bases[path] && text !== s.bases[path].text)
    .map(([path, after]) => ({ path, before: s.bases[path].text, after, sha: s.bases[path].sha }));
}

// What was done, one line per change, in order, for the pull request description.
export function editLog(s: Pick<EditStore, "history" | "index">): string[] {
  return s.history.slice(1, s.index + 1).map((e) => e.summary);
}
