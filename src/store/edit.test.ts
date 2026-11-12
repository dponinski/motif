import { beforeEach, describe, expect, it } from "vitest";
import { changedFiles, currentText, editLog, useEditStore } from "./edit";

const store = () => useEditStore.getState();
const base = { text: "a", sha: "s1" };

describe("edit history", () => {
  beforeEach(() => { useEditStore.setState({ version: null }); store().adopt("v1"); });

  it("records changes, undoes and redoes them, and keeps the selection of each state", () => {
    store().change("f.tsx", "b", { path: "f.tsx", start: 4 }, "one", base);
    store().change("f.tsx", "c", { path: "f.tsx", start: 9 }, "two");
    expect(currentText(store(), "f.tsx")).toBe("c");
    expect(editLog(store())).toEqual(["one", "two"]);
    store().undo();
    expect(currentText(store(), "f.tsx")).toBe("b");
    expect(store().selection).toEqual({ path: "f.tsx", start: 4 });
    store().undo();
    expect(currentText(store(), "f.tsx")).toBeNull();
    store().undo();
    expect(store().index).toBe(0);
    store().redo();
    store().redo();
    expect(currentText(store(), "f.tsx")).toBe("c");
    store().redo();
    expect(store().index).toBe(2);
  });

  it("drops the undone future when something new is changed", () => {
    store().change("f.tsx", "b", null, "one", base);
    store().undo();
    store().change("f.tsx", "z", null, "other");
    store().redo();
    expect(currentText(store(), "f.tsx")).toBe("z");
    expect(editLog(store())).toEqual(["other"]);
  });

  it("ignores a change that leaves the text as it was", () => {
    store().change("f.tsx", "a", null, "nothing", base);
    expect(store().index).toBe(0);
    store().change("f.tsx", "b", null, "one", base);
    store().change("f.tsx", "b", null, "again");
    expect(store().index).toBe(1);
  });

  it("lists as changed only files that differ from the repository's version", () => {
    store().change("f.tsx", "b", null, "one", base);
    store().change("g.tsx", "x", null, "two", { text: "x", sha: "s2" });
    expect(changedFiles(store())).toEqual([{ path: "f.tsx", before: "a", after: "b", sha: "s1" }]);
    store().change("f.tsx", "a", null, "back");
    expect(changedFiles(store())).toEqual([]);
  });

  it("counts every step so the preview knows to update, and starts clean on a different import", () => {
    const r = store().revision;
    store().change("f.tsx", "b", null, "one", base);
    store().undo();
    expect(store().revision).toBe(r + 2);
    store().adopt("v1");
    expect(store().revision).toBe(r + 2);
    store().adopt("v2");
    expect(store().history).toHaveLength(1);
    expect(store().bases).toEqual({});
  });
});
