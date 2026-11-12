import { create } from "zustand";

// Changes made to a repository's source in the component stage, kept until they are sent as a pull request.
// Not saved: they belong to the import they were made on.

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
  // Which import these changes are for; a different one starts clean.
  version: string | null;
  // The files as read from the repository, with the sha each had.
  bases: Record<string, { text: string; sha: string }>;
  history: Entry[];
  index: number;
  selection: EditSelection | null;
  // Counts every change, undo and redo, so the preview knows when to update.
  revision: number;
  adopt: (version: string) => void;
  select: (selection: EditSelection | null) => void;
  change: (path: string, text: string, selection: EditSelection | null, summary: string, base?: { text: string; sha: string }) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

const START: Entry = { texts: {}, selection: null, summary: "" };

export const useEditStore = create<EditStore>((set, get) => ({
  version: null,
  bases: {},
  history: [START],
  index: 0,
  selection: null,
  revision: 0,
  adopt: (version) => {
    if (get().version === version) return;
    set({ version, bases: {}, history: [START], index: 0, selection: null, revision: get().revision + 1 });
  },
  select: (selection) => set({ selection }),
  change: (path, text, selection, summary, base) =>
    set((s) => {
      const current = s.history[s.index];
      // Nothing to record when the text is what it already is.
      if ((current.texts[path] ?? base?.text ?? s.bases[path]?.text) === text) return s;
      const history = [...s.history.slice(0, s.index + 1), { texts: { ...current.texts, [path]: text }, selection, summary }];
      return { bases: base && !s.bases[path] ? { ...s.bases, [path]: base } : s.bases, history, index: history.length - 1, selection, revision: s.revision + 1 };
    }),
  undo: () =>
    set((s) => (s.index === 0 ? s : { index: s.index - 1, selection: s.history[s.index - 1].selection, revision: s.revision + 1 })),
  redo: () =>
    set((s) => (s.index >= s.history.length - 1 ? s : { index: s.index + 1, selection: s.history[s.index + 1].selection, revision: s.revision + 1 })),
  clear: () => set((s) => ({ bases: {}, history: [START], index: 0, selection: null, revision: s.revision + 1 })),
}));

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
