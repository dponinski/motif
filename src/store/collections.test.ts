import { beforeEach, describe, expect, it } from "vitest";
import { readMotifTokens } from "../lib/token-sync/doc";
import { fromStored, toStored } from "../lib/tokens/migrate";
import { dependentsOf, targetKey } from "../lib/tokens/alias-colors";
import { emptyTokenData, snapshotTokens, useDesignSystemStore } from "./design-system";
import { editTokens, redoTokens, undoTokens, useTokenHistory } from "./token-history";

// Two sets that work together: primitive colors, and semantic ones that are those colors.

const store = () => useDesignSystemStore.getState();
const color = (name: string, setId?: string) => store().colors.find((c) => c.name === name && (!setId || c.setId === setId))!;

let PRIM: string, SEM: string, pl: string, pd: string, sl: string, sd: string;

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useTokenHistory.setState({ past: [], future: [] });
  PRIM = store().sets[0].id;
  store().renameSet(PRIM, "Primitives");
  pl = store().sets[0].themes[0].id;
  store().renameTheme(PRIM, pl, "Light");
  pd = store().addThemeToSet(PRIM, "Dark");
  SEM = store().createSet("Semantic");
  sl = store().sets.find((s) => s.id === SEM)!.themes[0].id;
  store().renameTheme(SEM, sl, "Light");
  sd = store().addThemeToSet(SEM, "Dark");
  store().addColor({ name: "gray-50", value: "#f9fafb", group: "gray", setId: PRIM });
  store().addColor({ name: "gray-900", value: "#111827", group: "gray", setId: PRIM });
  store().updateColorThemeValue(color("gray-50").id, pd, "#1f2937");
  store().updateColorThemeValue(color("gray-900").id, pd, "#f3f4f6");
  store().addColor({ name: "surface", value: "#ffffff", group: "semantic", setId: SEM });
  store().addColor({ name: "text", value: "#000000", group: "semantic", setId: SEM });
});

