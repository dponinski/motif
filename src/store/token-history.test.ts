import { beforeEach, describe, expect, it } from "vitest";
import { emptyTokenData, useDesignSystemStore } from "./design-system";
import { editTokens, redoTokens, undoTokens, useTokenHistory } from "./token-history";

const store = () => useDesignSystemStore.getState();
const names = () => store().colors.map((c) => c.name);

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useTokenHistory.setState({ past: [], future: [] });
});

describe("undo for the Tokens screen", () => {
  it("takes back a change, and puts it back", () => {
    editTokens(() => store().addColor({ name: "a", value: "#111111", group: "base", setId: "set-global" }));
    editTokens(() => store().addColor({ name: "b", value: "#222222", group: "base", setId: "set-global" }));
    expect(names()).toEqual(["a", "b"]);
    expect(undoTokens()).toBe(true);
    expect(names()).toEqual(["a"]);
    expect(undoTokens()).toBe(true);
    expect(names()).toEqual([]);
    expect(undoTokens()).toBe(false);
    expect(redoTokens()).toBe(true);
    expect(names()).toEqual(["a"]);
    expect(redoTokens()).toBe(true);
    expect(redoTokens()).toBe(false);
    expect(names()).toEqual(["a", "b"]);
  });

  it("makes a bulk change one step", () => {
    editTokens(() => { for (const n of ["a", "b", "c"]) store().addColor({ name: n, value: "#111111", group: "base", setId: "set-global" }); });
    expect(names()).toHaveLength(3);
    undoTokens();
    expect(names()).toHaveLength(0);
  });

  it("makes a new change end what could have been redone", () => {
    editTokens(() => store().addColor({ name: "a", value: "#111111", group: "base", setId: "set-global" }));
    undoTokens();
    editTokens(() => store().addColor({ name: "b", value: "#222222", group: "base", setId: "set-global" }));
    expect(redoTokens()).toBe(false);
    expect(names()).toEqual(["b"]);
  });

  it("does not count a change that changed nothing", () => {
    editTokens(() => undefined);
    expect(useTokenHistory.getState().past).toHaveLength(0);
  });

  it("does not count writing what was already there", () => {
    editTokens(() => store().addColor({ name: "a", value: "#111111", group: "base", setId: "set-global" }));
    const [a] = store().colors;
    const theme = store().sets[0].themes[0].id;
    editTokens(() => store().setColorText(a.id, theme, "#222222"));
    expect(useTokenHistory.getState().past).toHaveLength(2);
    // The same text again, which the store takes (it makes new arrays) but which changes nothing.
    editTokens(() => store().setColorText(a.id, theme, "#222222"));
    editTokens(() => store().setTokenGroup("color", [a.id], "base"));
    expect(useTokenHistory.getState().past).toHaveLength(2);
    undoTokens();
    expect(store().colors[0].themeValues[theme]).toBe("#111111");
  });

  it("is ended by a change made some other way, such as a sync", () => {
    editTokens(() => store().addColor({ name: "a", value: "#111111", group: "base", setId: "set-global" }));
    expect(useTokenHistory.getState().past).toHaveLength(1);
    store().addColor({ name: "from-sync", value: "#333333", group: "base", setId: "set-global" });
    expect(useTokenHistory.getState().past).toHaveLength(0);
    expect(undoTokens()).toBe(false);
    expect(names()).toEqual(["a", "from-sync"]);
  });

  it("keeps at most a hundred steps", () => {
    for (let i = 0; i < 120; i++) editTokens(() => store().addColor({ name: `c${i}`, value: "#111111", group: "base", setId: "set-global" }));
    expect(useTokenHistory.getState().past).toHaveLength(100);
  });
});

