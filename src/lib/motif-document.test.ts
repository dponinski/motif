import { describe, expect, it } from "vitest";
import type { CanvasElement } from "../store/canvas";
import {
  mergeDocuments,
  parseDocument,
  resolveConflicts,
  serializeDocument,
  type MotifDocument,
} from "./motif-document";

const el = (id: string, extra: Partial<CanvasElement> = {}): CanvasElement => ({
  id, type: "rectangle", name: id, x: 0, y: 0, width: 10, height: 10, fill: "#000000", opacity: 1, rotation: 0, ...extra,
});

function doc(elements: CanvasElement[], order?: string[]): MotifDocument {
  return {
    motif: 1,
    id: "file1",
    name: "Design",
    componentGroups: [],
    components: [{
      id: "comp-main",
      name: "Main",
      groupId: null,
      variantProps: [],
      elements: Object.fromEntries(elements.map((e) => [e.id, e])),
      order: order ?? elements.filter((e) => !e.parentId).map((e) => e.id),
    }],
  };
}

const edit = (d: MotifDocument, id: string, patch: Partial<CanvasElement>): MotifDocument => {
  const copy = structuredClone(d);
  Object.assign(copy.components[0].elements[id], patch);
  return copy;
};

const remove = (d: MotifDocument, id: string): MotifDocument => {
  const copy = structuredClone(d);
  delete copy.components[0].elements[id];
  copy.components[0].order = copy.components[0].order.filter((x) => x !== id);
  return copy;
};

const add = (d: MotifDocument, e: CanvasElement): MotifDocument => {
  const copy = structuredClone(d);
  copy.components[0].elements[e.id] = e;
  copy.components[0].order.push(e.id);
  return copy;
};

describe("serializeDocument", () => {
  it("is independent of key insertion order and drops undefined", () => {
    const a = doc([el("a", { stroke: undefined })]);
    const b = doc([{ rotation: 0, opacity: 1, fill: "#000000", height: 10, width: 10, y: 0, x: 0, name: "a", type: "rectangle", id: "a" }]);
    expect(serializeDocument(a)).toBe(serializeDocument(b));
  });

  it("round-trips through parseDocument", () => {
    const d = doc([el("a"), el("b")]);
    expect(parseDocument(serializeDocument(d))).toEqual(d);
  });
});

describe("parseDocument", () => {
  it("rejects conflict markers, foreign JSON and newer versions", () => {
    expect(() => parseDocument("<<<<<<< HEAD\n{}")).toThrow(/not valid JSON/);
    expect(() => parseDocument('{"name":"package"}')).toThrow(/Not a Motif design file/);
    expect(() => parseDocument('{"motif":2,"id":"x","name":"x","components":[]}')).toThrow(/Unsupported/);
  });
});

describe("mergeDocuments", () => {
  const base = doc([el("a"), el("b")]);

  it("combines edits to different properties of the same element", () => {
    const { merged, conflicts } = mergeDocuments(base, edit(base, "a", { x: 50 }), edit(base, "a", { fill: "#ff0000" }));
    expect(conflicts).toEqual([]);
    expect(merged.components[0].elements.a).toMatchObject({ x: 50, fill: "#ff0000" });
  });

  it("keeps additions from both sides and orders them after their neighbours", () => {
    const { merged, conflicts } = mergeDocuments(base, add(base, el("mine")), add(base, el("theirs")));
    expect(conflicts).toEqual([]);
    expect(merged.components[0].order).toEqual(["a", "b", "mine", "theirs"]);
    expect(Object.keys(merged.components[0].elements).sort()).toEqual(["a", "b", "mine", "theirs"]);
  });

  it("applies a deletion when the other side left the element alone", () => {
    const { merged, conflicts } = mergeDocuments(base, edit(base, "b", { x: 5 }), remove(base, "a"));
    expect(conflicts).toEqual([]);
    expect(merged.components[0].elements.a).toBeUndefined();
    expect(merged.components[0].order).toEqual(["b"]);
  });

  it("reports a conflict when both sides change the same property", () => {
    const result = mergeDocuments(base, edit(base, "a", { fill: "#111111" }), edit(base, "a", { fill: "#222222" }));
    expect(result.conflicts).toEqual([
      { path: ["components", "comp-main", "elements", "a", "fill"], label: "Main › a · fill", mine: "#111111", theirs: "#222222" },
    ]);
    expect(result.merged.components[0].elements.a.fill).toBe("#111111");
    expect(resolveConflicts(result, [0]).components[0].elements.a.fill).toBe("#222222");
  });

  it("reports delete-versus-edit and can restore the element into the layer order", () => {
    const result = mergeDocuments(base, remove(base, "a"), edit(base, "a", { x: 99 }));
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].mine).toBeUndefined();
    expect(result.merged.components[0].elements.a).toBeUndefined();

    const restored = resolveConflicts(result, [0]).components[0];
    expect(restored.elements.a.x).toBe(99);
    expect(restored.order).toContain("a");
  });

  it("drops children whose parent was deleted by the chosen side", () => {
    const withFrame = doc([el("f", { type: "frame", children: ["c1"] }), el("c1", { parentId: "f" })]);
    const mine = structuredClone(withFrame);
    mine.components[0].elements.c2 = el("c2", { parentId: "f" });
    mine.components[0].elements.f.children = ["c1", "c2"];
    const theirs = doc([]);

    const result = mergeDocuments(withFrame, mine, theirs);
    expect(result.conflicts.map((c) => c.path.at(-1))).toEqual(["f"]);
    expect(resolveConflicts(result, [0]).components[0].elements).toEqual({});
  });

  it("without a base, only differing values conflict", () => {
    const result = mergeDocuments(null, edit(base, "a", { x: 1 }), edit(base, "a", { x: 2 }));
    expect(result.conflicts.map((c) => c.label)).toEqual(["Main › a · x"]);
  });

  it("merges components and variant props by id", () => {
    const mine = structuredClone(base);
    mine.components.push({ id: "btn", name: "Button", groupId: null, variantProps: [], elements: {}, order: [] });
    const theirs = structuredClone(base);
    theirs.components[0].variantProps.push({ id: "p1", name: "size", values: ["sm", "md"], default: "md" });
    theirs.name = "Renamed";

    const { merged, conflicts } = mergeDocuments(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.name).toBe("Renamed");
    expect(merged.components.map((c) => c.id)).toEqual(["comp-main", "btn"]);
    expect(merged.components[0].variantProps[0].name).toBe("size");
  });
});
