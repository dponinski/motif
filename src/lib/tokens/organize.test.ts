import { describe, expect, it } from "vitest";
import { deriveGroup, filterItems, groupItems, nextName, sortForReading, stemOf, stepOf, uniqueName, type Searchable } from "./organize";

describe("steps and stems", () => {
  it("reads the number a name ends in", () => {
    expect(stepOf("primary-500")).toBe(500);
    expect(stepOf("chart-1")).toBe(1);
    expect(stepOf("primary")).toBeNull();
    expect(stepOf("primary-foreground")).toBeNull();
    expect(stepOf("gray-1000")).toBeNull();
    expect(stemOf("primary-500")).toBe("primary");
    expect(stemOf("primary-foreground")).toBe("primary-foreground");
  });
});

describe("the group a color belongs in", () => {
  const all = ["gray-50", "gray-100", "gray-900", "primary", "primary-foreground", "background", "chart-1", "danger-500"];
  it("makes a ramp its own group", () => {
    expect(deriveGroup("gray-50", all)).toBe("gray");
    expect(deriveGroup("gray-900", all)).toBe("gray");
  });
  it("makes a pair its own group", () => {
    expect(deriveGroup("primary", all)).toBe("primary");
    expect(deriveGroup("primary-foreground", all)).toBe("primary");
  });
  it("leaves the rest in base, a lone numbered token among them", () => {
    expect(deriveGroup("background", all)).toBe("base");
    expect(deriveGroup("chart-1", all)).toBe("base");
    expect(deriveGroup("danger-500", all)).toBe("base");
  });
});

describe("the order a group reads in", () => {
  const names = (xs: { name: string }[]) => xs.map((x) => x.name);
  it("puts a ramp in step order, where its first token was", () => {
    const items = [{ name: "border" }, { name: "gray-900" }, { name: "ring" }, { name: "gray-50" }, { name: "gray-500" }];
    expect(names(sortForReading(items))).toEqual(["border", "gray-50", "gray-500", "gray-900", "ring"]);
  });
  it("leaves tokens that are not a ramp as they were", () => {
    const items = [{ name: "b" }, { name: "a" }, { name: "c-1" }];
    expect(names(sortForReading(items))).toEqual(["b", "a", "c-1"]);
  });
  it("keeps two ramps apart", () => {
    const items = [{ name: "b-200" }, { name: "a-100" }, { name: "b-100" }, { name: "a-200" }];
    expect(names(sortForReading(items))).toEqual(["b-100", "b-200", "a-100", "a-200"]);
  });
});

describe("groups", () => {
  it("come in the order they first appear, each in reading order", () => {
    const out = groupItems([
      { name: "x-2", group: "x" }, { name: "y", group: "y" }, { name: "x-1", group: "x" },
    ]);
    expect(out.map((g) => g.group)).toEqual(["x", "y"]);
    expect(out[0].items.map((i) => i.name)).toEqual(["x-1", "x-2"]);
  });
});

describe("searching", () => {
  const item = (name: string, over: Partial<Searchable> = {}): Searchable => ({ name, group: "g", text: "", linked: true, changed: false, readonly: false, ...over });
  const items = [item("primary-500", { text: "#6366f1", group: "primary" }), item("danger", { text: "#dc2626", changed: true }), item("brand", { linked: false }), item("fixed", { readonly: true })];
  it("matches name, group and value, every word", () => {
    expect(filterItems(items, "primary", "all").map((i) => i.name)).toEqual(["primary-500"]);
    expect(filterItems(items, "6366", "all").map((i) => i.name)).toEqual(["primary-500"]);
    expect(filterItems(items, "primary 6366", "all")).toHaveLength(1);
    expect(filterItems(items, "primary dc26", "all")).toHaveLength(0);
    expect(filterItems(items, "  ", "all")).toHaveLength(4);
  });
  it("filters by what changed, what is not in the repository, what can't be edited", () => {
    expect(filterItems(items, "", "changed").map((i) => i.name)).toEqual(["danger"]);
    expect(filterItems(items, "", "unsynced").map((i) => i.name)).toEqual(["brand"]);
    expect(filterItems(items, "", "readonly").map((i) => i.name)).toEqual(["fixed"]);
  });
});

describe("names", () => {
  it("finds a free name for a copy", () => {
    expect(uniqueName("a", ["b"])).toBe("a");
    expect(uniqueName("a", ["a"])).toBe("a-copy");
    expect(uniqueName("a", ["a", "a-copy"])).toBe("a-copy-2");
    expect(uniqueName("a-copy", ["a", "a-copy"])).toBe("a-copy-2");
  });
  it("suggests the next step of a ramp, the next number, or a plain name", () => {
    expect(nextName("primary", ["primary-50", "primary-100", "primary-900"])).toBe("primary-950");
    expect(nextName("primary", ["primary-950"])).toBe("primary-1050");
    expect(nextName("chart", ["chart-1", "chart-2"])).toBe("chart-3");
    expect(nextName("accent", [])).toBe("accent-1");
    expect(nextName("base", [])).toBe("color");
    expect(nextName("base", ["color"])).toBe("color-copy");
  });
});
