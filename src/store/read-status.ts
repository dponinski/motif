import { create } from "zustand";

// Whether the project's repository is being read for the first time, and why it couldn't be. Not kept: it is only for
// the screen that waits on it.
interface ReadStatus {
  busy: boolean;
  error: string | null;
  set: (state: { busy: boolean; error: string | null }) => void;
}

export const useReadStatus = create<ReadStatus>((set) => ({ busy: false, error: null, set: (s) => set(s) }));
