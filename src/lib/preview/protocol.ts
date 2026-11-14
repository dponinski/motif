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
  // "bare" is for a component placed in a design: no padding, and with `fit` it is as big as the component is.
  layout: "single" | "grid" | "stack" | "bare";
  fit?: boolean;
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

// Replaces the text of some stylesheets, so a style edit shows without loading the page again.
export interface CssMessage {
  type: "css";
  files: Record<string, string>;
}

// Turns picking elements on or off, and says which element is selected (a `data-motif` key).
export interface EditMessage {
  type: "edit";
  on: boolean;
  selected: string | null;
}

// The preview sits on a canvas that pans and zooms. A page inside an iframe is given the wheel and the keyboard
// before the page around it, so while this is on it passes scrolling, pinching and holding Space up as messages.
export interface CanvasMessage {
  type: "canvas";
  on: boolean;
}

export type ToPreview = RenderMessage | ModulesMessage | CssMessage | EditMessage | CanvasMessage;

export type FromPreview =
  | { type: "ready" }
  | { type: "rendered"; id: number; height: number; width?: number }
  | { type: "select"; key: string }
  | { type: "error"; message: string }
  // Only sent while the canvas asked for it (see CanvasMessage). Positions are in the preview's own pixels.
  | { type: "wheel"; deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; clientX: number; clientY: number }
  | { type: "space"; down: boolean };

export const isFromPreview = (data: unknown): data is FromPreview =>
  typeof data === "object" && data !== null && ["ready", "rendered", "select", "error", "wheel", "space"].includes((data as { type?: unknown }).type as string);
