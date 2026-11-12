// Messages between Motif and the sandboxed preview iframe. The iframe has an opaque origin, so this is the
// only channel, and nothing but plain data crosses it.

export interface RenderItem {
  key: string;
  // Shown above the item when several are rendered together.
  label?: string;
  // Module and export to render, e.g. "src/components/Button.tsx" and "Button" ("default" for a default export).
  path: string;
  exportName: string;
  props: Record<string, unknown>;
}

export type ToPreview = {
  type: "render";
  id: number;
  items: RenderItem[];
  layout: "single" | "grid" | "stack";
  dark: boolean;
  // CSS appended after the repository's own, used to show Motif's token values.
  overrides: string;
};

export type FromPreview =
  | { type: "ready" }
  | { type: "rendered"; id: number; height: number }
  | { type: "error"; message: string };

export const isFromPreview = (data: unknown): data is FromPreview =>
  typeof data === "object" && data !== null && ["ready", "rendered", "error"].includes((data as { type?: unknown }).type as string);
