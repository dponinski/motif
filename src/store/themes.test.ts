import { beforeEach, describe, expect, it } from "vitest";
import { copyName, emptyTokenData, useDesignSystemStore } from "./design-system";
import { editTokens, redoTokens, undoTokens, useTokenHistory } from "./token-history";

const store = () => useDesignSystemStore.getState();
const SET = "set-global";
const themes = () => store().sets.find((s) => s.id === SET)!.themes;
const color = (name: string) => store().colors.find((c) => c.name === name)!;

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useTokenHistory.setState({ past: [], future: [] });
  store().addColor({ name: "bg", value: "#ffffff", group: "base", setId: SET });
  store().addColor({ name: "fg", value: "#111111", group: "base", setId: SET });
  const dark = store().addThemeToSet(SET, "Dark");
  store().updateColorThemeValue(color("bg").id, dark, "#000000");
  useTokenHistory.setState({ past: [], future: [] });
});

describe("a theme made from another", () => {
  it("has its values, and the tokens that are other tokens, and sits next to it", () => {
    const [light, dark] = themes();
    store().setColorAlias(color("fg").id, dark.id, "bg");
    const copy = store().duplicateTheme(SET, dark.id);
    expect(themes().map((t) => t.name)).toEqual(["Default", "Dark", "Dark copy"]);
    expect(color("bg").themeValues[copy]).toBe("#000000");
    expect(color("fg").themeAlias?.[copy]).toBe(color("fg").themeAlias?.[dark.id]);
    expect(color("fg").themeValues[copy]).toBe(color("fg").themeValues[dark.id]);
    // The first theme stays the first: it is the one the repository's base values are.
    expect(themes()[0].id).toBe(light.id);
  });

  it("takes a name that is free", () => {
    expect(copyName("Dark", ["Dark"])).toBe("Dark copy");
    expect(copyName("Dark", ["Dark", "dark copy"])).toBe("Dark copy 2");
    expect(copyName("Dark", ["Dark", "Dark copy", "Dark copy 2"])).toBe("Dark copy 3");
  });

  it("does nothing for a theme that isn't there", () => {
    const before = themes().length;
    store().duplicateTheme(SET, "nope");
    expect(themes()).toHaveLength(before);
  });
});

describe("themes and undo", () => {
  it("makes adding, renaming, copying and deleting a theme a step each", () => {
    const [, dark] = themes();
    const copy = editTokens(() => store().duplicateTheme(SET, dark.id));
    editTokens(() => store().renameTheme(SET, copy, "Dim"));
    editTokens(() => store().deleteThemeFromSet(SET, copy));
    expect(themes().map((t) => t.name)).toEqual(["Default", "Dark"]);
    undoTokens();
    expect(themes().map((t) => t.name)).toEqual(["Default", "Dark", "Dim"]);
    expect(color("bg").themeValues[copy]).toBe("#000000");
    undoTokens();
    expect(themes().map((t) => t.name)).toEqual(["Default", "Dark", "Dark copy"]);
    undoTokens();
    expect(themes().map((t) => t.name)).toEqual(["Default", "Dark"]);
    expect(color("bg").themeValues[copy]).toBeUndefined();
    redoTokens();
    expect(themes()).toHaveLength(3);
  });

  it("isn't ended or added to by changing which theme is open", () => {
    const [light, dark] = themes();
    editTokens(() => store().addColor({ name: "x", value: "#123456", group: "base", setId: SET }));
    store().setActiveTheme(SET, dark.id);
    expect(useTokenHistory.getState().past).toHaveLength(1);
    store().setActiveTheme(SET, light.id);
    expect(useTokenHistory.getState().past).toHaveLength(1);
  });

  it("keeps the theme that is open when something is undone", () => {
    const [, dark] = themes();
    store().setActiveTheme(SET, themes()[0].id);
    editTokens(() => store().addColor({ name: "x", value: "#123456", group: "base", setId: SET }));
    store().setActiveTheme(SET, dark.id);
    undoTokens();
    expect(store().colors.map((c) => c.name)).not.toContain("x");
    expect(store().sets.find((s) => s.id === SET)!.activeThemeId).toBe(dark.id);
    // What a color is "now" follows the theme that is open.
    expect(color("bg").value).toBe("#000000");
    redoTokens();
    expect(store().sets.find((s) => s.id === SET)!.activeThemeId).toBe(dark.id);
  });
});
