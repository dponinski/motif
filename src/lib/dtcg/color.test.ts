import { describe, expect, it } from "vitest";
import { colorToCss, cssToColor } from "./color";
import { leafOf, namespaceOf, pathOf, pathOfRef, refOf, slug, variableOf } from "./names";

describe("a CSS color as a design tokens color", () => {
  it("is srgb with its hex for a hex, rgb() or named color", () => {
    expect(cssToColor("#f9fafb")).toEqual({ colorSpace: "srgb", components: [0.9765, 0.9804, 0.9843], hex: "#f9fafb" });
    expect(cssToColor("rgb(249 250 251)")).toMatchObject({ colorSpace: "srgb", hex: "#f9fafb" });
    expect(cssToColor("#000000")).toMatchObject({ colorSpace: "srgb", components: [0, 0, 0] });
  });

  it("keeps the alpha apart from the color", () => {
    expect(cssToColor("#11223380")).toMatchObject({ colorSpace: "srgb", hex: "#112233", alpha: 0.502 });
    expect(cssToColor("rgb(0 0 0 / 0.5)")).toMatchObject({ alpha: 0.5, hex: "#000000" });
  });

  it("keeps hsl, oklch and display-p3 as they are", () => {
    expect(cssToColor("hsl(220 14% 96%)")).toEqual({ colorSpace: "hsl", components: [220, 14, 96] });
    expect(cssToColor("oklch(0.6 0.2 260)")).toEqual({ colorSpace: "oklch", components: [0.6, 0.2, 260] });
    expect(cssToColor("oklch(60% 0.2 0.5turn / 50%)")).toEqual({ colorSpace: "oklch", components: [0.6, 0.2, 180], alpha: 0.5 });
    expect(cssToColor("color(display-p3 0.1 0.8 0.3)")).toEqual({ colorSpace: "display-p3", components: [0.1, 0.8, 0.3] });
  });

  it("isn't one for what isn't a color Motif can read", () => {
    for (const bad of ["var(--x)", "color-mix(in srgb, red, blue)", "calc(1 + 2)", "nonsense", "oklch(0.5 0.1)"]) expect(cssToColor(bad)).toBeNull();
  });

  it("reads back as the notation it was written in", () => {
    for (const css of ["#f9fafb", "#11223380", "hsl(220 14% 96%)", "oklch(0.6 0.2 260)", "color(display-p3 0.1 0.8 0.3)", "hsl(220 14% 96% / 0.5)"]) {
      expect(colorToCss(cssToColor(css)!)).toBe(css);
    }
  });

  it("writes an srgb color without its hex from the components", () => {
    expect(colorToCss({ colorSpace: "srgb", components: [1, 0, 0.5] })).toBe("#ff0080");
    expect(colorToCss({ colorSpace: "srgb", components: [0, 0, 0], alpha: 0.5 })).toBe("#00000080");
  });

  it("doesn't write a color space Motif doesn't know", () => {
    expect(colorToCss({ colorSpace: "lab", components: [50, 10, 10] })).toBeNull();
    expect(colorToCss({ colorSpace: "srgb", components: [1, 0] as never })).toBeNull();
  });
});

describe("where a token is in a file", () => {
  it("is under the namespace its use says, and a plain one at the top level", () => {
    expect(pathOf("color", "color", "brand")).toEqual(["color", "brand"]);
    expect(pathOf("number", "spacing", "gutter")).toEqual(["spacing", "gutter"]);
    expect(pathOf("number", "font-size", "lg")).toEqual(["text", "lg"]);
    expect(pathOf("number", "line-height", "tight")).toEqual(["leading", "tight"]);
    expect(pathOf("string", "font-family", "sans")).toEqual(["font", "sans"]);
    expect(pathOf("number", undefined, "Ratio")).toEqual(["ratio"]);
    expect(namespaceOf("number", "something-new")).toBe("");
  });

  it("leaves out what the namespace already says", () => {
    expect(leafOf("space-4", "spacing")).toBe("4");
    expect(leafOf("spacing-4", "spacing")).toBe("4");
    expect(leafOf("radius-md", "radius")).toBe("md");
    expect(leafOf("color-brand", "color")).toBe("brand");
    expect(leafOf("gray-50", "color")).toBe("gray-50");
    expect(leafOf("space", "spacing")).toBe("space");
  });

  it("makes a name a path part, and a variable of the path", () => {
    expect(slug("Brand Blue")).toBe("brand-blue");
    expect(slug("2xl")).toBe("t-2xl");
    expect(slug("4")).toBe("4");
    expect(slug("a.b")).toBe("a-b");
    expect(variableOf(["color", "gray-50"])).toBe("--color-gray-50");
  });

  it("writes and reads a reference", () => {
    expect(refOf(["color", "gray-50"])).toBe("{color.gray-50}");
    expect(pathOfRef("{color.gray-50}")).toEqual(["color", "gray-50"]);
    expect(pathOfRef("#fff")).toBeNull();
  });
});
