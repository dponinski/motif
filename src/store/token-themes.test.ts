import { beforeEach, describe, expect, it } from "vitest";
import { emptyTokenData, snapshotTokens, useDesignSystemStore } from "./design-system";
import { fromStored, toStored } from "../lib/tokens/migrate";
import { ALL_THEMES } from "../lib/tokens/model";

const store = () => useDesignSystemStore.getState();

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
});

describe("numbers and strings in themes", () => {
  const themes = () => store().sets[0].themes.map((t) => t.id);

  it("have the value for every theme, and a value of their own in the themes that say one", () => {
    const dark = store().addThemeToSet(store().sets[0].id, "Dark");
    const n = store().addNumber({ name: "text-xl", value: 1.5, unit: "rem", use: "font-size", setId: store().sets[0].id });
    store().setNumberThemeValue(n, dark, 1.75);
    expect(store().numbers[0].themeValues).toEqual({ [dark]: 1.75 });
    store().setNumberThemeValue(n, dark, null);
    expect(store().numbers[0].themeValues).toBeUndefined();

    const s = store().addString({ name: "label", value: "Save", setId: store().sets[0].id });
    store().setStringThemeValue(s, dark, "Save changes");
    expect(store().strings[0].themeValues).toEqual({ [dark]: "Save changes" });
  });

  it("are saved by theme, and come back the same", () => {
    const dark = store().addThemeToSet(store().sets[0].id, "Dark");
    const n = store().addNumber({ name: "text-xl", value: 1.5, unit: "rem", setId: store().sets[0].id });
    store().setNumberThemeValue(n, dark, 1.75);
    const s = store().addString({ name: "label", value: "Save", setId: store().sets[0].id });
    store().setStringThemeValue(s, dark, "Save changes");
    const saved = toStored(snapshotTokens(store()));
    expect(saved.tokens.find((t) => t.name === "text-xl")!.values).toEqual({ [ALL_THEMES]: "1.5", [dark]: "1.75" });
    expect(saved.tokens.find((t) => t.name === "label")!.values).toEqual({ [ALL_THEMES]: "Save", [dark]: "Save changes" });
    const back = fromStored(saved);
    expect(back.numbers[0]).toMatchObject({ value: 1.5, themeValues: { [dark]: 1.75 } });
    expect(back.strings[0]).toMatchObject({ value: "Save", themeValues: { [dark]: "Save changes" } });
  });

  it("stay numbers, not lengths of their own kind, when a theme gives them another value", () => {
    const dark = store().addThemeToSet(store().sets[0].id, "Dark");
    const id = store().addNumber({ name: "gutter", value: 16, unit: "px", use: "spacing", setId: store().sets[0].id });
    expect(store().spacing.map((x) => x.name)).toEqual(["gutter"]);
    // (as a spacing it can't have a value per theme: it is a number once it does)
    const saved = toStored(snapshotTokens(store()));
    saved.tokens[0].values[dark] = "20";
    const back = fromStored(saved);
    expect(back.spacing).toEqual([]);
    expect(back.numbers[0]).toMatchObject({ name: "gutter", use: "spacing", themeValues: { [dark]: 20 } });
    void id;
  });

  it("go with a theme that is deleted, and are copied with one that is duplicated", () => {
    const set = store().sets[0].id;
    const dark = store().addThemeToSet(set, "Dark");
    const n = store().addNumber({ name: "text-xl", value: 1.5, unit: "rem", setId: set });
    store().setNumberThemeValue(n, dark, 1.75);
    const copy = store().duplicateTheme(set, dark);
    expect(store().numbers[0].themeValues).toEqual({ [dark]: 1.75, [copy]: 1.75 });
    store().deleteThemeFromSet(set, dark);
    expect(store().numbers[0].themeValues).toEqual({ [copy]: 1.75 });
    store().deleteThemeFromSet(set, copy);
    expect(store().numbers[0].themeValues).toBeUndefined();
    expect(themes().length).toBe(1);
  });
});
