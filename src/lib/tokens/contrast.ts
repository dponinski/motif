import { parseColor, toHex } from "../token-sync/color";

// WCAG contrast between two colors, for telling a designer whether text in one reads on the other.

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function luminance(text: string): number | null {
  const c = parseColor(text);
  return c ? 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b) : null;
}

// The ratio (1 to 21) between two colors, or null when either can't be read. Transparency is ignored: the color is taken as it is.
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type Grade = "AAA" | "AA" | "AA large" | "fails";

// What a ratio is good for: body text needs 4.5, large text 3, the strictest body text 7.
export const gradeOf = (ratio: number): Grade => (ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fails");

// A color shown the short way: hex when it can be read as one, the text as it was typed when it can't.
export function hexOf(text: string): string {
  const c = parseColor(text);
  return c ? toHex(c) : text;
}
