import { beforeEach, describe, expect, it } from "vitest";
import { NEW_FILE, changedFiles, createdTexts, currentText, editLog, useEditStore } from "./edit";
import { useLibraryStore } from "./library";
import type { LibraryComponent } from "../lib/preview/library";

const get = () => useEditStore.getState();
const sha = (c: string) => c.repeat(40).slice(0, 40);

beforeEach(() => {
  useEditStore.setState({ scope: "acme/ds@main", bases: {}, history: [{ texts: {}, selection: null, summary: "" }], index: 0, selection: null, revision: 0 });
});

describe("files made in the editor", () => {
  it("are changed files with nothing before them and no sha", () => {
    get().changeMany({ "src/A.tsx": "export const A = 1;\n" }, null, "Create A", { "src/A.tsx": NEW_FILE });
    expect(changedFiles(get())).toEqual([{ path: "src/A.tsx", before: "", after: "export const A = 1;\n", sha: null, isNew: true }]);
    expect(createdTexts(get())).toEqual({ "src/A.tsx": "export const A = 1;\n" });
  });

  it("go in with the files they change as one step, so one undo takes back all of them", () => {
    get().changeMany(
      { "src/A.tsx": "a\n", "src/A.css": ".a{}\n", "src/index.ts": "export * from './A';\n" },
      null, "Create A", { "src/A.tsx": NEW_FILE, "src/A.css": NEW_FILE, "src/index.ts": { text: "", sha: sha("e") } }
    );
    expect(changedFiles(get()).map((f) => [f.path, f.isNew]).sort()).toEqual([["src/A.css", true], ["src/A.tsx", true], ["src/index.ts", false]]);
    expect(get().history).toHaveLength(2);
    expect(editLog(get())).toEqual(["Create A"]);
    get().undo();
    expect(changedFiles(get())).toEqual([]);
    expect(currentText(get(), "src/A.tsx")).toBeNull();
    get().redo();
    expect(changedFiles(get())).toHaveLength(3);
  });

  it("can be changed again, and keep the base they started with", () => {
    get().changeMany({ "src/A.css": ".a{}\n" }, null, "Create A", { "src/A.css": NEW_FILE });
    get().changeMany({ "src/A.css": ".a{color:red}\n" }, null, "Style A", { "src/A.css": { text: "x", sha: sha("f") } });
    expect(get().bases["src/A.css"]).toEqual(NEW_FILE);
    expect(changedFiles(get())[0]).toMatchObject({ after: ".a{color:red}\n", isNew: true });
    expect(get().history).toHaveLength(3);
  });

  it("do not count as a change when the text is what it was", () => {
    get().changeMany({ "src/A.css": "" }, null, "Nothing", { "src/A.css": NEW_FILE });
    expect(get().history).toHaveLength(1);
    get().change("src/B.tsx", "b", null, "B", { text: "b", sha: sha("1") });
    expect(get().history).toHaveLength(1);
  });

  it("are given up with discard", () => {
    get().changeMany({ "src/A.tsx": "a\n", "src/B.tsx": "b\n" }, null, "Create", { "src/A.tsx": NEW_FILE, "src/B.tsx": NEW_FILE });
    get().discard(["src/A.tsx"]);
    expect(changedFiles(get()).map((f) => f.path)).toEqual(["src/B.tsx"]);
    expect(createdTexts(get())).toEqual({ "src/B.tsx": "b\n" });
  });

  it("are told apart from files that were read: createdTexts holds only the new ones", () => {
    get().change("src/Old.tsx", "new text", null, "Edit", { text: "old text", sha: sha("2") });
    get().changeMany({ "src/New.tsx": "n" }, null, "Create", { "src/New.tsx": NEW_FILE });
    expect(createdTexts(get())).toEqual({ "src/New.tsx": "n" });
    expect(changedFiles(get()).map((f) => f.isNew).sort()).toEqual([false, true]);
  });

  it("a different scope starts clean", () => {
    get().changeMany({ "src/A.tsx": "a\n" }, null, "Create", { "src/A.tsx": NEW_FILE });
    get().adopt("acme/other@main");
    expect(changedFiles(get())).toEqual([]);
  });
});

