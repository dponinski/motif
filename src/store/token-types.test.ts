import { beforeEach, describe, expect, it } from "vitest";
import { emptyTokenData, useDesignSystemStore } from "./design-system";
import { editTokens, redoTokens, undoTokens, useTokenHistory } from "./token-history";

const store = () => useDesignSystemStore.getState();
const SET = "set-global";

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useTokenHistory.setState({ past: [], future: [] });
});

describe("numbers and strings", () => {
  it("are added to a set, with the unit and where they belong, and give back their id", () => {
    const n = store().addNumber({ name: "text-lg", value: 1.125, unit: "rem", use: "font-size", setId: SET });
    const t = store().addString({ name: "font-sans", value: "Inter, sans-serif", use: "font-family", setId: SET });
    expect(store().numbers).toEqual([{ id: n, name: "text-lg", value: 1.125, unit: "rem", use: "font-size", setId: SET }]);
    expect(store().strings).toEqual([{ id: t, name: "font-sans", value: "Inter, sans-serif", use: "font-family", setId: SET }]);
  });

  it("are changed and taken away on their own", () => {
    const n = store().addNumber({ name: "ratio", value: 1.2, unit: "", setId: SET });
    store().updateNumber(n, { value: 1.25, unit: "em" });
    expect(store().numbers[0]).toMatchObject({ value: 1.25, unit: "em" });
    const t = store().addString({ name: "label", value: "Save", setId: SET });
    store().updateString(t, { value: "Save changes" });
    expect(store().strings[0].value).toBe("Save changes");
    store().deleteNumber(n);
    store().deleteString(t);
    expect(store().numbers).toEqual([]);
    expect(store().strings).toEqual([]);
  });

  it("are arranged like any other token: renamed, grouped, copied, moved to another set, deleted", () => {
    const n = store().addNumber({ name: "ratio", value: 1.2, unit: "", setId: SET });
    expect(store().renameToken("number", n, "scale")).toBe(true);
    expect(store().numbers[0].name).toBe("scale");
    store().setTokenGroup("number", [n], "type");
    expect(store().numbers[0].group).toBe("type");
    const [copy] = store().duplicateTokens("number", [n]);
    expect(store().numbers.map((x) => x.name)).toEqual(["scale", "scale-copy"]);
    const other = store().createSet("Semantic");
    store().moveTokensToSet("number", [copy], other);
    expect(store().numbers.find((x) => x.id === copy)!.setId).toBe(other);
    store().deleteTokens("number", [n, copy]);
    expect(store().numbers).toEqual([]);

    const t = store().addString({ name: "font", value: "Inter", setId: SET });
    expect(store().renameToken("string", t, "family")).toBe(true);
    store().moveTokensBefore("string", [t], null, "type");
    expect(store().strings[0]).toMatchObject({ name: "family", group: "type" });
  });

  it("go with their set when it is deleted", () => {
    const other = store().createSet("Other");
    store().addNumber({ name: "a", value: 1, unit: "", setId: other });
    store().addString({ name: "b", value: "x", setId: other });
    store().addNumber({ name: "keep", value: 2, unit: "px", setId: SET });
    store().deleteSet(other);
    expect(store().numbers.map((n) => n.name)).toEqual(["keep"]);
    expect(store().strings).toEqual([]);
  });

  it("are steps of undo, and come back with it", () => {
    editTokens(() => store().addNumber({ name: "ratio", value: 1.2, unit: "", setId: SET }));
    editTokens(() => store().addString({ name: "label", value: "Save", setId: SET }));
    undoTokens();
    expect(store().strings).toEqual([]);
    expect(store().numbers).toHaveLength(1);
    undoTokens();
    expect(store().numbers).toEqual([]);
    redoTokens();
    redoTokens();
    expect(store().numbers).toHaveLength(1);
    expect(store().strings).toHaveLength(1);
  });

  it("are in the exports", () => {
    store().addNumber({ name: "text-lg", value: 1.125, unit: "rem", setId: SET });
    store().addNumber({ name: "ratio", value: 1.25, unit: "", setId: SET });
    store().addString({ name: "font-sans", value: "Inter", use: "font-family", setId: SET });
    const json = JSON.parse(store().exportTokens());
    expect(json.number["text-lg"]).toEqual({ $value: "1.125rem", $type: "dimension" });
    expect(json.number.ratio).toEqual({ $value: 1.25, $type: "number" });
    expect(json.string["font-sans"]).toEqual({ $value: "Inter", $type: "fontFamily" });
    const css = store().exportCSS();
    expect(css).toContain("--text-lg: 1.125rem;");
    expect(css).toContain("--ratio: 1.25;");
    expect(css).toContain("--font-sans: Inter;");
  });
});
