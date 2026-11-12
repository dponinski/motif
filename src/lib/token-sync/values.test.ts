import { describe, expect, it } from "vitest";
import { formatLength, formatShadow, normalizeShadow, parseLengthPx, parseShadow } from "./values";

describe("lengths", () => {
  it("reads px and rem as px", () => {
    expect(parseLengthPx("0.5rem")).toBe(8);
    expect(parseLengthPx("12px")).toBe(12);
    expect(parseLengthPx("-2px")).toBe(-2);
    expect(parseLengthPx("0")).toBe(0);
    expect(parseLengthPx(".25rem")).toBe(4);
  });

  it("refuses units and expressions Motif cannot hold as a number", () => {
    for (const v of ["1", "50%", "1em", "calc(1rem + 2px)", "var(--x)", "auto", ""]) expect(parseLengthPx(v), v).toBeNull();
  });

  it("writes lengths in the unit the repo used", () => {
    expect(formatLength(8, "0.5rem")).toBe("0.5rem");
    expect(formatLength(12, "0.75rem")).toBe("0.75rem");
    expect(formatLength(10, "0.5rem")).toBe("0.625rem");
    expect(formatLength(6, "4px")).toBe("6px");
    expect(formatLength(6)).toBe("6px");
    expect(formatLength(0, "4px")).toBe("0");
    expect(formatLength(0.5, "1rem")).toBe("0.03125rem");
    expect(formatLength(0.01, "1rem")).toBe("0.000625rem");
    for (const px of [1, 2.5, 3, 7, 10, 13, 100, 0.25]) expect(parseLengthPx(formatLength(px, "0.5rem")), String(px)).toBe(px);
  });
});

describe("shadows", () => {
  const card = "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)";

  it("reads layers with functional colors, inset and any order", () => {
    const layers = parseShadow(card)!;
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({ x: 0, y: 1, blur: 2, spread: 0, color: "#0000000a", inset: false });
    expect(parseShadow("inset 0 2px 4px #0000000f")![0].inset).toBe(true);
    expect(parseShadow("rgb(0 0 0 / 0.1) 0 1px 2px")![0]).toMatchObject({ y: 1, blur: 2, spread: 0 });
    expect(parseShadow("0 10px 30px -10px rgb(0 0 0 / 0.25)")![0].spread).toBe(-10);
  });

  it("refuses values that are not a plain shadow list", () => {
    for (const v of ["none", "0 1px", "0 1px 2px", "0 1px 2px 3px 4px red", "var(--s)", "0 1px 2px #000 #fff"]) expect(parseShadow(v), v).toBeNull();
  });

  it("compares shadows by what they draw, not how they are written", () => {
    expect(normalizeShadow("0 1px 2px 0 rgb(0 0 0 / 0.04)")).toBe(normalizeShadow("0px 1px 2px #0000000a"));
    expect(normalizeShadow("0 1px 2px 0 #000")).not.toBe(normalizeShadow("0 2px 2px 0 #000"));
    expect(normalizeShadow("nonsense")).toBeNull();
  });

  it("rewrites the first layer and keeps the rest and the untouched color text", () => {
    const layer = { x: 0, y: 2, blur: 2, spread: 0, color: "#0000000a" };
    expect(formatShadow(layer, card)).toBe("0 2px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)");
    expect(formatShadow({ ...layer, color: "#ff0000" }, card)).toBe("0 2px 2px 0 rgb(255 0 0), 0 1px 3px 0 rgb(0 0 0 / 0.06)");
    expect(formatShadow({ x: 0, y: 4, blur: 6, spread: -1, color: "#0000001a" })).toBe("0 4px 6px -1px #0000001a");
  });
});
