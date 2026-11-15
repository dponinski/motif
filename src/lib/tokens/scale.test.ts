import { describe, expect, it } from "vitest";
import { colorRamp, fromLch, radiusScale, RAMP_STEPS, spacingScale, toLch, typeScale } from "./scale";
import { contrastRatio } from "./contrast";
import { normalizeColor } from "../token-sync/color";

describe("a color ramp", () => {
  const ramp = colorRamp("#6366f1")!;

  it("has a step for each of the usual ones, each a hex", () => {
    expect(ramp.map((r) => r.step)).toEqual(RAMP_STEPS);
    for (const r of ramp) {
      expect(r.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(r.dark).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("goes from light to dark, step by step", () => {
    const lightness = ramp.map((r) => toLch(r.light)!.L);
    for (let i = 1; i < lightness.length; i++) expect(lightness[i]).toBeLessThan(lightness[i - 1]);
  });

  it("keeps the color it was made from, exactly, at the step nearest to it", () => {
    expect(ramp.find((r) => r.light === "#6366f1")).toBeTruthy();
    const anchor = ramp.find((r) => r.light === "#6366f1")!;
    expect([400, 500, 600]).toContain(anchor.step);
  });

  it("keeps the hue", () => {
    const hue = toLch("#6366f1")!.H;
    for (const r of ramp.slice(2, 9)) {
      const h = toLch(r.light)!.H;
      expect(Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue))).toBeLessThan(8);
    }
  });

  it("turns the ramp over for a dark theme", () => {
    expect(ramp[0].dark).toBe(ramp[ramp.length - 1].light);
    expect(ramp[ramp.length - 1].dark).toBe(ramp[0].light);
    expect(ramp[5].dark).toBe(ramp[5].light);
  });

  it("makes the dark end dark enough for white text and the light end light enough for dark", () => {
    expect(contrastRatio(ramp[ramp.length - 2].light, "#ffffff")!).toBeGreaterThan(7);
    expect(contrastRatio(ramp[0].light, "#111111")!).toBeGreaterThan(12);
  });

  it("makes a gray ramp gray", () => {
    for (const r of colorRamp("#6b7280")!) expect(toLch(r.light)!.C).toBeLessThan(0.05);
    for (const r of colorRamp("#808080")!) expect(toLch(r.light)!.C).toBeLessThan(0.01);
  });

  it("starts from any notation Motif reads, and refuses what it can't", () => {
    expect(colorRamp("oklch(0.62 0.19 260)")).not.toBeNull();
    expect(colorRamp("rgb(99 102 241)")![5].light).toMatch(/^#/);
    expect(colorRamp("var(--x)")).toBeNull();
    expect(colorRamp("nope")).toBeNull();
  });

  it("handles a very light or a very dark start", () => {
    const pale = colorRamp("#eef2ff")!;
    expect(pale.find((r) => r.light === "#eef2ff")!.step).toBeLessThanOrEqual(100);
    const deep = colorRamp("#1e1b4b")!;
    expect(deep.find((r) => r.light === "#1e1b4b")!.step).toBeGreaterThanOrEqual(900);
  });

  it("makes the steps asked for, and puts steps between the neighbours' values", () => {
    const some = colorRamp("#6366f1", [100, 500, 900])!;
    expect(some.map((r) => r.step)).toEqual([100, 500, 900]);
    const mid = colorRamp("#6366f1", [50, 150, 950])!;
    const lightness = mid.map((r) => toLch(r.light)!.L);
    expect(lightness[0]).toBeGreaterThan(lightness[1]);
    expect(lightness[1]).toBeGreaterThan(lightness[2]);
    expect(colorRamp("#6366f1", [])).toBeNull();
  });

  it("keeps every color inside what a screen can show", () => {
    for (const base of ["#ff0000", "#00ff00", "#0000ff", "#ff00ff", "#ffff00"]) {
      for (const r of colorRamp(base)!) expect(normalizeColor(r.light)).toBe(r.light);
    }
  });
});

describe("OKLCH to hex", () => {
  it("brings the chroma down for a color a screen can't show", () => {
    const hex = fromLch({ L: 0.9, C: 0.35, H: 200 });
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(toLch(hex)!.C).toBeLessThan(0.35);
  });
  it("leaves a color that fits as it is", () => {
    const lch = toLch("#6366f1")!;
    expect(fromLch(lch)).toBe("#6366f1");
  });
});

describe("spacing, radius and type scales", () => {
  it("counts spacing in units", () => {
    expect(spacingScale(4, [1, 2, 4, 8])).toEqual([{ name: "space-1", value: 4 }, { name: "space-2", value: 8 }, { name: "space-4", value: 16 }, { name: "space-8", value: 32 }]);
    expect(spacingScale(4, [0.5, 1.5], "gap")).toEqual([{ name: "gap-0.5", value: 2 }, { name: "gap-1.5", value: 6 }]);
    expect(spacingScale().map((s) => s.name)).toContain("space-16");
  });
  it("makes radii in proportion to the medium one, and a full one", () => {
    expect(radiusScale(8)).toEqual([
      { name: "radius-sm", value: 4 }, { name: "radius-md", value: 8 }, { name: "radius-lg", value: 12 },
      { name: "radius-xl", value: 16 }, { name: "radius-2xl", value: 24 }, { name: "radius-full", value: 9999 },
    ]);
    expect(radiusScale(4).map((r) => r.value)).toEqual([2, 4, 6, 8, 12, 9999]);
  });
  it("makes a type scale that grows by the ratio from the base", () => {
    const scale = typeScale();
    expect(scale.map((t) => t.name)).toEqual(["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl"]);
    const base = scale.find((t) => t.name === "text-base")!;
    expect(base.fontSize).toBe(16);
    expect(scale.find((t) => t.name === "text-lg")!.fontSize).toBe(20);
    expect(scale.find((t) => t.name === "text-sm")!.fontSize).toBe(13);
    expect(scale.find((t) => t.name === "text-xs")!.fontSize).toBe(10);
    const sizes = scale.map((t) => t.fontSize);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
  });
  it("sets looser line heights for small text and tighter for large", () => {
    const scale = typeScale();
    const small = scale[0], large = scale[scale.length - 1];
    expect(small.lineHeight / small.fontSize).toBeGreaterThan(large.lineHeight / large.fontSize);
  });
  it("can go down less, and up less", () => {
    expect(typeScale({ below: 0, above: 1 }).map((t) => t.name)).toEqual(["text-base", "text-lg"]);
    expect(typeScale({ below: 1, above: 0, base: 14, ratio: 1.2, fontFamily: "Geist" }).map((t) => [t.name, t.fontSize, t.fontFamily])).toEqual([["text-sm", 11.5, "Geist"], ["text-base", 14, "Geist"]]);
  });
});
