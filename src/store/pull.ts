import { create } from "zustand";
import type { PendingConflicts } from "@/lib/pull";

// How the last pull went, and what is waiting for the person. Not kept: it is about this visit.
interface PullStatus {
  busy: boolean;
  // What came in, or why it couldn't.
  notice: { text: string; ok: boolean } | null;
  // Token values changed in both places, until they are chosen.
  pending: PendingConflicts | null;
  // The repository's default branch has moved since it was read.
  behind: boolean;
  set: (state: Partial<Omit<PullStatus, "set">>) => void;
}

export const usePullStatus = create<PullStatus>((set) => ({ busy: false, notice: null, pending: null, behind: false, set: (s) => set(s) }));