describe("a color that is a color of another set", () => {
  it("is that color, in the theme of its own set that has the same name", () => {
    expect(store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`)).toBe(true);
    expect(store().setColorAlias(color("surface").id, sd, `${PRIM}/gray-50`)).toBe(true);
    expect(color("surface").themeAlias).toEqual({ [sl]: `${PRIM}/gray-50`, [sd]: `${PRIM}/gray-50` });
    expect(color("surface").themeValues[sl]).toBe("#f9fafb");
    expect(color("surface").themeValues[sd]).toBe("#1f2937");
  });

  it("follows that color when it changes", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    store().setColorText(color("gray-50").id, pl, "#eeeeee");
    expect(color("surface").themeValues[sl]).toBe("#eeeeee");
    expect(color("surface").value).toBe("#eeeeee");
  });

  it("takes the open theme of the other set when it has no theme of that name", () => {
    store().renameTheme(SEM, sd, "Night");
    store().setActiveTheme(PRIM, pd);
    store().setColorAlias(color("surface").id, sd, `${PRIM}/gray-50`);
    expect(color("surface").themeValues[sd]).toBe("#1f2937");
  });

  it("goes through a chain of colors in several sets", () => {
    const third = store().createSet("Component");
    const tl = store().sets.find((s) => s.id === third)!.themes[0];
    store().renameTheme(third, tl.id, "Light");
    store().addColor({ name: "button", value: "#000000", group: "component", setId: third });
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    store().setColorAlias(color("button").id, tl.id, `${SEM}/surface`);
    store().setColorText(color("gray-50").id, pl, "#dddddd");
    expect(color("button").themeValues[tl.id]).toBe("#dddddd");
  });

  it("is refused when it would lead back to itself, across sets too", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    expect(store().setColorAlias(color("gray-50").id, pl, `${SEM}/surface`)).toBe(false);
    expect(store().setColorAlias(color("surface").id, sl, `${SEM}/surface`)).toBe(false);
    expect(store().setColorAlias(color("surface").id, sl, `${PRIM}/missing`)).toBe(false);
  });

  it("is still that color when it is renamed", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    store().renameToken("color", color("gray-50").id, "gray-100");
    expect(color("surface").themeAlias).toEqual({ [sl]: `${PRIM}/gray-100` });
    expect(color("surface").themeValues[sl]).toBe("#f9fafb");
  });

  it("is listed as one of the colors that use it", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    store().setColorAlias(color("text").id, sl, `${PRIM}/gray-900`);
    expect(dependentsOf(store().colors, color("gray-50")).map((c) => c.name)).toEqual(["surface"]);
    expect(dependentsOf(store().colors, color("gray-900")).map((c) => c.name)).toEqual(["text"]);
  });
});

describe("colors moved to another set", () => {
  it("that are used by colors of another set are still used by them", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    const third = store().createSet("Archive");
    store().moveTokensToSet("color", [color("gray-50").id], third);
    expect(color("gray-50").setId).toBe(third);
    expect(color("surface").themeAlias).toEqual({ [sl]: `${third}/gray-50` });
    store().setColorText(color("gray-50").id, store().sets.find((s) => s.id === third)!.themes[0].id, "#abcdef");
    expect(color("surface").themeValues[sl]).toBe("#abcdef");
  });

  it("keep being the colors they were, which are now in another set", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    store().setColorAlias(color("surface").id, sd, `${PRIM}/gray-50`);
    const third = store().createSet("Archive");
    store().moveTokensToSet("color", [color("surface").id], third);
    const surface = color("surface");
    expect(surface.setId).toBe(third);
    const archive = store().sets.find((s) => s.id === third)!;
    expect(Object.values(surface.themeAlias ?? {})).toEqual([`${PRIM}/gray-50`]);
    expect(surface.themeValues[archive.activeThemeId]).toBe("#f9fafb");
  });

  it("stay colors of each other when they move together", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    store().moveTokensToSet("color", [color("gray-50").id, color("surface").id], SEM);
    expect(color("surface").themeAlias).toEqual({ [sl]: "gray-50" });
    expect(color("surface").themeValues[sl]).toBe("#f9fafb");
  });

  it("are a token of Motif's own in the new set, whatever the repository called them", () => {
    store().renameSet(PRIM, "Primitives");
    store().updateColor(color("gray-50").id, { repoName: "gray-50" });
    store().moveTokensToSet("color", [color("gray-50").id], SEM);
    expect(color("gray-50").repoName).toBeUndefined();
  });
});

describe("a set that is deleted", () => {
  it("leaves the colors of other sets that were its colors as the colors they came to, and says how many", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    store().setColorAlias(color("surface").id, sd, `${PRIM}/gray-50`);
    store().setColorAlias(color("text").id, sl, `${PRIM}/gray-900`);
    const detached = store().deleteSet(PRIM);
    expect(detached).toBe(3);
    expect(color("surface").themeAlias).toBeUndefined();
    expect(color("surface").themeValues[sl]).toBe("#f9fafb");
    expect(color("surface").themeValues[sd]).toBe("#1f2937");
    expect(color("text").themeValues[sl]).toBe("#111827");
    expect(store().colors.map((c) => c.name)).toEqual(["surface", "text"]);
  });

  it("says none when nothing was one of them", () => {
    expect(store().deleteSet(SEM)).toBe(0);
  });

  it("is one step of undo with its aliases", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    editTokens(() => store().deleteSet(PRIM));
    expect(color("surface").themeAlias).toBeUndefined();
    undoTokens();
    expect(color("surface").themeAlias).toEqual({ [sl]: `${PRIM}/gray-50` });
    expect(store().colors.some((c) => c.name === "gray-50")).toBe(true);
    redoTokens();
    expect(color("surface").themeAlias).toBeUndefined();
  });
});

describe("saved and sent", () => {
  it("keeps an alias across sets in the typed model, as the id of the token, and gives it back", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    const stored = toStored(snapshotTokens(store()));
    expect(stored.tokens.find((t) => t.name === "surface")!.ref).toEqual({ [sl]: color("gray-50").id });
    expect(fromStored(JSON.parse(JSON.stringify(stored))).colors.find((c) => c.name === "surface")!.themeAlias).toEqual({ [sl]: `${PRIM}/gray-50` });
  });

  it("is the color it comes to, not a reference, for the repository (whose sync is of one set)", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    const doc = readMotifTokens({ colors: store().colors, spacing: [], radii: [], shadows: [] }, { setId: SEM, themes: { light: sl }, baseTheme: "light" });
    expect(doc.surface.values.light).toBe("#f9fafb");
  });

  it("writes an alias as the key in its own set and set/key in another", () => {
    expect(targetKey(color("gray-50"), PRIM)).toBe("gray-50");
    expect(targetKey(color("gray-50"), SEM)).toBe(`${PRIM}/gray-50`);
  });

  it("is exported as a reference to the other color", () => {
    store().setColorAlias(color("surface").id, sl, `${PRIM}/gray-50`);
    store().setActiveTheme(SEM, sl);
    const json = JSON.parse(store().exportTokens());
    expect(json.color.semantic.surface.$value).toBe("{color.gray.gray-50}");
  });
});
