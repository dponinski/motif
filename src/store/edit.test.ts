import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { MAX_HISTORY, applyPatch, changedFiles, currentText, decodeEdits, editLog, encodeEdits, patchOf, useEditStore } from "./edit";
import { debouncedStorage } from "../lib/debounced-storage";
import { firstProblem, storageProblem } from "./storage-problem";

const store = () => useEditStore.getState();
const base = { text: "a", sha: "s1" };

describe("edit history", () => {
  beforeEach(() => { useEditStore.setState({ scope: null }); store().adopt("v1"); });

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
    expect(changedFiles(store())).toEqual([{ path: "f.tsx", before: "a", after: "b", sha: "s1", isNew: false }]);
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

describe("keeping changes across a reload", () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };

  beforeEach(() => {
    memory.clear();
    useEditStore.persist.setOptions({ storage: createJSONStorage(() => storage) });
    useEditStore.setState({ scope: null });
    store().adopt("acme/ds@main");
    store().clear();
  });

  const reload = async () => {
    // What a reload does: the page starts empty (which must not overwrite what was saved) and reads it.
    const saved = memory.get("motif-edits");
    useEditStore.setState({ scope: null, bases: {}, history: [{ texts: {}, selection: null, summary: "" }], index: 0, selection: null });
    if (saved !== undefined) memory.set("motif-edits", saved);
    await useEditStore.persist.rehydrate();
  };

  it("brings the changes, their history and the files' original text back", async () => {
    store().change("f.tsx", "b", { path: "f.tsx", start: 4 }, "one", base);
    store().change("f.tsx", "c", { path: "f.tsx", start: 4 }, "two");
    await reload();
    expect(store().scope).toBe("acme/ds@main");
    expect(currentText(store(), "f.tsx")).toBe("c");
    expect(changedFiles(store())).toEqual([{ path: "f.tsx", before: "a", after: "c", sha: "s1", isNew: false }]);
    expect(editLog(store())).toEqual(["one", "two"]);
    store().undo();
    expect(currentText(store(), "f.tsx")).toBe("b");
  });

  it("doesn't keep which element was selected", async () => {
    store().change("f.tsx", "b", { path: "f.tsx", start: 4 }, "one", base);
    await reload();
    expect(store().selection).toBeNull();
    expect(store().history.every((e) => e.selection === null)).toBe(true);
  });

  it("keeps changes across an update of the repository's components, and drops them for another branch", async () => {
    store().change("f.tsx", "b", null, "one", base);
    store().adopt("acme/ds@main");
    expect(currentText(store(), "f.tsx")).toBe("b");
    store().adopt("acme/ds@other");
    expect(currentText(store(), "f.tsx")).toBeNull();
    expect(store().bases).toEqual({});
  });

  it("is not trusted when what was saved isn't well formed", async () => {
    memory.set("motif-edits", JSON.stringify({ state: { scope: "x", bases: null, history: [], index: 3 }, version: 1 }));
    await reload();
    expect(store().scope).toBeNull();
    expect(store().history).toHaveLength(1);
    memory.set("motif-edits", "not json");
    await reload();
    expect(store().history).toHaveLength(1);
  });

  it("keeps the history to a size that can be saved, newest last", () => {
    for (let i = 0; i < MAX_HISTORY + 20; i++) store().change("f.tsx", `v${i}`, null, `step ${i}`, i === 0 ? base : undefined);
    expect(store().history).toHaveLength(MAX_HISTORY);
    expect(store().index).toBe(MAX_HISTORY - 1);
    expect(currentText(store(), "f.tsx")).toBe(`v${MAX_HISTORY + 19}`);
    store().undo();
    expect(currentText(store(), "f.tsx")).toBe(`v${MAX_HISTORY + 18}`);
  });

  it("gives up the changes to chosen files and keeps the others", () => {
    store().change("f.tsx", "b", null, "one", base);
    store().change("g.tsx", "y", null, "two", { text: "x", sha: "s2" });
    store().discard(["f.tsx"]);
    expect(changedFiles(store()).map((f) => f.path)).toEqual(["g.tsx"]);
    expect(store().bases["f.tsx"]).toBeUndefined();
    expect(currentText(store(), "f.tsx")).toBeNull();
    expect(store().index).toBe(0);
    store().undo();
    expect(currentText(store(), "g.tsx")).toBe("y");
  });

  it("after a merge, the merged files are the new starting point and only later edits remain changes", () => {
    store().change("f.tsx", "b", null, "one", base);
    store().change("g.tsx", "y", null, "two", { text: "x", sha: "s2" });
    store().change("g.tsx", "z", null, "three");
    // f.tsx was merged as "b"; g.tsx was merged as "y" and then edited again to "z".
    store().rebase({ "f.tsx": { text: "b", sha: "m1" }, "g.tsx": { text: "y", sha: "m2" } });
    expect(changedFiles(store()).map((f) => [f.path, f.before, f.after, f.sha])).toEqual([["g.tsx", "y", "z", "m2"]]);
    // What is the repository's now isn't kept at all.
    expect(store().bases["f.tsx"]).toBeUndefined();
    expect(store().bases["g.tsx"]).toEqual({ text: "y", sha: "m2" });
    // Undo doesn't go back before the merge.
    expect(store().index).toBe(0);
    store().undo();
    expect(changedFiles(store())).toHaveLength(1);
  });

  it("a file made here is no longer new once it has been merged", () => {
    store().change("n.tsx", "N", null, "make", { text: "", sha: null });
    expect(changedFiles(store())[0].isNew).toBe(true);
    store().rebase({ "n.tsx": { text: "N", sha: "m3" } });
    expect(changedFiles(store())).toEqual([]);
    expect(store().bases["n.tsx"]).toBeUndefined();
  });

  it("rebasing files that aren't being changed does nothing", () => {
    const before = store().revision;
    store().rebase({ "other.tsx": { text: "q", sha: "m" } });
    expect(store().revision).toBe(before);
  });
});