describe("arranging", () => {
  const add = (name: string, over: Record<string, unknown> = {}) => store().addColor({ name, value: "#111111", group: "base", setId: "set-global", ...over });

  it("renames a token of Motif's own, and refuses one the repository names", () => {
    add("a");
    add("b", { repoName: "b" });
    const [a, b] = store().colors;
    expect(store().renameToken("color", a.id, "alpha")).toBe(true);
    expect(store().renameToken("color", b.id, "beta")).toBe(false);
    expect(names()).toEqual(["alpha", "b"]);
    expect(store().renameToken("color", a.id, "  ")).toBe(false);
  });

  it("moves tokens to a group, and a group's name changes for all of it", () => {
    add("a"); add("b"); add("c", { group: "x" });
    const [a, b] = store().colors;
    store().setTokenGroup("color", [a.id, b.id], "y");
    expect(store().colors.map((c) => c.group)).toEqual(["y", "y", "x"]);
    store().renameGroup("color", "set-global", "y", "z");
    expect(store().colors.map((c) => c.group)).toEqual(["z", "z", "x"]);
  });

  it("copies tokens beside the original, with names that are free, and not as the repository's", () => {
    add("a", { repoName: "a" });
    const [a] = store().colors;
    const [copy] = store().duplicateTokens("color", [a.id]);
    expect(names()).toEqual(["a", "a-copy"]);
    const made = store().colors.find((c) => c.id === copy)!;
    expect(made.repoName).toBeUndefined();
    expect(made.themeValues).toEqual(a.themeValues);
    expect(made.themeValues).not.toBe(a.themeValues);
    store().duplicateTokens("color", [a.id]);
    expect(names()).toEqual(["a", "a-copy-2", "a-copy"]);
  });

  it("reorders, and can move into a group on the way", () => {
    add("a"); add("b"); add("c");
    const [a, , c] = store().colors;
    store().moveTokensBefore("color", [c.id], a.id);
    expect(names()).toEqual(["c", "a", "b"]);
    store().moveTokensBefore("color", [a.id], null, "last");
    expect(names()).toEqual(["c", "b", "a"]);
    expect(store().colors.find((x) => x.id === a.id)!.group).toBe("last");
  });

  it("moves colors to another set, keeping the theme values the sets share by name", () => {
    const light = store().sets[0].themes[0];
    store().renameTheme("set-global", light.id, "Light");
    const dark = store().addThemeToSet("set-global", "Dark");
    add("a");
    const [a] = store().colors;
    store().updateColorThemeValue(a.id, light.id, "#ffffff");
    store().updateColorThemeValue(a.id, dark, "#000000");
    const other = store().createSet("Other");
    const otherDark = store().addThemeToSet(other, "dark");
    store().renameTheme(other, store().sets.find((s) => s.id === other)!.themes[0].id, "Light");
    store().moveTokensToSet("color", [a.id], other);
    const moved = store().colors[0];
    expect(moved.setId).toBe(other);
    expect(moved.themeValues[otherDark]).toBe("#000000");
    expect(Object.values(moved.themeValues)).toContain("#ffffff");
  });

  it("re-derives groups from names", () => {
    for (const n of ["gray-50", "gray-100", "primary", "primary-foreground", "border"]) add(n);
    store().regroupColors("set-global");
    expect(store().colors.map((c) => c.group)).toEqual(["gray", "gray", "primary", "primary", "base"]);
  });

  it("writes a color as typed when it can be read, and refuses what can't", () => {
    add("a");
    const [a] = store().colors;
    const theme = store().sets[0].themes[0].id;
    expect(store().setColorText(a.id, theme, "oklch(0.52 0.21 270)")).toBe(true);
    expect(store().colors[0].themeValues[theme]).toBe("oklch(0.52 0.21 270)");
    expect(store().colors[0].value).toBe("oklch(0.52 0.21 270)");
    expect(store().setColorText(a.id, theme, "not a color")).toBe(false);
    expect(store().colors[0].value).toBe("oklch(0.52 0.21 270)");
  });

  it("deletes tokens of any kind by id", () => {
    store().addSpacing({ name: "s", value: 4, setId: "set-global" });
    store().addSpacing({ name: "t", value: 8, setId: "set-global" });
    store().deleteTokens("spacing", [store().spacing[0].id]);
    expect(store().spacing.map((s) => s.name)).toEqual(["t"]);
  });
});
