import { create } from "zustand";
import type { Refreshed } from "@/lib/work/sync";

// What is going on with syncing right now. Held in memory only: the project keeps the work itself (store/git.ts `work`).
interface WorkRuntime {
  // The pull request as GitHub last said it was.
  refreshed: Refreshed | null;
  syncing: boolean;
  checking: boolean;
  error: string | null;
  // Something that happened that the person should read once: "Merged", "Closed".
  notice: string | null;
  // The note for the pull request's description, as typed.
  note: string;
  // Edited files that the default branch has changed since: they aren't sent.
  stale: string[];
  set: (partial: Partial<Omit<WorkRuntime, "set">>) => void;
}

export const useWorkRuntime = create<WorkRuntime>((set) => ({
  refreshed: null,
  syncing: false,
  checking: false,
  error: null,
  notice: null,
  note: "",
  stale: [],
  set: (partial) => set(partial),
}));
