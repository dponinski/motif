import { describe, expect, it } from "vitest";
import { contrastRatio, gradeOf, hexOf } from "./contrast";

describe("contrast", () => {
  it("is 21 for black on white and 1 for a color on itself, either way round", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#6366f1", "#6366f1")).toBeCloseTo(1, 5);
  });
  it("reads any notation Motif reads", () => {
    expect(contrastRatio("oklch(1 0 0)", "rgb(0 0 0)")).toBeCloseTo(21, 0);
  });
  it("is null for what can't be read", () => {
    expect(contrastRatio("var(--x)", "#fff")).toBeNull();
  });
  it("grades by the WCAG thresholds", () => {
    expect(gradeOf(21)).toBe("AAA");
    expect(gradeOf(7)).toBe("AAA");
    expect(gradeOf(4.5)).toBe("AA");
    expect(gradeOf(3)).toBe("AA large");
    expect(gradeOf(2.9)).toBe("fails");
    // Indigo on white is the known 4.47 ... close to AA; a mid gray fails.
    expect(gradeOf(contrastRatio("#777777", "#ffffff")!)).toBe("AA large");
  });
  it("shows a color as hex, or as typed when it can't be read", () => {
    expect(hexOf("rgb(99 102 241)")).toBe("#6366f1");
    expect(hexOf("var(--x)")).toBe("var(--x)");
  });
});
