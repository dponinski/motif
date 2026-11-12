import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore, type RepoComponentRef } from "./canvas";

const ref: RepoComponentRef = { repo: "acme/ds", branch: "main", file: "src/components/Button.tsx", name: "Button", exported: "named" };
const store = () => useCanvasStore.getState();

describe("placing a repository component", () => {
  beforeEach(() => {
    store().loadDocument({
      componentGroups: [],
      components: [{ id: "comp-main", name: "Main", groupId: null, variantProps: [], elements: {
        f1: { id: "f1", type: "frame", name: "Frame", x: 200, y: 100, width: 400, height: 300, fill: "#fff", opacity: 1, rotation: 0, children: [] },
      }, order: ["f1"] }],
    });
    store().setZoom(1);
    store().setPan(0, 0);
  });

  it("puts it where it can be seen, selected, with the props it was given", () => {
    const id = store().placeRepoInstance(ref, { variant: "danger", children: "Delete" });
    const el = store().elements[id];
    expect(el).toMatchObject({ type: "instance", name: "Button", repoComponent: ref, instanceProps: { variant: "danger", children: "Delete" }, autoSize: true, x: 100, y: 100 });
    expect(el.componentId).toBeUndefined();
    expect(store().selectedIds).toEqual([id]);
    expect(store().order).toContain(id);
  });

  it("goes into the selected frame, at its corner", () => {
    store().setSelectedIds(["f1"]);
    const id = store().placeRepoInstance(ref, {});
    expect(store().elements[id]).toMatchObject({ parentId: "f1", x: 24, y: 24 });
    expect(store().elements.f1.children).toEqual([id]);
    expect(store().order).not.toContain(id);
  });

  it("follows the zoom and pan when it is placed", () => {
    store().setZoom(2);
    store().setPan(-400, -200);
    const id = store().placeRepoInstance(ref, {});
    expect(store().elements[id]).toMatchObject({ x: 450, y: 250 });
  });

  it("can be undone, and a measured size is not a step", () => {
    const before = store().historyIndex;
    const id = store().placeRepoInstance(ref, {});
    expect(store().historyIndex).toBe(before + 1);
    store().setMeasuredSize(id, 96.4, 40.2);
    expect(store().elements[id]).toMatchObject({ width: 96, height: 40 });
    expect(store().historyIndex).toBe(before + 1);
    store().setMeasuredSize(id, 96, 40);
    store().undo();
    expect(store().elements[id]).toBeUndefined();
  });

  it("is kept in the document as plain data", () => {
    const id = store().placeRepoInstance(ref, { size: "lg" });
    const doc = JSON.parse(JSON.stringify(store().getDocumentContent()));
    const saved = doc.components[0].elements[id];
    expect(saved.repoComponent).toEqual(ref);
    expect(saved.instanceProps).toEqual({ size: "lg" });
    store().loadDocument(doc);
    expect(store().elements[id].repoComponent).toEqual(ref);
  });
});
