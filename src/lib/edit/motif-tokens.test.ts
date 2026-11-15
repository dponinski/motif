import { describe, expect, it } from "vitest";
import { memorySource, scanRepository } from "../repo-scan";
import { loadFixture } from "../repo-scan/fixtures";
import { readRepoTokens, type SyncDoc } from "../token-sync/doc";
import { buildTokenIndex } from "./tokens";
import { classValueOf, makePlans, motifOnlyTokens } from "./motif-tokens";

const analysis = await scanRepository(memorySource(loadFixture("motif-test-system")), { repo: "a/b", ref: "main" }, { tokensOnly: true });
const doc: SyncDoc = {
  ...readRepoTokens(analysis.tokens, analysis.themes).doc,
  brand: { kind: "color", values: { light: "#1d4ed8", dark: "#60a5fa" } },
  "radius-card": { kind: "radius", values: { light: "10" } },
  gutter: { kind: "spacing", values: { light: "12" } },
  "spacing-gutter": { kind: "spacing", values: { light: "12" } },
  "shadow-new": { kind: "shadow", values: { light: "0 1px 2px 0 #00000010" } },
};

describe("which tokens a repository can take", () => {
  it("a Tailwind 4 repository with aliased colors and an @theme of radii", () => {
    const plans = makePlans(analysis.tokens, 4);
    expect(plans.color).toEqual({ prefix: "" });
    expect(plans.radius).toEqual({ prefix: "radius-" });
    // The fixture has no @theme block of spacing, so none could be added to.
    expect("reason" in plans.spacing).toBe(true);
  });
  it("plain CSS takes anything, Tailwind 3 nothing", () => {
    expect(makePlans([], null).radius).toEqual({ prefix: "" });
    expect("reason" in makePlans([], 3).color).toBe(true);
  });
  it("a class value leaves out the prefix", () => {
    expect(classValueOf("radius-card", { prefix: "radius-" })).toBe("card");
    expect(classValueOf("brand", { prefix: "" })).toBe("brand");
  });
});

describe("tokens only Motif has", () => {
  const { tokens, themeCss } = motifOnlyTokens(doc, analysis.tokens, 4);
  it("are the ones a class could name", () => {
    expect(tokens.map((t) => t.name).sort()).toEqual(["brand", "radius-card"]);
  });
  it("are given to Tailwind in the preview", () => {
    expect(themeCss).toBe("@theme inline {\n  --color-brand: var(--brand);\n}\n@theme {\n  --radius-card: 10px;\n}");
  });
  it("show up in the inspector's index like the repository's own", () => {
    const index = buildTokenIndex([...analysis.tokens, ...tokens], analysis.themes, 4);
    expect(index.byRole.color.find((c) => c.value === "brand")?.values).toEqual({ light: "#1d4ed8", dark: "#60a5fa" });
    expect(index.byRole.radius.find((c) => c.value === "card")?.values.light).toBe("10px");
  });
  it("need no Tailwind input in a stylesheet", () => {
    const css = motifOnlyTokens({ brand: doc.brand, "radius-card": doc["radius-card"], gutter: doc.gutter, "shadow-new": doc["shadow-new"] }, [], null);
    expect(css.themeCss).toBe("");
    expect(css.tokens.map((t) => t.name).sort()).toEqual(["brand", "gutter", "radius-card"]);
  });
});

describe("a written-out value as a token's value", () => {
  it("reads colors and lengths between brackets", async () => {
    const { rawValue } = await import("./motif-tokens");
    expect(rawValue("color", "[#1d4ed8]")).toEqual({ kind: "color", value: "#1d4ed8", opacity: null });
    expect(rawValue("color", "[oklch(0.52_0.21_270)]/50")).toMatchObject({ kind: "color", opacity: "50" });
    expect(rawValue("radius", "[10px]")).toEqual({ kind: "radius", value: "10px", px: 10, opacity: null });
    expect(rawValue("spacing", "[0.75rem]")).toMatchObject({ px: 12 });
  });
  it("in a stylesheet, plain values", async () => {
    const { rawValue } = await import("./motif-tokens");
    expect(rawValue("color", "#fff")?.value).toBe("#ffffff");
    expect(rawValue("radius", "6px")?.px).toBe(6);
  });
  it("refuses what is not a value Motif can hold", async () => {
    const { rawValue } = await import("./motif-tokens");
    expect(rawValue("color", "red-500")).toBeNull();
    expect(rawValue("color", "[var(--x)]")).toBeNull();
    expect(rawValue("radius", "[9999px]")).toBeNull();
    expect(rawValue("spacing", "[calc(1px+2px)]")).toBeNull();
  });
  it("finds a free name", async () => {
    const { freeName } = await import("./motif-tokens");
    expect(freeName((n) => ["custom", "custom-2"].includes(n))).toBe("custom-3");
  });
});