const comp = (name: string): LibraryComponent => ({
  id: `src/${name}.tsx::${name}`, name, file: `src/${name}.tsx`, line: 1, exported: "named", public: true, root: "div", props: [], nativeProps: null,
  variants: [], hooks: [], notes: [], support: { level: "editable", reasons: [] },
});
const analysisWith = (...names: string[]) => ({
  repo: "acme/ds", ref: "main", scannedAt: 1, themes: [], tokens: [], styleFiles: [], tailwindEntry: null, warnings: [], stats: { filesInRepo: 0, filesRead: 0, truncated: false },
  stack: { tailwindVersion: null, entryFiles: [] },
  components: names.map((n) => ({ ...comp(n), support: { level: "editable", reasons: [] } })),
}) as never;

describe("components made in the editor", () => {
  beforeEach(() => useLibraryStore.getState().clear());

  it("join the list and open", () => {
    useLibraryStore.getState().importComponents(analysisWith("Card"));
    useLibraryStore.getState().addDraft(comp("Button"));
    const s = useLibraryStore.getState();
    expect(s.components.map((c) => c.name)).toEqual(["Card", "Button"]);
    expect(s.drafts.map((c) => c.name)).toEqual(["Button"]);
    expect(s.activeId).toBe("src/Button.tsx::Button");
  });

  it("stay after the repository is read again, until it has them", () => {
    const lib = useLibraryStore.getState();
    lib.importComponents(analysisWith("Card"));
    lib.addDraft(comp("Button"));
    expect(useLibraryStore.getState().importComponents(analysisWith("Card"))).toBe(1);
    expect(useLibraryStore.getState().components.map((c) => c.name)).toEqual(["Card", "Button"]);
    const summary = useLibraryStore.getState().updateComponents(analysisWith("Card"));
    expect(summary).toEqual({ added: [], changed: [], removed: [] });
    expect(useLibraryStore.getState().components.map((c) => c.name)).toEqual(["Card", "Button"]);
    // Once the repository has it, it is the repository's
    useLibraryStore.getState().updateComponents(analysisWith("Card", "Button"));
    expect(useLibraryStore.getState().components.map((c) => c.name)).toEqual(["Card", "Button"]);
    expect(useLibraryStore.getState().drafts).toEqual([]);
  });

  it("go when their files are given up", () => {
    const lib = useLibraryStore.getState();
    lib.importComponents(analysisWith("Card"));
    lib.addDraft(comp("Button"));
    useLibraryStore.getState().dropDrafts(["src/Other.tsx"]);
    expect(useLibraryStore.getState().components).toHaveLength(2);
    useLibraryStore.getState().dropDrafts(["src/Button.tsx"]);
    expect(useLibraryStore.getState().components.map((c) => c.name)).toEqual(["Card"]);
    expect(useLibraryStore.getState().activeId).toBeNull();
  });

  it("are put away when their files are no longer among the changes, and come back when they are", () => {
    const lib = useLibraryStore.getState();
    lib.importComponents(analysisWith("Card"));
    lib.addDraft(comp("Button"));
    useLibraryStore.getState().syncDrafts({ "src/Button.tsx": "x" });
    expect(useLibraryStore.getState().components.map((c) => c.name)).toEqual(["Card", "Button"]);
    useLibraryStore.getState().syncDrafts({});
    expect(useLibraryStore.getState().components.map((c) => c.name)).toEqual(["Card"]);
    expect(useLibraryStore.getState().drafts).toEqual([]);
    expect(useLibraryStore.getState().activeId).toBeNull();
    useLibraryStore.getState().syncDrafts({ "src/Button.tsx": "x" });
    expect(useLibraryStore.getState().components.map((c) => c.name)).toEqual(["Card", "Button"]);
    expect(useLibraryStore.getState().drafts.map((c) => c.name)).toEqual(["Button"]);
  });

  it("come back with the project", () => {
    useLibraryStore.getState().load({ source: null, components: [comp("Button")], drafts: [comp("Button")] });
    expect(useLibraryStore.getState().drafts).toHaveLength(1);
    useLibraryStore.getState().load({ source: null, components: [comp("Button")] });
    expect(useLibraryStore.getState().drafts).toEqual([]);
  });
});
