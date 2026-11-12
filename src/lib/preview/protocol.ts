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

export interface RenderMessage {
  type: "render";
  id: number;
  items: RenderItem[];
  layout: "single" | "grid" | "stack";
  dark: boolean;
  // CSS appended after the repository's own, used to show Motif's token values.
  overrides: string;
}

// Replaces the code of some modules and renders again, so an edit shows without loading the page again.
export interface ModulesMessage {
  type: "modules";
  modules: Record<string, { code: string; imports: Record<string, string | null> }>;
  // Packages the new code needs that the page hasn't loaded yet: specifier -> URL.
  externals?: Record<string, string>;
}

// Turns picking elements on or off, and says which element is selected (a `data-motif` key).
export interface EditMessage {
  type: "edit";
  on: boolean;
  selected: string | null;
}

export type ToPreview = RenderMessage | ModulesMessage | EditMessage;

export type FromPreview =
  | { type: "ready" }
  | { type: "rendered"; id: number; height: number }
  | { type: "select"; key: string }
  | { type: "error"; message: string };

export const isFromPreview = (data: unknown): data is FromPreview =>
  typeof data === "object" && data !== null && ["ready", "rendered", "select", "error"].includes((data as { type?: unknown }).type as string);