describe("what is saved of the history", () => {
  const big = "line of a stylesheet\n".repeat(5000);

  it("keeps a change to a file as a few characters, not the file again", () => {
    expect(patchOf(undefined, "new file")).toBe("new file");
    const after = big.replace("line of", "LINE of");
    const patch = patchOf(big, after);
    expect(Array.isArray(patch)).toBe(true);
    expect(JSON.stringify(patch).length).toBeLessThan(100);
    expect(applyPatch(big, patch)).toBe(after);
    // Texts that share little are kept whole, and an empty or identical edit still round trips.
    expect(patchOf("abc", "xyz")).toBe("xyz");
    expect(applyPatch(big, patchOf(big, ""))).toBe("");
    expect(applyPatch(big, patchOf(big, big))).toBe(big);
    expect(applyPatch(big, patchOf(big, big + "tail"))).toBe(big + "tail");
    expect(applyPatch("short", [9, 9, "x"])).toBeNull();
  });

  it("brings back every step of a history from the small form, undo included", () => {
    useEditStore.setState({ scope: null });
    store().adopt("s@main");
    store().clear();
    store().change("a.css", big + "1", null, "one", { text: big, sha: "s" });
    store().change("b.tsx", "B", null, "two", { text: "", sha: null });
    store().change("a.css", big + "12", null, "three");
    const saved = encodeEdits(store());
    expect(JSON.stringify(saved).length).toBeLessThan(big.length * 1.2);
    const back = decodeEdits(JSON.parse(JSON.stringify(saved)))!;
    expect(back.history.map((e) => e.texts)).toEqual(store().history.map((e) => e.texts));
    expect(back.history.map((e) => e.summary)).toEqual(["", "one", "two", "three"]);
    expect(back.index).toBe(3);
  });

  it("reads what the earlier version saved, with every step's whole text", () => {
    const old = { scope: "x", bases: {}, history: [{ texts: {}, selection: { path: "f", start: 1 }, summary: "" }, { texts: { "f.tsx": "b" }, selection: null, summary: "one" }], index: 1 };
    const back = decodeEdits(old)!;
    expect(back.history[1].texts).toEqual({ "f.tsx": "b" });
    expect(back.history[0].selection).toBeNull();
  });

  it("refuses a history whose patches don't fit the text they are for", () => {
    const bad = { scope: "x", bases: {}, start: {}, steps: [{ summary: "s", set: { "f.tsx": [5, 5, "x"] } }], index: 1 };
    expect(decodeEdits(bad)).toBeNull();
    expect(decodeEdits({ ...bad, steps: [], index: 3 })).toBeNull();
  });
});

