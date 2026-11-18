import type { Composition } from "../tokens/model";
import { googleFamiliesIn, googleFontsUrl } from "./google";

// The Google Fonts that a project's tokens use: Strings used as a font family, text styles, and a composition's font-family part, in every theme.
export interface FontTokens {
  strings: { value: string; use?: string; themeValues?: Record<string, string> }[];
  typography: { fontFamily: string }[];
  compositions: Pick<Composition, "slots">[];
}

export function fontValuesIn(t: FontTokens): string[] {
  const out: string[] = [];
  for (const s of t.strings) if (s.use === "font-family") out.push(s.value, ...Object.values(s.themeValues ?? {}));
  for (const x of t.typography) out.push(x.fontFamily);
  for (const c of t.compositions) for (const slot of c.slots) if (slot.name === "font-family" && slot.type === "string") { if (slot.value) out.push(slot.value); for (const v of Object.values(slot.themes ?? {})) if (v.value) out.push(v.value); }
  return out;
}

export const googleFamiliesUsed = (t: FontTokens): string[] => googleFamiliesIn(fontValuesIn(t));

// A stylesheet line that loads them, to put first in a stylesheet; empty when none is used.
export function fontImport(families: string[]): string {
  return families.length ? `@import url("${googleFontsUrl(families)}");\n` : "";
}
