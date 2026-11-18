import { describe, expect, it } from "vitest";
import { exportCss, exportTokens } from "../tokens/exports";
import { fromStored, toStored } from "../tokens/migrate";
import { emptyTokenData, type TokenData } from "../../store/design-system";
import { fixture } from "./fixture";
import { importDtcg } from "./import";

const empty = (): TokenData => ({
  ...emptyTokenData(),
  sets: [{ id: "set-a", name: "A", themes: [{ id: "t-l", name: "Light" }, { id: "t-d", name: "Dark" }], activeThemeId: "t-l" }],
});

describe("importing a design tokens file into a set", () => {
  it("reads the older form of values, and puts a color in every theme of the set", () => {
    const json = JSON.stringify({
      color: { $type: "color", brand: { $value: "#6366f1" }, ink: { $value: "{color.brand}" } },
      spacing: { $type: "dimension", "4": { $value: "16px" } },
    });
    const out = importDtcg(json, toStored(empty()), "set-a")!;
    expect(out.imported).toBe(3);
    const brand = out.data.tokens.find((t) => t.name === "brand")!;
    expect(brand.setId).toBe("set-a");
    expect(brand.values).toEqual({ "t-l": "#6366f1", "t-d": "#6366f1" });
    const ink = out.data.tokens.find((t) => t.name === "ink")!;
    expect(ink.ref).toEqual({ "t-l": brand.id, "t-d": brand.id });
    expect(out.data.tokens.find((t) => t.name === "4")).toMatchObject({ type: "number", unit: "px", values: { "*": "16" } });
  });

  it("leaves a token the set already has, and says so", () => {
    const first = importDtcg(JSON.stringify({ color: { $type: "color", brand: { $value: "#6366f1" } } }), toStored(empty()), "set-a")!;
    const again = importDtcg(JSON.stringify({ color: { $type: "color", brand: { $value: "#000000" }, other: { $value: "#111111" } } }), first.data, "set-a")!;
    expect(again.imported).toBe(1);
    expect(again.data.tokens.filter((t) => t.name === "brand")).toHaveLength(1);
    expect(again.notes.join(" ")).toMatch(/brand/);
  });

  it("is nothing for text that isn't a design tokens file", () => {
    expect(importDtcg("not json", toStored(empty()), "set-a")).toBeNull();
    expect(importDtcg("{}", toStored(empty()), "set-a")).toBeNull();
    expect(importDtcg(JSON.stringify({ a: 1 }), toStored(empty()), "set-a")).toBeNull();
  });

  it("takes back what the Tokens screen downloaded: names, values, references, text styles and shadows", () => {
    const source = fromStored(fixture());
    const json = exportTokens(source);
    const out = importDtcg(json, toStored(empty()), "set-a")!;
    const names = (m: { tokens: { name: string }[]; compositions: { name: string }[] }) => [...m.tokens.map((t) => t.name), ...m.compositions.map((c) => c.name)].sort();
    expect(out.imported).toBeGreaterThan(10);
    expect(names(out.data).sort()).toEqual(names(fixture()).sort());
    const accent = out.data.tokens.find((t) => t.name === "accent")!;
    expect(accent.ref).toBeDefined();
  });
});

describe("what the Tokens screen downloads", () => {
  it("is the base values of every set as design tokens, and the stylesheet they come to with each theme's changes", () => {
    const source = fromStored(fixture());
    const css = exportCss(source);
    expect(css.startsWith("@theme {")).toBe(true);
    expect(css).toContain("--color-gray-50: #f9fafb;");
    expect(css).toMatch(/\.dark \{[^}]*--color-gray-50: #1f2937;/);
    expect(css).not.toContain("Generated from");
    expect(JSON.parse(exportTokens(source)).color["gray-50"].$value).toMatchObject({ colorSpace: "srgb" });
  });
});
