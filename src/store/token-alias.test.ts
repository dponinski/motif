import { beforeEach, describe, expect, it } from "vitest";
import { emptyTokenData, useDesignSystemStore } from "./design-system";
import { editTokens, undoTokens, useTokenHistory } from "./token-history";

const store = () => useDesignSystemStore.getState();
const SET = "set-global";
const color = (name: string) => store().colors.find((c) => c.name === name)!;
const themes = () => store().sets.find((s) => s.id === SET)!.themes.map((t) => t.id);

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useTokenHistory.setState({ past: [], future: [] });
  store().addColor({ name: "gray-50", value: "#f9fafb", group: "gray", setId: SET });
  store().addColor({ name: "gray-900", value: "#111827", group: "gray", setId: SET });
  store().addColor({ name: "background", value: "#ffffff", group: "base", setId: SET });
});

describe("color aliases in the store", () => {
  it("makes a color another token, with that token's color", () => {
    const [light] = themes();
    expect(store().setColorAlias(color("background").id, light, "gray-50")).toBe(true);
    expect(color("background").themeAlias).toEqual({ [light]: "gray-50" });
    expect(color("background").themeValues[light]).toBe("#f9fafb");
    expect(color("background").value).toBe("#f9fafb");
  });

  it("follows the token when its color changes, through a chain", () => {
    const [light] = themes();
    store().addColor({ name: "surface", value: "#000000", group: "base", setId: SET });
    store().setColorAlias(color("background").id, light, "gray-50");
    store().setColorAlias(color("surface").id, light, "background");
    store().setColorText(color("gray-50").id, light, "#eeeeee");
    expect(color("background").themeValues[light]).toBe("#eeeeee");
    expect(color("surface").themeValues[light]).toBe("#eeeeee");
  });

  it("refuses a token that is missing, itself, or would loop", () => {
    const [light] = themes();
    const bg = color("background");
    expect(store().setColorAlias(bg.id, light, "nope")).toBe(false);
    expect(store().setColorAlias(bg.id, light, "background")).toBe(false);
    store().setColorAlias(bg.id, light, "gray-50");
    expect(store().setColorAlias(color("gray-50").id, light, "background")).toBe(false);
    expect(color("gray-50").themeAlias).toBeUndefined();
  });

  it("is an alias in one theme and its own color in another", () => {
    const dark = store().addThemeToSet(SET, "Dark");
    const [light] = themes();
    store().setColorAlias(color("background").id, light, "gray-50");
    store().setColorAlias(color("background").id, dark, "gray-900");
    store().setColorText(color("gray-900").id, dark, "#050505");
    expect(color("background").themeValues).toMatchObject({ [light]: "#f9fafb", [dark]: "#050505" });
    store().setColorText(color("background").id, dark, "#222222");
    expect(color("background").themeAlias).toEqual({ [light]: "gray-50" });
    expect(color("background").themeValues[dark]).toBe("#222222");
  });

  it("detaches keeping the color, and a typed color detaches too", () => {
    const [light] = themes();
    store().setColorAlias(color("background").id, light, "gray-50");
    store().setColorAlias(color("background").id, light, null);
    expect(color("background").themeAlias).toBeUndefined();
    expect(color("background").themeValues[light]).toBe("#f9fafb");
    store().setColorText(color("gray-50").id, light, "#eeeeee");
    expect(color("background").themeValues[light]).toBe("#f9fafb");
  });

  it("keeps the color of what it was when that token is deleted, and follows a rename", () => {
    const [light] = themes();
    store().setColorAlias(color("background").id, light, "gray-50");
    store().renameToken("color", color("gray-50").id, "paper");
    expect(color("background").themeAlias).toEqual({ [light]: "paper" });
    store().setColorText(color("paper").id, light, "#eeeeee");
    expect(color("background").themeValues[light]).toBe("#eeeeee");
    store().deleteTokens("color", [color("paper").id]);
    expect(color("background").themeAlias).toBeUndefined();
    expect(color("background").themeValues[light]).toBe("#eeeeee");
  });

  it("copies a new theme and a duplicate with the alias", () => {
    const [light] = themes();
    store().setColorAlias(color("background").id, light, "gray-50");
    const dark = store().addThemeToSet(SET, "Dark");
    expect(color("background").themeAlias).toEqual({ [light]: "gray-50", [dark]: "gray-50" });
    const [copy] = store().duplicateTokens("color", [color("background").id]);
    expect(store().colors.find((c) => c.id === copy)!.themeAlias).toEqual({ [light]: "gray-50", [dark]: "gray-50" });
    store().deleteThemeFromSet(SET, dark);
    expect(color("background").themeAlias).toEqual({ [light]: "gray-50" });
  });

  it("is one step of undo", () => {
    const [light] = themes();
    editTokens(() => store().setColorAlias(color("background").id, light, "gray-50"));
    expect(color("background").themeAlias).toBeDefined();
    undoTokens();
    expect(color("background").themeAlias).toBeUndefined();
    expect(color("background").themeValues[light]).toBe("#ffffff");
  });
});

describe("exports", () => {
  it("write an alias as a reference", () => {
    const [light] = themes();
    store().setColorAlias(color("background").id, light, "gray-50");
    expect(store().exportCSS()).toContain("--color-background: var(--color-gray-50);");
    const json = JSON.parse(store().exportTokens());
    expect(json.color.base.background.$value).toBe("{color.gray.gray-50}");
  });
});
