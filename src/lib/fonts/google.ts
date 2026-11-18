import { CATALOG } from "./catalog";

// Google Fonts: the families the picker lists, what a family goes in a stylesheet as, and where a family is loaded from.

export type FontKind = "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
export interface GoogleFont { family: string; kind: FontKind; weights: number[] }

const KIND: Record<string, FontKind> = { s: "sans-serif", r: "serif", d: "display", h: "handwriting", m: "monospace" };
export const KINDS: { id: FontKind; label: string }[] = [
  { id: "sans-serif", label: "Sans serif" }, { id: "serif", label: "Serif" }, { id: "display", label: "Display" }, { id: "handwriting", label: "Handwriting" }, { id: "monospace", label: "Monospace" },
];

export const GOOGLE_FONTS: GoogleFont[] = CATALOG.map(([family, kind, weights]) => ({ family, kind: KIND[kind] ?? "sans-serif", weights: weights.split(",").map(Number) }));
const BY_NAME = new Map(GOOGLE_FONTS.map((f) => [f.family.toLowerCase(), f]));
export const findGoogleFont = (family: string): GoogleFont | undefined => BY_NAME.get(family.trim().toLowerCase());

// The first family of a font-family value (`"Playfair Display", serif` is Playfair Display); null when there is none.
export function firstFamily(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(value);
  const family = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return family === "" ? null : family;
}

// The fallback a family goes with, by what kind of font it is.
const GENERIC: Record<FontKind, string> = { "sans-serif": "sans-serif", serif: "serif", display: "sans-serif", handwriting: "cursive", monospace: "monospace" };

// A family as a font-family value: `Inter, sans-serif`, `"Playfair Display", serif`.
export function fontValue(family: string, kind: FontKind = "sans-serif"): string {
  const name = /^[A-Za-z][A-Za-z0-9_-]*$/.test(family) ? family : `"${family.replace(/"/g, "")}"`;
  return `${name}, ${GENERIC[kind]}`;
}

// Where the families are loaded from: one stylesheet. Only the weights a family has are asked for (a family that doesn't have one is not
// refused, as it is by the newer form of the address).
export function googleFontsUrl(families: string[], options: { text?: string; weights?: (family: string) => number[] } = {}): string {
  const list = [...new Set(families.map((f) => f.trim()).filter(Boolean))].sort();
  const parts = list.map((family) => {
    const weights = options.weights?.(family) ?? findGoogleFont(family)?.weights ?? [400];
    const wanted = weights.filter((w) => [400, 500, 600, 700].includes(w));
    return `${family.replace(/ /g, "+")}:${(wanted.length ? wanted : weights.slice(0, 1)).join(",")}`;
  });
  const text = options.text !== undefined ? `&text=${encodeURIComponent(options.text)}` : "";
  return `https://fonts.googleapis.com/css?family=${parts.join("|")}${text}&display=swap`;
}

// The families that a list of font-family values uses and that are Google Fonts.
export function googleFamiliesIn(values: (string | undefined | null)[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const family = firstFamily(v);
    const font = family ? findGoogleFont(family) : undefined;
    if (font) out.add(font.family);
  }
  return [...out].sort();
}

// What a search for `query` finds: families whose name has every word of it, those that start with it first.
export function searchFonts(query: string, kind: FontKind | "all" = "all", limit = 60): GoogleFont[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = GOOGLE_FONTS.filter((f) => (kind === "all" || f.kind === kind) && words.every((w) => f.family.toLowerCase().includes(w)));
  const q = query.trim().toLowerCase();
  hits.sort((a, b) => Number(b.family.toLowerCase().startsWith(q)) - Number(a.family.toLowerCase().startsWith(q)) || a.family.localeCompare(b.family));
  return hits.slice(0, limit);
}
