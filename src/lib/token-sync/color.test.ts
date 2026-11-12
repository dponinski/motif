import { describe, expect, it } from "vitest";
import { formatLike, normalizeColor, parseColor, toHex } from "./color";

const close = (hex: string | null, expected: string, tolerance = 2) => {
  expect(hex).not.toBeNull();
  const a = parseColor(hex!)!, b = parseColor(expected)!;
  for (const k of ["r", "g", "b"] as const) expect(Math.abs(a[k] - b[k]), `${k} of ${hex} vs ${expected}`).toBeLessThanOrEqual(tolerance);
};

describe("normalizeColor", () => {
  it("reads hex in every length", () => {
    expect(normalizeColor("#fff")).toBe("#ffffff");
    expect(normalizeColor("#FFF8")).toBe("#ffffff88");
    expect(normalizeColor("#1A2B3C")).toBe("#1a2b3c".toLowerCase());
    expect(normalizeColor("#1a2b3c4d")).toBe("#1a2b3c4d");
  });

  it("reads rgb in modern, legacy and percentage forms", () => {
    expect(normalizeColor("rgb(255 0 128)")).toBe("#ff0080");
    expect(normalizeColor("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(normalizeColor("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
    expect(normalizeColor("rgb(0 0 0 / 50%)")).toBe("#00000080");
    expect(normalizeColor("rgb(100% 0% 0%)")).toBe("#ff0000");
  });

  it("reads hsl", () => {
    expect(normalizeColor("hsl(0 100% 50%)")).toBe("#ff0000");
    expect(normalizeColor("hsl(120, 100%, 25%)")).toBe("#008000");
    expect(normalizeColor("hsl(0.5turn 100% 50%)")).toBe("#00ffff");
  });

  it("reads oklch and oklab against known reference colors", () => {
    expect(normalizeColor("oklch(1 0 0)")).toBe("#ffffff");
    expect(normalizeColor("oklch(0 0 0)")).toBe("#000000");
    close(normalizeColor("oklch(0.62796 0.25768 29.23)"), "#ff0000");
    close(normalizeColor("oklch(0.45201 0.31321 264.05)"), "#0000ff");
    close(normalizeColor("oklch(86.64% 0.294827 142.4953)"), "#00ff00");
    close(normalizeColor("oklab(0.62796 0.22486 0.12585)"), "#ff0000");
    expect(normalizeColor("oklch(0.5 0.1 100 / 0.5)")).toMatch(/80$/);
  });

  it("accepts the few named colors Motif knows", () => {
    expect(normalizeColor("white")).toBe("#ffffff");
    expect(normalizeColor("Transparent")).toBe("#00000000");
  });

  it("returns null for anything it cannot turn into one color", () => {
    for (const v of ["var(--x)", "color-mix(in oklab, red, blue)", "calc(1 + 2)", "red", "rgb(1 2)", "rgb(a b c)", "#12", "oklch(1 0)", "0.5rem", ""]) {
      expect(normalizeColor(v), v).toBeNull();
    }
  });
});

describe("formatLike", () => {
  it("keeps hex as hex", () => {
    expect(formatLike("#123456", "#abcdef")).toBe("#abcdef");
    expect(formatLike("red", "#abcdef")).toBe("#abcdef");
  });

  it("writes rgb in the style the original used", () => {
    expect(formatLike("rgb(1 2 3)", "#ff0080")).toBe("rgb(255 0 128)");
    expect(formatLike("rgba(1, 2, 3, 1)", "#ff0080")).toBe("rgb(255, 0, 128)");
    expect(formatLike("rgb(0 0 0 / 0.1)", "#00000080")).toBe("rgb(0 0 0 / 0.502)");
  });

  it("writes hsl", () => {
    expect(formatLike("hsl(10 20% 30%)", "#ff0000")).toBe("hsl(0 100% 50%)");
    expect(formatLike("hsl(10, 20%, 30%)", "#008000")).toBe("hsl(120, 100%, 25%)");
  });

  it("writes oklch that reads back as the same color", () => {
    for (const hex of ["#ff0000", "#4f46e5", "#22c55e", "#808080", "#00000080"]) {
      const out = formatLike("oklch(0.5 0.1 100)", hex);
      expect(out.startsWith("oklch(")).toBe(true);
      close(normalizeColor(out), hex, 1);
    }
    expect(formatLike("oklch(0.5 0.1 100)", "#ffffff")).toBe("oklch(1 0 0)");
    expect(formatLike("oklch(0.5 0.1 100)", "#000000")).toBe("oklch(0 0 0)");
  });

  it("always writes something that reads back as exactly the same color", () => {
    // A deterministic spread of colors, with and without alpha, through every notation.
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const hex2 = () => Math.floor(next() * 256).toString(16).padStart(2, "0");
    for (let i = 0; i < 400; i++) {
      const hex = `#${hex2()}${hex2()}${hex2()}${i % 4 === 0 ? hex2() : ""}`;
      for (const original of ["oklch(0.5 0.1 100)", "hsl(10 20% 30%)", "hsl(10, 20%, 30%)", "rgb(1 2 3)", "rgba(1, 2, 3, 1)", "#123456", ""]) {
        expect(normalizeColor(formatLike(original, hex)), `${original} <- ${hex}`).toBe(hex);
      }
    }
  });

  it("round-trips through toHex", () => {
    expect(toHex({ r: 1.4, g: 2.6, b: 300, a: 1 })).toBe("#0103ff");
  });
});
