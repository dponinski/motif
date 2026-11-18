import { beforeEach, describe, expect, it } from "vitest";
import { fromStored, migrateTokenData, toStored } from "../lib/tokens/migrate";
import { presetSlots, previewStyle, resolve, slotMissing, slotText, usersOf, type ComposeData } from "../lib/tokens/compose";
import { emptyTokenData, snapshotTokens, useDesignSystemStore } from "./design-system";
import { editTokens, redoTokens, undoTokens, useTokenHistory } from "./token-history";
import { exportCss, exportTokens } from "../lib/tokens/exports";

const store = () => useDesignSystemStore.getState();
const data = (): ComposeData => store();
let SET: string;

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useTokenHistory.setState({ past: [], future: [] });
  SET = store().sets[0].id;
});

function typography(name = "heading") {
  const family = store().addString({ name: "font-sans", value: "Georgia, serif", use: "font-family", setId: SET });
  const size = store().addNumber({ name: "text-xl", value: 1.5, unit: "rem", use: "font-size", setId: SET });
  const id = store().addComposition({
    name, kind: "typography", setId: SET,
    slots: presetSlots("typography").map((s) => (s.name === "font-family" ? { ...s, ref: family } : s.name === "font-size" ? { ...s, ref: size } : s)),
  });
  return { id, family, size };
}

describe("compositions", () => {
  it("make their parts from values of their own and from other tokens", () => {
    const { id } = typography();
    const c = store().compositions.find((x) => x.id === id)!;
    expect(resolve(c, data())).toMatchObject({ "font-family": "Georgia, serif", "font-size": "1.5rem", "font-weight": "400", "line-height": "24px", "letter-spacing": "0px" });
  });

  it("follow the token a part is", () => {
    const { id, size } = typography();
    store().updateNumber(size, { value: 2 });
    expect(resolve(store().compositions.find((x) => x.id === id)!, data())["font-size"]).toBe("2rem");
  });

  it("can have a spacing or a radius as a Number, since those are lengths", () => {
    store().addSpacing({ name: "space-4", value: 16, setId: SET });
    const space = store().spacing.find((x) => x.name === "space-4")!.id;
    const id = store().addComposition({ name: "gap", kind: "custom", setId: SET, slots: [{ name: "gap", type: "number", ref: space }] });
    expect(slotText(store().compositions.find((x) => x.id === id)!.slots[0], data())).toBe("16px");
  });

  it("keep the value a part had when its token is deleted", () => {
    const { id, family, size } = typography();
    store().deleteString(family);
    store().deleteTokens("number", [size]);
    const c = store().compositions.find((x) => x.id === id)!;
    expect(c.slots.find((s) => s.name === "font-family")).toEqual({ name: "font-family", type: "string", value: "Georgia, serif" });
    expect(c.slots.find((s) => s.name === "font-size")).toMatchObject({ value: "1.5", unit: "rem" });
    expect(c.slots.every((s) => !s.ref)).toBe(true);
    expect(resolve(c, data())["font-size"]).toBe("1.5rem");
  });

  it("keep the values of the tokens of a set that is deleted", () => {
    const other = store().createSet("Other");
    store().addColor({ name: "ink", value: "#111111", group: "base", setId: other });
    const color = store().colors.find((x) => x.name === "ink")!.id;
    const id = store().addComposition({ name: "card", kind: "shadow", setId: SET, slots: presetSlots("shadow").map((s) => (s.name === "color" ? { ...s, ref: color } : s)) });
    store().deleteSet(other);
    const c = store().compositions.find((x) => x.id === id)!;
    expect(c.slots.find((s) => s.name === "color")).toEqual({ name: "color", type: "color", value: "#111111" });
  });

  it("go with the set they are in", () => {
    const other = store().createSet("Other");
    store().addComposition({ name: "a", kind: "custom", setId: other, slots: [] });
    store().deleteSet(other);
    expect(store().compositions).toEqual([]);
  });

  it("say which have a token as a part, and when a token is missing", () => {
    const { id, family } = typography();
    expect(usersOf(store().compositions, family).map((c) => c.id)).toEqual([id]);
    const slot = store().compositions[0].slots.find((s) => s.name === "font-family")!;
    expect(slotMissing(slot, { ...data(), strings: [] })).toBe(true);
    expect(slotMissing(slot, data())).toBe(false);
  });

  it("look like what they are: a text style with its font, a shadow with its shadow", () => {
    const { id } = typography();
    expect(previewStyle(store().compositions.find((x) => x.id === id)!, data())).toMatchObject({ fontFamily: "Georgia, serif", fontSize: "1.5rem", fontWeight: "400", lineHeight: "24px" });
    const shadow = store().addComposition({ name: "card", kind: "shadow", setId: SET, slots: presetSlots("shadow"), inset: true });
    expect(previewStyle(store().compositions.find((x) => x.id === shadow)!, data())).toEqual({ boxShadow: "inset 0px 4px 8px 0px rgba(0,0,0,0.1)" });
  });

  it("are copied with parts of their own, and duplicated, moved and deleted like any token", () => {
    const { id } = typography();
    const [copy] = store().duplicateTokens("composition", [id]);
    expect(store().compositions.find((c) => c.id === copy)!.name).not.toBe("heading");
    store().updateComposition(copy, { slots: [] });
    expect(store().compositions.find((c) => c.id === id)!.slots.length).toBeGreaterThan(0);
    const other = store().createSet("Other");
    store().moveTokensToSet("composition", [copy], other);
    expect(store().compositions.find((c) => c.id === copy)!.setId).toBe(other);
    store().deleteTokens("composition", [copy]);
    expect(store().compositions.map((c) => c.id)).toEqual([id]);
  });

  it("are one step of undo", () => {
    editTokens(() => store().addComposition({ name: "x", kind: "custom", setId: SET, slots: [] }));
    expect(store().compositions).toHaveLength(1);
    undoTokens();
    expect(store().compositions).toHaveLength(0);
    redoTokens();
    expect(store().compositions).toHaveLength(1);
  });

  it("are exported as design tokens and as variables", () => {
    typography();
    const json = JSON.parse(exportTokens(store()));
    // (The slots that are tokens are references to them, and the variable is that token's.)
    expect(json.text.heading).toMatchObject({ $type: "typography", $value: { fontFamily: "{font.sans}", fontSize: "{text.xl}" } });
    expect(exportCss(store())).toContain("--text-heading: var(--text-xl);");
  });
});

