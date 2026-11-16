import { describe, expect, it } from "vitest";
import { memorySource, scanRepository } from "../repo-scan";
import { loadFixture } from "../repo-scan/fixtures";
import { readMotifTokens, readRepoTokens, type SyncDoc } from "../token-sync/doc";
import { keyPrefixes } from "../token-sync/keys";
import { buildTokenIndex } from "./tokens";
import { classValueOf, makePlans, motifOnlyTokens } from "./motif-tokens";

const analysis = await scanRepository(memorySource(loadFixture("motif-test-system")), { repo: "a/b", ref: "main" }, { tokensOnly: true });
const doc: SyncDoc = {
  ...readRepoTokens(analysis.tokens, analysis.themes).doc,
  brand: { kind: "color", values: { light: "#1d4ed8", dark: "#60a5fa" } },
  "radius-card": { kind: "radius", values: { light: "10" } },
  "spacing-gutter": { kind: "spacing", values: { light: "12" } },
  "shadow-new": { kind: "shadow", values: { light: "0 1px 2px 0 #00000010" } },
};

describe("which tokens a repository can take", () => {
  it("a Tailwind 4 repository with aliased colors and an @theme of radii", () => {
    const plans = makePlans(analysis.tokens, 4);
    expect(plans.color).toEqual({ prefix: "" });
    expect(plans.radius).toEqual({ prefix: "radius-" });
    // Nothing is refused: the fixture has no @theme block of spacing or shadows, and one is made when they are written.
    expect(plans.spacing).toEqual({ prefix: "spacing-" });
    expect(plans.shadow).toEqual({ prefix: "shadow-" });
  });
  it("a repository that declares its colors right in @theme names a new one that way", async () => {
    const direct = await scanRepository(memorySource({ "package.json": '{"devDependencies":{"tailwindcss":"^4.0.0"}}', "src/app.css": '@import "tailwindcss";\n@theme {\n  --color-brand-500: #1d4ed8;\n}\n' }), { repo: "a/b", ref: "main" }, { tokensOnly: true });
    expect(makePlans(direct.tokens, 4).color).toEqual({ prefix: "color-" });
  });
  it("plain CSS takes anything", () => {
    expect(makePlans([], null).radius).toEqual({ prefix: "" });
  });
  it("Tailwind 3 takes a token where there is a config with tokens in it", async () => {
    expect("reason" in makePlans([], 3).color).toBe(true);
    const v3 = await scanRepository(memorySource(loadFixture("motif-test-system-v3")), { repo: "a/b", ref: "main" }, { tokensOnly: true });
    expect(makePlans(v3.tokens, 3)).toEqual({ color: { prefix: "" }, radius: { prefix: "radius-" }, spacing: { prefix: "spacing-" }, shadow: { prefix: "shadow-" } });
  });
  it("a class value leaves out the prefix", () => {
    expect(classValueOf("radius-card", { prefix: "radius-" })).toBe("card");
    expect(classValueOf("brand", { prefix: "" })).toBe("brand");
  });
});

describe("tokens only Motif has", () => {
  const { tokens, themeCss } = motifOnlyTokens(doc, analysis.tokens, 4);
  it("are the ones a class could name", () => {
    expect(tokens.map((t) => t.name).sort()).toEqual(["brand", "radius-card", "shadow-new", "spacing-gutter"]);
  });
  it("are given to Tailwind in the preview", () => {
    expect(themeCss).toBe("@theme inline {\n  --color-brand: var(--brand);\n}\n@theme {\n  --radius-card: 10px;\n  --spacing-gutter: 12px;\n  --shadow-new: 0 1px 2px 0 #00000010;\n}");
  });
  it("show up in the inspector's index like the repository's own", () => {
    const index = buildTokenIndex([...analysis.tokens, ...tokens], analysis.themes, 4);
    expect(index.byRole.color.find((c) => c.value === "brand")?.values).toEqual({ light: "#1d4ed8", dark: "#60a5fa" });
    expect(index.byRole.radius.find((c) => c.value === "card")?.values.light).toBe("10px");
  });
  it("need no Tailwind input in a stylesheet", () => {
    const css = motifOnlyTokens({ brand: doc.brand, "radius-card": doc["radius-card"], "shadow-new": doc["shadow-new"] }, [], null);
    expect(css.themeCss).toBe("");
    expect(css.tokens.map((t) => t.name).sort()).toEqual(["brand", "radius-card", "shadow-new"]);
  });
});

describe("the name a token made in Motif has in the repository", () => {
  const slices = (name: string, kind: "radii" | "spacing" | "shadows") => ({
    colors: [], spacing: [], radii: [], shadows: [],
    [kind]: [kind === "radii" ? { id: "1", name, value: 10, setId: "s" } : kind === "spacing" ? { id: "1", name, value: 12, setId: "s" } : { id: "1", name, x: 0, y: 1, blur: 2, spread: 0, color: "#000000", setId: "s" }],
  });
  const link = { setId: "s", themes: { light: "t" }, baseTheme: "light", prefixes: keyPrefixes(analysis) };
  it("starts with what its kind needs, so a class names it whatever it was called", () => {
    expect(Object.keys(readMotifTokens(slices("card", "radii"), link))).toEqual(["radius-card"]);
    expect(Object.keys(readMotifTokens(slices("space-1", "spacing"), link))).toEqual(["spacing-space-1"]);
    expect(Object.keys(readMotifTokens(slices("lifted", "shadows"), link))).toEqual(["shadow-lifted"]);
  });
  it("is left as it is when it starts with that already, or came from the repository", () => {
    expect(Object.keys(readMotifTokens(slices("radius-card", "radii"), link))).toEqual(["radius-card"]);
    const named = slices("x", "radii");
    (named.radii[0] as { repoName?: string }).repoName = "corner";
    expect(Object.keys(readMotifTokens(named, link))).toEqual(["corner"]);
  });
  it("is not changed without Tailwind, where a token is a variable", () => {
    expect(Object.keys(readMotifTokens(slices("card", "radii"), { ...link, prefixes: keyPrefixes({ tokens: [], stack: { tailwindVersion: null } as never }) }))).toEqual(["card"]);
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
