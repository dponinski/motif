import { describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import { describeDtcgChanges, mergeDtcg, planDtcgSync, resolveDtcg, takeDtcg, themeOfFile, type DtcgLink } from "./sync";
import { writeDtcg } from "./write";
import type { DtcgFiles } from "./types";

const PRIM = "src/tokens/primitives.json";
const PRIM_DARK = "src/tokens/primitives.dark.json";
const SEM = "src/tokens/semantic.json";

const written = () => writeDtcg(fixture(), { files: "per-set" }).files;
// A file with a change made to it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edit = (files: DtcgFiles, file: string, change: (tree: any) => void): DtcgFiles => {
  const tree = JSON.parse(files[file]);
  change(tree);
  return { ...files, [file]: `${JSON.stringify(tree, null, 2)}\n` };
};
const red = { colorSpace: "srgb", components: [1, 0, 0], hex: "#ff0000" };
const blue = { colorSpace: "srgb", components: [0, 0, 1], hex: "#0000ff" };

describe("merging design tokens files", () => {
  it("is the same files when nothing changed", () => {
    const base = written();
    const merge = mergeDtcg(base, base, base);
    expect(merge.conflicts).toEqual([]);
    expect(merge.restored).toEqual([]);
    expect(JSON.parse(merge.files[PRIM])).toEqual(JSON.parse(base[PRIM]));
  });

  it("takes a token changed in Motif and one changed in the repository", () => {
    const base = written();
    const mine = edit(base, PRIM, (t) => { t.color["gray-50"].$value = red; });
    const theirs = edit(base, PRIM, (t) => { t.color.brand.$value = blue; });
    const merge = mergeDtcg(base, mine, theirs);
    expect(merge.conflicts).toEqual([]);
    const merged = JSON.parse(merge.files[PRIM]);
    expect(merged.color["gray-50"].$value.hex).toBe("#ff0000");
    expect(merged.color.brand.$value.hex).toBe("#0000ff");
  });

  it("asks about a token changed in both places, and says which and where", () => {
    const base = written();
    const mine = edit(base, PRIM_DARK, (t) => { t.color["gray-50"].$value = red; });
    const theirs = edit(base, PRIM_DARK, (t) => { t.color["gray-50"].$value = blue; });
    const merge = mergeDtcg(base, mine, theirs);
    expect(merge.conflicts).toHaveLength(1);
    expect(merge.conflicts[0]).toMatchObject({ name: "color.gray-50", theme: "dark", label: "color.gray-50 · dark", mine: "#ff0000", theirs: "#0000ff" });
    // Provisionally Motif's; the repository's when chosen.
    expect(JSON.parse(merge.files[PRIM_DARK]).color["gray-50"].$value.hex).toBe("#ff0000");
    expect(JSON.parse(resolveDtcg(merge, [0])[PRIM_DARK]).color["gray-50"].$value.hex).toBe("#0000ff");
  });

  it("isn't a clash when both sides made the same change", () => {
    const base = written();
    const both = edit(base, PRIM, (t) => { t.color.brand.$value = blue; });
    expect(mergeDtcg(base, both, both).conflicts).toEqual([]);
  });

  it("keeps a color's components together when both sides changed the color", () => {
    const base = written();
    const mine = edit(base, PRIM, (t) => { t.color.brand.$value = { colorSpace: "oklch", components: [0.5, 0.1, 100] }; });
    const theirs = edit(base, PRIM, (t) => { t.color.brand.$value = { colorSpace: "oklch", components: [0.5, 0.3, 200] }; });
    const merge = mergeDtcg(base, mine, theirs);
    expect(merge.conflicts.map((c) => c.name)).toEqual(["color.brand"]);
    expect(JSON.parse(merge.files[PRIM]).color.brand.$value.components).toEqual([0.5, 0.1, 100]);
  });

  it("takes a token the repository added, and one Motif added", () => {
    const base = written();
    const mine = edit(base, PRIM, (t) => { t.spacing["8"] = { $type: "dimension", $value: { value: 32, unit: "px" } }; });
    const theirs = edit(base, PRIM, (t) => { t.radius.lg = { $type: "dimension", $value: { value: 12, unit: "px" } }; });
    const merged = JSON.parse(mergeDtcg(base, mine, theirs).files[PRIM]);
    expect(merged.spacing["8"]).toBeDefined();
    expect(merged.radius.lg).toBeDefined();
  });

  it("brings back a token that was deleted in Motif, since a sync deletes nothing from a repository", () => {
    const base = written();
    const mine = edit(base, PRIM, (t) => { delete t.color.overlay; });
    const merge = mergeDtcg(base, mine, base);
    expect(merge.restored).toEqual(["color.overlay"]);
    expect(JSON.parse(merge.files[PRIM]).color.overlay).toBeDefined();
  });

  it("takes a deletion the repository made", () => {
    const base = written();
    const theirs = edit(base, PRIM, (t) => { delete t.color.overlay; });
    expect(JSON.parse(mergeDtcg(base, base, theirs).files[PRIM]).color.overlay).toBeUndefined();
  });

  it("keeps a file Motif deleted that the repository still has", () => {
    const base = written();
    const { [SEM]: _, ...mine } = base;
    expect(mergeDtcg(base, mine, base).files[SEM]).toBeDefined();
  });

  it("takes a file the repository added", () => {
    const base = written();
    const theirs = { ...base, "src/tokens/extra.json": JSON.stringify({ ratio: { $type: "number", $value: 2 } }) };
    expect(Object.keys(mergeDtcg(base, base, theirs).files)).toContain("src/tokens/extra.json");
  });

  it("knows the theme a file is of", () => {
    expect(themeOfFile("src/tokens/primitives.dark.json")).toBe("dark");
    expect(themeOfFile("src/tokens/tokens.json")).toBeNull();
    expect(themeOfFile("src/tokens/tokens.config.json")).toBeNull();
  });
});

