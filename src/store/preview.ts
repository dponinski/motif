import { create } from "zustand";
import type { PropValues } from "@/lib/preview/props";

// What is being shown in the component stage; shared by the stage and the props panel, never saved.
interface PreviewStore {
  values: Record<string, PropValues>;
  dark: boolean;
  // Width of the preview in px; null fills the stage.
  width: number | null;
  mode: "playground" | "variants";
  setValue: (id: string, name: string, value: unknown) => void;
  resetValues: (id: string) => void;
  setDark: (dark: boolean) => void;
  setWidth: (width: number | null) => void;
  setMode: (mode: "playground" | "variants") => void;
}

export const usePreviewStore = create<PreviewStore>((set) => ({
  values: {},
  dark: false,
  width: null,
  mode: "playground",
  setValue: (id, name, value) =>
    set((s) => {
      const current = { ...(s.values[id] ?? {}) };
      if (value === undefined) delete current[name];
      else current[name] = value;
      return { values: { ...s.values, [id]: current } };
    }),
  resetValues: (id) => set((s) => { const { [id]: _, ...rest } = s.values; return { values: rest }; }),
  setDark: (dark) => set({ dark }),
  setWidth: (width) => set({ width }),
  setMode: (mode) => set({ mode }),
}));
