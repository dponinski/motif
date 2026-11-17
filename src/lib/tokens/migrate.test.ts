import { describe, expect, it } from "vitest";
import { emptyTokenData, type TokenData } from "../../store/design-system";
import { ALL_THEMES, TOKENS_VERSION } from "./model";
import { emptyStoredTokenData, fromStored, legacyOf, migrateTokenData, toStored } from "./migrate";

const L = "theme-l", D = "theme-d";

// Every kind of token, in the forms the store holds them: aliases, per-theme values, optional fields present and absent.
function rich(): TokenData {
  return {
    sets: [
      { id: "set-a", name: "Primitives", themes: [{ id: L, name: "Light" }, { id: D, name: "Dark" }], activeThemeId: D },
      { id: "set-b", name: "Other", themes: [{ id: "t-x", name: "Default" }], activeThemeId: "t-x" },
    ],
    colors: [
      { id: "c1", name: "gray-50", value: "#111111", group: "gray", setId: "set-a", themeValues: { [L]: "#f9fafb", [D]: "#111111" } },
      { id: "c2", name: "surface", value: "#f9fafb", group: "semantic", setId: "set-a", themeValues: { [L]: "#f9fafb", [D]: "#111111" }, themeAlias: { [L]: "gray-50" }, repoName: "surface" },
      { id: "c3", name: "Brand Blue", value: "#1d4ed8", group: "brand", setId: "set-b", themeValues: { "t-x": "#1d4ed8" } },
    ],
    typography: [
      { id: "t1", name: "heading", fontFamily: "Inter", fontSize: 24, fontWeight: 700, lineHeight: 32, letterSpacing: -0.5, group: "text", setId: "set-a" },
      { id: "t2", name: "body", fontFamily: "Georgia, serif", fontSize: 16.5, fontWeight: 400, lineHeight: 24, setId: "set-a" },
    ],
    spacing: [
      { id: "s1", name: "space-1", value: 4, setId: "set-a" },
      { id: "s2", name: "space-2", value: 8.25, group: "base", setId: "set-a", repoName: "spacing-2" },
    ],
    radii: [{ id: "r1", name: "radius-md", value: 6, group: "base", setId: "set-a", repoName: "radius-md" }, { id: "r2", name: "pill", value: 9999, setId: "set-b" }],
    shadows: [
      { id: "h1", name: "card", x: 0, y: 1, blur: 3, spread: 0, color: "rgba(0,0,0,0.1)", group: "default", setId: "set-a", repoName: "shadow-card" },
      { id: "h2", name: "inner", x: 0, y: 2, blur: 4, spread: -1, color: "#00000020", group: "inner", setId: "set-a", inset: true, raw: "inset 0 2px 4px -1px #00000020, 0 1px 0 #fff" },
    ],
    numbers: [
      { id: "n1", name: "ratio", value: 1.25, unit: "", setId: "set-a" },
      { id: "n2", name: "text-lg", value: 1.125, unit: "rem", use: "font-size", group: "type", setId: "set-a", repoName: "text-lg" },
      { id: "n3", name: "gap-rem", value: 2, unit: "rem", use: "spacing", setId: "set-b" },
    ],
    strings: [{ id: "g1", name: "font-sans", value: "Inter, sans-serif", use: "font-family", group: "type", setId: "set-a" }, { id: "g2", name: "label", value: "Save", setId: "set-b" }],
    components: [{ id: "k1", name: "Button", category: "ui", description: "", defaultProps: { label: "Hi" } }],
  };
}

