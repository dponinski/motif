import { create } from "zustand";

// Lets a panel ask the editor to show another one ("Connect a repository" in the Components panel opens Git).
interface NavRequest {
  request: "git" | "components" | "docs" | "tokens" | null;
  ask: (to: NonNullable<NavRequest["request"]>) => void;
  clear: () => void;
}

export const useNavRequest = create<NavRequest>((set) => ({
  request: null,
  ask: (request) => set({ request }),
  clear: () => set({ request: null }),
}));