describe("writing the saved changes", () => {
  const memory = new Map<string, string>();
  const backend = { getItem: (k: string) => memory.get(k) ?? null, setItem: vi.fn((k: string, v: string) => void memory.set(k, v)), removeItem: (k: string) => void memory.delete(k) };
  const text = "x".repeat(50);

  beforeEach(() => {
    vi.useFakeTimers();
    memory.clear();
    backend.setItem.mockClear();
    useEditStore.setState({ scope: null });
    store().adopt("w@main");
    store().clear();
    storageProblem.getState().set("changes", null);
  });
  afterEach(() => vi.useRealTimers());

  const use = () => {
    const storage = debouncedStorage<ReturnType<typeof encodeEdits>>({
      backend,
      delay: 400,
      onProblem: (failed) => storageProblem.getState().set("changes", failed ? "Your changes couldn't be saved in this browser" : null),
    });
    useEditStore.persist.setOptions({ storage });
    return storage;
  };

  it("waits for the changes to settle, then writes once", () => {
    use();
    for (let i = 0; i < 10; i++) store().change("f.tsx", text + i, null, `s${i}`, i === 0 ? { text, sha: "s" } : undefined);
    expect(backend.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(backend.setItem).toHaveBeenCalledTimes(1);
  });

  it("doesn't write when only the selection moved", () => {
    use();
    store().change("f.tsx", text + "1", null, "one", { text, sha: "s" });
    vi.advanceTimersByTime(500);
    backend.setItem.mockClear();
    store().select({ path: "f.tsx", start: 3 });
    store().select(null);
    vi.advanceTimersByTime(500);
    expect(backend.setItem).not.toHaveBeenCalled();
    // Undo moves what is kept, and is written.
    store().undo();
    vi.advanceTimersByTime(500);
    expect(backend.setItem).toHaveBeenCalledTimes(1);
  });

  it("writes at once when asked, as the page is left", () => {
    const storage = use();
    store().change("f.tsx", text + "1", null, "one", { text, sha: "s" });
    storage.flush();
    expect(backend.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(memory.get("motif-edits")!).version).toBe(2);
  });

  it("says so, once, when the browser won't keep it, and stops saying so when it does", () => {
    const storage = use();
    backend.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    store().change("f.tsx", text + "1", null, "one", { text, sha: "s" });
    storage.flush();
    expect(firstProblem(storageProblem.getState())).toMatch(/couldn't be saved/);
    store().change("f.tsx", text + "2", null, "two");
    storage.flush();
    expect(firstProblem(storageProblem.getState())).toBeNull();
  });
});

describe("the list of changed files", () => {
  beforeEach(() => { useEditStore.setState({ scope: null }); store().adopt("c@main"); store().clear(); });

  it("is the same list until something changes, a selection included", () => {
    store().change("f.tsx", "b", null, "one", base);
    const first = changedFiles(store());
    store().select({ path: "f.tsx", start: 1 });
    expect(changedFiles(store())).toBe(first);
    store().change("f.tsx", "c", null, "two");
    expect(changedFiles(store())).not.toBe(first);
    expect(changedFiles(store()).map((f) => f.after)).toEqual(["c"]);
    store().undo();
    expect(changedFiles(store()).map((f) => f.after)).toEqual(["b"]);
  });

  it("follows the starting points: a merge empties it", () => {
    store().change("f.tsx", "b", null, "one", base);
    expect(changedFiles(store())).toHaveLength(1);
    store().rebase({ "f.tsx": { text: "b", sha: "m" } });
    expect(changedFiles(store())).toEqual([]);
  });
});
