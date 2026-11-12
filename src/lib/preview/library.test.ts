import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import { componentId, describeUpdate, diffLibrary, importable, toLibrary } from "./library";

const analysis = await scanRepository(memorySource(loadFixture("motif-test-system")), { repo: "a/b", ref: "main" });

describe("library", () => {
  it("imports the public components under stable ids", () => {
    const library = toLibrary(analysis.components);
    expect(library).toHaveLength(22);
    expect(library[0].id).toBe(componentId(library[0]));
    expect(library.find((c) => c.name === "Button")!.id).toBe("src/components/Button.tsx::Button");
    expect(new Set(library.map((c) => c.id)).size).toBe(22);
  });

  it("leaves out internal components, and keeps everything when the repository has no entry file", () => {
    const c = (name: string, pub: boolean | null) => ({ ...analysis.components[0], name, public: pub });
    expect(importable([c("A", true), c("B", false), c("C", null)]).map((x) => x.name)).toEqual(["A", "C"]);
  });
});

describe("updating from the repository", () => {
  const before = toLibrary(analysis.components);

  it("reports nothing when nothing changed, including moved lines", () => {
    const moved = before.map((c) => ({ ...c, line: c.line + 10 }));
    const summary = diffLibrary(before, moved);
    expect(summary).toEqual({ added: [], changed: [], removed: [] });
    expect(describeUpdate(summary)).toBe("Up to date");
  });

  it("finds new, changed and removed components", () => {
    const button = before.find((c) => c.name === "Button")!;
    const next = before
      .filter((c) => c.name !== "Badge")
      .map((c) => (c.name === "Button" ? { ...button, variants: button.variants.slice(0, 1) } : c))
      .concat([{ ...button, name: "Chip", id: "src/components/Chip.tsx::Chip", file: "src/components/Chip.tsx" }]);
    const summary = diffLibrary(before, next);
    expect(summary).toEqual({ added: ["Chip"], changed: ["Button"], removed: ["Badge"] });
    expect(describeUpdate(summary)).toBe("1 new, 1 changed, 1 removed");
  });

  it("counts a changed prop default and a changed editability as changes", () => {
    const button = before.find((c) => c.name === "Button")!;
    const props = button.props.map((p) => (p.name === "variant" ? { ...p, default: "danger" } : p));
    expect(diffLibrary(before, before.map((c) => (c.id === button.id ? { ...c, props } : c))).changed).toEqual(["Button"]);
    expect(diffLibrary(before, before.map((c) => (c.id === button.id ? { ...c, support: { level: "view-only" as const, reasons: ["x"] } } : c))).changed).toEqual(["Button"]);
  });
});
