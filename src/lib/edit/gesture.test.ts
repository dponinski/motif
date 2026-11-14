import { describe, expect, it } from "vitest";
import { cleanEdits, tolerance, valueForPx } from "./gesture";
import type { Choice } from "./tokens";

const step = (value: string, px: number): Choice => ({ value, hint: `${px}px`, swatch: null, token: false });
const token = (value: string, px: number): Choice => ({ value, hint: `${px}px`, swatch: null, token: true });
const scale = [step("0", 0), step("1", 4), step("2", 8), step("4", 16), step("6", 24), step("8", 32), step("64", 256)];

describe("a size dragged on the canvas becomes a value in the repository's terms", () => {
  it("lands on a step of the scale that it is on, or near", () => {
    expect(valueForPx(16, { tokens: [], scale })).toBe("4");
    expect(valueForPx(17.4, { tokens: [], scale })).toBe("4");
    expect(valueForPx(0.6, { tokens: [], scale })).toBe("0");
    expect(valueForPx(256, { tokens: [], scale })).toBe("64");
  });

  it("prefers a token to a step of the same size", () => {
    expect(valueForPx(16, { tokens: [token("card-gap", 16)], scale })).toBe("card-gap");
    // …but a nearer step beats a token that is further off.
    expect(valueForPx(8, { tokens: [token("card-gap", 9)], scale })).toBe("2");
  });

  it("writes the size out only where nothing is near", () => {
    expect(valueForPx(20, { tokens: [], scale })).toBe("[20px]");
    expect(valueForPx(300, { tokens: [], scale })).toBe("[300px]");
    expect(valueForPx(13.337, { tokens: [], scale: [step("1", 4)] })).toBe("[13.34px]");
  });

  it("is a little more forgiving on large sizes", () => {
    expect(tolerance(10)).toBe(2);
    expect(tolerance(400)).toBe(12);
    expect(valueForPx(262, { tokens: [], scale })).toBe("64");
    expect(valueForPx(270, { tokens: [], scale })).toBe("[270px]");
  });

  it("reads a size from the value when the choice has no hint (a stylesheet's own steps)", () => {
    const css: Choice[] = ["0", "8px", "16px", "24px"].map((value) => ({ value, hint: null, swatch: null, token: false }));
    expect(valueForPx(16, { tokens: [], scale: css })).toBe("16px");
    expect(valueForPx(50, { tokens: [], scale: css })).toBe("[50px]");
  });

  it("never goes below nothing", () => {
    expect(valueForPx(-12, { tokens: [], scale })).toBe("0");
  });
});

describe("what the page may ask for", () => {
  it("lets through known groups with plain numbers, and nothing else", () => {
    expect(cleanEdits([{ group: "w", px: 120 }, { group: "pr", px: 12 }])).toEqual([{ group: "w", px: 120 }, { group: "pr", px: 12 }]);
    expect(cleanEdits([{ group: "background", px: 1 }, { group: "w", px: "9" }, { group: "w", px: NaN }, null, { group: "h", px: Infinity }])).toEqual([]);
    expect(cleanEdits("nope")).toEqual([]);
  });

  it("keeps sizes in a sane range and the list short", () => {
    expect(cleanEdits([{ group: "w", px: -5 }, { group: "h", px: 1e9 }])).toEqual([{ group: "w", px: 0 }, { group: "h", px: 10_000 }]);
    expect(cleanEdits(Array.from({ length: 20 }, () => ({ group: "p", px: 4 })))).toHaveLength(4);
  });
});
