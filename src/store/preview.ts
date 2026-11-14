import { create } from "zustand";
import type { PropValues } from "@/lib/preview/props";

// What is being shown in the component stage; shared by the stage and the props panel, never saved.
interface PreviewStore {
  values: Record<string, PropValues>;
  dark: boolean;
  // Width of the preview in px; null fills the stage.
  width: number | null;
  mode: "playground" | "variants" | "examples" | "edit";
  // Whether previews show the tokens Motif has changed since the last sync.
  motifTokens: boolean;
  // Which state or width the style controls (and the handles on the canvas) edit: "" for the plain classes, "hover:", "md:"...
  editModifier: string;
  setEditModifier: (modifier: string) => void;
  setValue: (id: string, name: string, value: unknown) => void;
  resetValues: (id: string) => void;
  setDark: (dark: boolean) => void;
  setWidth: (width: number | null) => void;
  setMode: (mode: "playground" | "variants" | "examples" | "edit") => void;
  setMotifTokens: (on: boolean) => void;
}

export const usePreviewStore = create<PreviewStore>((set) => ({
  values: {},
  dark: false,
  width: null,
  // Opening a component lands in Design: the canvas you work on. "playground" is shown as Preview, to use the component.
  mode: "edit",
  motifTokens: true,
  editModifier: "",
  setEditModifier: (editModifier) => set({ editModifier }),
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
  setMotifTokens: (motifTokens) => set({ motifTokens }),
}));
