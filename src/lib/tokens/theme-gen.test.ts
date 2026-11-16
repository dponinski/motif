import { describe, expect, it } from "vitest";
import { rgbToOklab, parseColor } from "../token-sync/color";
import { contrastRatio } from "./contrast";
import { darkOf } from "./theme-gen";

const L = (hex: string) => rgbToOklab(parseColor(hex)!).L;
const hue = (hex: string) => { const { a, b } = rgbToOklab(parseColor(hex)!); return (Math.atan2(b, a) * 180) / Math.PI; };

describe("a dark version of a color", () => {
  it("turns lightness around, and not all the way to black or white", () => {
    const bg = darkOf("#ffffff")!;
    const fg = darkOf("#111827")!;
    expect(L(bg)).toBeLessThan(0.25);
    expect(L(bg)).toBeGreaterThan(0.05);
    expect(L(fg)).toBeGreaterThan(0.75);
    expect(L(fg)).toBeLessThan(1);
  });

  it("keeps the text readable on the background it was made with", () => {
    const ratio = contrastRatio(darkOf("#111827")!, darkOf("#ffffff")!);
    expect(ratio).toBeGreaterThan(7);
  });

  it("keeps a color's hue", () => {
    for (const c of ["#1d4ed8", "#dc2626", "#16a34a", "#f59e0b"]) {
      const d = darkOf(c)!;
      expect(Math.abs(hue(d) - hue(c))).toBeLessThan(6);
    }
  });

  it("makes light colors dark and dark colors light", () => {
    expect(L(darkOf("#e5e7eb")!)).toBeLessThan(L("#e5e7eb"));
    expect(L(darkOf("#1f2937")!)).toBeGreaterThan(L("#1f2937"));
  });

  it("reads any notation, keeps transparency, and gives null for what isn't a color", () => {
    expect(darkOf("rgb(255 255 255)")).toBe(darkOf("#ffffff"));
    expect(darkOf("#ffffff80")!.length).toBe(9);
    expect(darkOf("var(--x)")).toBeNull();
  });
});