describe("what changed in the files", () => {
  it("lists tokens added, changed and removed, by theme", () => {
    const from = written();
    const to = edit(edit(from, PRIM, (t) => { t.color.brand.$value = blue; delete t.color.overlay; t.ratio2 = { $type: "number", $value: 3 }; }), PRIM_DARK, (t) => { t.color.brand.$value = red; });
    const changes = describeDtcgChanges(from, to);
    expect(changes).toContainEqual({ name: "color.brand", theme: null, type: "changed", before: "oklch(0.6 0.2 260)", after: "#0000ff" });
    expect(changes).toContainEqual({ name: "color.brand", theme: "dark", type: "changed", before: "oklch(0.7 0.18 260)", after: "#ff0000" });
    expect(changes).toContainEqual({ name: "color.overlay", theme: null, type: "removed", before: "#00000080" });
    expect(changes).toContainEqual({ name: "ratio2", theme: null, type: "added", after: "3" });
  });

  it("isn't about the config", () => {
    const from = written();
    const to = { ...from, "src/tokens/tokens.config.json": "{}" };
    expect(describeDtcgChanges(from, to)).toEqual([]);
  });
});

describe("a sync of Motif and a repository of design tokens files", () => {
  const link = (base: DtcgFiles): DtcgLink => ({ format: "dtcg", repo: "acme/ds", branch: "main", dir: "src/tokens", files: "per-set", output: "src/styles/tokens.css", tailwind: true, base, syncedAt: 1 });

  it("has nothing to do when both are as they were", () => {
    const model = fixture();
    const base = writeDtcg(model, { files: "per-set" }).files;
    const plan = planDtcgSync(link(base), model, base);
    expect(plan.toMotif).toEqual([]);
    expect(plan.toRepo).toEqual([]);
    expect(plan.merge.conflicts).toEqual([]);
  });

  it("brings the repository's change into Motif, keeping what Motif has, ids and all", () => {
    const model = fixture();
    const base = writeDtcg(model, { files: "per-set" }).files;
    const theirs = edit(base, PRIM, (t) => { t.color["gray-50"].$value = red; });
    const plan = planDtcgSync(link(base), model, theirs);
    expect(plan.toMotif).toEqual([{ name: "color.gray-50", theme: null, type: "changed", before: "#f9fafb", after: "#ff0000" }]);
    expect(plan.toRepo).toEqual([]);
    const taken = takeDtcg(plan.merge.files, model);
    expect(taken.notes).toEqual([]);
    expect(taken.data.tokens.find((t) => t.id === "g50")!.values["p-l"]).toBe("#ff0000");
    // The color that is gray-50 follows it.
    expect(taken.data.tokens.find((t) => t.id === "surface")!.values["s-l"]).toBe("#ff0000");
    expect(taken.data.tokens.map((t) => t.id).sort()).toEqual(model.tokens.map((t) => t.id).sort());
  });

  it("puts Motif's change into what goes to the repository", () => {
    const model = fixture();
    const base = writeDtcg(model, { files: "per-set" }).files;
    const edited = { ...model, tokens: model.tokens.map((t) => (t.id === "brand" ? { ...t, values: { ...t.values, "p-l": "#0000ff" }, value: "#0000ff" } : t)) };
    const plan = planDtcgSync(link(base), edited, base);
    expect(plan.toRepo).toEqual([{ name: "color.brand", theme: null, type: "changed", before: "oklch(0.6 0.2 260)", after: "#0000ff" }]);
    expect(plan.toMotif).toEqual([]);
  });

  it("asks when both changed the same value", () => {
    const model = fixture();
    const base = writeDtcg(model, { files: "per-set" }).files;
    const edited = { ...model, tokens: model.tokens.map((t) => (t.id === "brand" ? { ...t, values: { ...t.values, "p-l": "#0000ff" }, value: "#0000ff" } : t)) };
    const theirs = edit(base, PRIM, (t) => { t.color.brand.$value = red; });
    expect(planDtcgSync(link(base), edited, theirs).merge.conflicts.map((c) => c.label)).toEqual(["color.brand"]);
  });
});