describe("compositions in the saved form", () => {
  it("come back as they were, and not as a text style or a shadow", () => {
    typography();
    store().addComposition({ name: "card", kind: "shadow", setId: SET, slots: presetSlots("shadow") });
    store().addComposition({ name: "pair", kind: "custom", setId: SET, slots: [{ name: "a", type: "string", value: "x" }] });
    const before = snapshotTokens(store());
    const back = fromStored(JSON.parse(JSON.stringify(toStored(before))));
    expect(back.compositions).toEqual(before.compositions);
    expect(back.typography).toEqual([]);
    expect(back.shadows).toEqual([]);
  });

  it("keep the fixed text styles and shadows in their own lists next to them", () => {
    store().addTypography({ name: "body", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20, group: "base", setId: SET });
    store().addComposition({ name: "heading", kind: "typography", setId: SET, slots: presetSlots("typography") });
    const back = fromStored(toStored(snapshotTokens(store())));
    expect(back.typography.map((t) => t.name)).toEqual(["body"]);
    expect(back.compositions.map((c) => c.name)).toEqual(["heading"]);
  });

  it("are read from the five lists of an earlier version plus the compositions", () => {
    store().addComposition({ name: "pair", kind: "custom", setId: SET, slots: [] });
    expect(migrateTokenData(snapshotTokens(store())).compositions.some((c) => c.name === "pair" && c.own)).toBe(true);
    expect(migrateTokenData({ sets: [], colors: [] }).compositions).toEqual([]);
  });
});