describe("the typed token model", () => {
  it("gives every kind of token its type: colors, numbers with a unit and where they belong, compositions", () => {
    const stored = toStored(rich());
    expect(stored.tokensVersion).toBe(TOKENS_VERSION);
    expect(stored.tokens.filter((t) => t.type === "color").map((t) => t.name)).toEqual(["gray-50", "surface", "Brand Blue"]);
    const space = stored.tokens.find((t) => t.id === "s2")!;
    expect(space).toMatchObject({ type: "number", unit: "px", use: "spacing", values: { [ALL_THEMES]: "8.25" }, repoName: "spacing-2" });
    expect(stored.tokens.find((t) => t.id === "r1")).toMatchObject({ type: "number", unit: "px", use: "radius" });
    const heading = stored.compositions.find((c) => c.id === "t1")!;
    expect(heading.kind).toBe("typography");
    expect(heading.slots.map((s) => `${s.name}:${s.type}`)).toEqual(["font-family:string", "font-size:number", "font-weight:number", "line-height:number", "letter-spacing:number"]);
    expect(stored.compositions.find((c) => c.id === "t2")!.slots.some((s) => s.name === "letter-spacing")).toBe(false);
    const shadow = stored.compositions.find((c) => c.id === "h1")!;
    expect(shadow.kind).toBe("shadow");
    expect(shadow.slots.map((s) => s.name)).toEqual(["x", "y", "blur", "spread", "color"]);
  });

  it("makes an alias a reference to the other token's id", () => {
    const surface = toStored(rich()).tokens.find((t) => t.id === "c2")!;
    expect(surface.ref).toEqual({ [L]: "c1" });
    expect(toStored(rich()).tokens.find((t) => t.id === "c1")!.ref).toBeUndefined();
  });

  it("loses nothing going to the typed model and back", () => {
    const data = rich();
    expect(fromStored(toStored(data))).toEqual(data);
  });

  it("keeps the order each kind of token had", () => {
    const data = rich();
    data.colors = [...data.colors].reverse();
    data.spacing = [...data.spacing].reverse();
    const back = fromStored(toStored(data));
    expect(back.colors.map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
    expect(back.spacing.map((c) => c.id)).toEqual(["s2", "s1"]);
  });

  it("is the same after a trip through JSON, which is what a project goes through", () => {
    const stored = toStored(rich());
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
    expect(fromStored(JSON.parse(JSON.stringify(stored)))).toEqual(rich());
  });

  it("lets a renamed color keep being what the alias said, since the reference is the id, not the name", () => {
    const stored = toStored(rich());
    stored.tokens = stored.tokens.map((t) => (t.id === "c1" ? { ...t, name: "gray-100" } : t));
    const back = fromStored(stored);
    expect(back.colors.find((c) => c.id === "c2")!.themeAlias).toEqual({ [L]: "gray-100" });
  });

  it("drops an alias to a token that isn't there, and keeps the color it came to", () => {
    const data = rich();
    data.colors[1] = { ...data.colors[1], themeAlias: { [L]: "gone" } };
    const stored = toStored(data);
    expect(stored.tokens.find((t) => t.id === "c2")!.ref).toBeUndefined();
    expect(fromStored(stored).colors[1]).toMatchObject({ value: "#f9fafb", themeValues: { [L]: "#f9fafb" } });
    expect(fromStored(stored).colors[1].themeAlias).toBeUndefined();
  });
});

describe("migrating what a project holds", () => {
  it("reads the five lists of an earlier version", () => {
    const old = rich();
    const stored = migrateTokenData(old);
    expect(stored.tokensVersion).toBe(TOKENS_VERSION);
    expect(stored).toEqual(toStored(old));
    expect(legacyOf(old)).toEqual(old);
  });

  it("reads the typed model, and is the same when it is read again", () => {
    const stored = toStored(rich());
    expect(migrateTokenData(stored)).toEqual(stored);
    expect(migrateTokenData(migrateTokenData(rich()))).toEqual(migrateTokenData(rich()));
  });

  it("fills in what an older or partial project lacks", () => {
    const partial = { sets: [], colors: [{ id: "c", name: "a", value: "#fff", group: "g", setId: "set-global", themeValues: { "theme-default": "#fff" } }] };
    const stored = migrateTokenData(partial);
    expect(stored.sets).toEqual(emptyTokenData().sets);
    expect(stored.tokens).toHaveLength(1);
    expect(stored.compositions).toEqual([]);
    expect(stored.components).toEqual([]);
  });

  it("gives an empty project's tokens for what can't be read", () => {
    for (const nothing of [undefined, null, 3, "x", [], {}]) expect(migrateTokenData(nothing)).toEqual(emptyStoredTokenData());
    expect(legacyOf(null)).toEqual(emptyTokenData());
  });

  it("is an empty store's tokens for an empty project, one empty set", () => {
    const stored = emptyStoredTokenData();
    expect(stored.sets).toHaveLength(1);
    expect(stored.tokens).toEqual([]);
    expect(stored.compositions).toEqual([]);
  });

  it("keeps a number that isn't spacing or a radius in pixels, and a string, in lists of their own", () => {
    const stored = toStored(rich());
    expect(stored.tokens.find((t) => t.id === "n2")).toMatchObject({ type: "number", unit: "rem", use: "font-size", values: { [ALL_THEMES]: "1.125" }, repoName: "text-lg" });
    expect(stored.tokens.find((t) => t.id === "n1")).toMatchObject({ type: "number", unit: "" });
    expect(stored.tokens.find((t) => t.id === "g1")).toMatchObject({ type: "string", use: "font-family", values: { [ALL_THEMES]: "Inter, sans-serif" } });
    const back = fromStored(stored);
    expect(back.numbers.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(back.strings.map((n) => n.id)).toEqual(["g1", "g2"]);
    // A spacing in rem isn't the pixels the repository's sync knows, so it stays a number.
    expect(back.spacing.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(back).toEqual(rich());
  });
});
