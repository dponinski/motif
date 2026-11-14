import { create } from "zustand";

// Something the browser wouldn't keep, to tell the person (not kept itself: it is about this page). Each store that saves to
// the browser reports under its own name, so one that recovers doesn't hide another that hasn't.
export const storageProblem = create<{ problems: Record<string, string>; set: (source: string, message: string | null) => void }>((set) => ({
  problems: {},
  set: (source, message) =>
    set((s) => {
      if ((s.problems[source] ?? null) === message) return s;
      const problems = { ...s.problems };
      if (message === null) delete problems[source];
      else problems[source] = message;
      return { problems };
    }),
}));

export const firstProblem = (s: { problems: Record<string, string> }): string | null => Object.values(s.problems)[0] ?? null;
