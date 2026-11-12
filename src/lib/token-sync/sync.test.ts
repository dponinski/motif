import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import type { RepoToken } from "../repo-scan/types";
import { applyDoc, colorGroup, readMotifTokens, readRepoTokens, type LinkShape, type SyncDoc, type SyncToken, type TokenSlices } from "./doc";
import { changesToRepo, describeChanges, mergeTokens, resolveTokenMerge } from "./merge";

const empty: TokenSlices = { colors: [], spacing: [], radii: [], shadows: [] };
const link: LinkShape = { setId: "set-1", themes: { light: "t-light", dark: "t-dark" }, baseTheme: "light" };

const tok = (name: string, kind: RepoToken["kind"], values: Record<string, string>, container: "css-var" | "config" = "css-var"): RepoToken => ({
  name, kind, values, tailwind: null, file: "a.css", line: 1,
  locations: Object.fromEntries(Object.keys(values).map((t) => [t, { file: "a.css", line: 1, container }])),
});

const color = (light: string, dark?: string): SyncToken => ({ kind: "color", values: dark ? { light, dark } : { light } });

describe("readRepoTokens", async () => {
  const analysis = await scanRepository(memorySource(loadFixture("motif-test-system")), { repo: "a/b", ref: "main" }, { tokensOnly: true });
  const snapshot = readRepoTokens(analysis.tokens, analysis.themes);

  it("turns the real repository into 17 colors, 4 radii and 2 shadows", () => {
    const kinds = Object.values(snapshot.doc).map((t) => t.kind);
    expect(kinds.filter((k) => k === "color")).toHaveLength(17);
    expect(kinds.filter((k) => k === "radius")).toHaveLength(4);
    expect(kinds.filter((k) => k === "shadow")).toHaveLength(2);
    expect(snapshot.baseTheme).toBe("light");
    expect(snapshot.skipped).toEqual([
      { name: "font-sans", reason: "Motif has no font family tokens yet" },
      { name: "font-mono", reason: "Motif has no font family tokens yet" },
    ]);
    expect(snapshot.readonly).toEqual({});
  });

  it("normalizes values and keeps the original text", () => {
    expect(snapshot.doc.primary).toEqual({ kind: "color", values: { light: expect.stringMatching(/^#[0-9a-f]{6}$/), dark: expect.stringMatching(/^#[0-9a-f]{6}$/) } });
    expect(snapshot.raw.primary.light).toBe("oklch(0.52 0.21 270)");
    expect(snapshot.doc["radius-md"]).toEqual({ kind: "radius", values: { light: "8" } });
    expect(snapshot.doc["shadow-card"].values.light).toBe("0 1px 2px 0 #0000000a, 0 1px 3px 0 #0000000f");
  });
});

describe("readRepoTokens edge cases", () => {
  it("skips what Motif cannot hold and flags what it cannot write back", () => {
    const s = readRepoTokens([
      tok("a", "color", { default: "var(--b)" }),
      tok("b", "radius", { default: "50%" }),
      tok("c", "shadow", { default: "none" }),
      tok("d", "other", { default: "1" }),
      tok("e", "color", { default: "#fff" }, "config"),
      tok("f", "radius", { default: "4px", dark: "8px" }),
    ], ["default", "dark"]);
    expect(s.skipped.map((x) => x.name)).toEqual(["a", "b", "c", "d"]);
    expect(Object.keys(s.doc)).toEqual(["e", "f"]);
    expect(s.readonly).toEqual({ e: "Defined in a Tailwind config file, which can't be edited yet" });
    expect(s.doc.f.values).toEqual({ default: "4" });
    expect(s.notes).toEqual(["f: only the default value is synced"]);
  });
});

describe("applyDoc and readMotifTokens", () => {
  const doc: SyncDoc = {
    primary: color("#4f46e5", "#818cf8"),
    "primary-foreground": color("#ffffff", "#000000"),
    background: color("#ffffff", "#111111"),
    "radius-md": { kind: "radius", values: { light: "8" } },
    gap: { kind: "spacing", values: { light: "12" } },
    "shadow-card": { kind: "shadow", values: { light: "0 1px 2px 0 #0000000a, 0 1px 3px 0 #0000000f" } },
    "shadow-in": { kind: "shadow", values: { light: "inset 0 2px 4px 0 #0000000f" } },
  };

  it("creates Motif tokens with themes, groups and the first shadow layer", () => {
    const out = applyDoc(empty, link, doc, "t-light");
    const primary = out.colors.find((c) => c.name === "primary")!;
    expect(primary).toMatchObject({ repoName: "primary", setId: "set-1", group: "primary", value: "#4f46e5", themeValues: { "t-light": "#4f46e5", "t-dark": "#818cf8" } });
    expect(out.colors.map((c) => [c.name, c.group])).toEqual([["primary", "primary"], ["primary-foreground", "primary"], ["background", "base"]]);
    expect(out.radii[0]).toMatchObject({ name: "radius-md", value: 8 });
    expect(out.spacing[0]).toMatchObject({ name: "gap", value: 12 });
    expect(out.shadows[0]).toMatchObject({ name: "shadow-card", x: 0, y: 1, blur: 2, spread: 0, color: "#0000000a", group: "default", raw: doc["shadow-card"].values.light });
    expect(out.shadows[1]).toMatchObject({ group: "inner", inset: true, raw: undefined });
  });

  it("reads back exactly what was applied", () => {
    expect(readMotifTokens(applyDoc(empty, link, doc, "t-light"), link)).toEqual(doc);
  });

  it("updates in place, keeps ids and untouched text, drops removed tokens, and leaves other sets alone", () => {
    const first = applyDoc({ ...empty, colors: [{ id: "other", name: "x", value: "#000000", group: "g", setId: "set-2", themeValues: {} }] }, link, doc, "t-light");
    const edited = first.colors.map((c) => (c.name === "background" ? { ...c, themeValues: { ...c.themeValues, "t-light": "#FFFFFF" } } : c));
    const next: SyncDoc = { ...doc, primary: color("#000000", "#818cf8") };
    delete next["primary-foreground"];
    const out = applyDoc({ ...first, colors: edited }, link, next, "t-light");
    expect(out.colors.find((c) => c.setId === "set-2")!.id).toBe("other");
    expect(out.colors.find((c) => c.name === "primary")).toMatchObject({ id: first.colors.find((c) => c.name === "primary")!.id, value: "#000000" });
    expect(out.colors.find((c) => c.name === "background")!.themeValues["t-light"]).toBe("#FFFFFF");
    expect(out.colors.some((c) => c.name === "primary-foreground")).toBe(false);
  });

  it("falls back to the base value for a theme the token does not define", () => {
    const out = applyDoc(empty, link, { only: color("#123456") }, "t-dark");
    expect(out.colors[0]).toMatchObject({ themeValues: { "t-light": "#123456", "t-dark": "#123456" }, value: "#123456" });
  });

  it("only groups a color with its -foreground pair", () => {
    expect(colorGroup("success", ["success", "success-foreground", "border"])).toBe("success");
    expect(colorGroup("success-foreground", ["success", "success-foreground"])).toBe("success");
    expect(colorGroup("border", ["success", "success-foreground", "border"])).toBe("base");
  });
});

describe("mergeTokens", () => {
  const base: SyncDoc = { a: color("#111111", "#222222"), b: color("#333333"), r: { kind: "radius", values: { light: "4" } } };

  it("combines edits to different themes of one token", () => {
    const mine = { ...base, a: color("#aaaaaa", "#222222") };
    const theirs = { ...base, a: color("#111111", "#bbbbbb") };
    const { merged, conflicts } = mergeTokens(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.a).toEqual(color("#aaaaaa", "#bbbbbb"));
  });

  it("reports a clash on the same value and lets either side win", () => {
    const mine = { ...base, b: color("#aaaaaa") };
    const theirs = { ...base, b: color("#bbbbbb") };
    const result = mergeTokens(base, mine, theirs);
    expect(result.conflicts).toEqual([{ path: ["b", "values", "light"], name: "b", theme: "light", label: "b · light", mine: "#aaaaaa", theirs: "#bbbbbb", theirsValue: "#bbbbbb" }]);
    expect(result.merged.b.values.light).toBe("#aaaaaa");
    expect(resolveTokenMerge(result, [0]).b.values.light).toBe("#bbbbbb");
    expect(resolveTokenMerge(result, []).b.values.light).toBe("#aaaaaa");
  });

  it("takes tokens added on either side", () => {
    const { merged, conflicts } = mergeTokens(base, { ...base, mine: color("#010101") }, { ...base, theirs: color("#020202") });
    expect(conflicts).toEqual([]);
    expect(Object.keys(merged)).toEqual(expect.arrayContaining(["a", "b", "r", "mine", "theirs"]));
  });

  it("restores a token deleted in Motif instead of deleting it from the repo", () => {
    const { a, ...mine } = base;
    const result = mergeTokens(base, mine, { ...base, a: color("#999999", "#222222") });
    expect(result.restored).toEqual(["a"]);
    expect(result.conflicts).toEqual([]);
    expect(result.merged.a).toEqual(color("#999999", "#222222"));
    void a;
  });

  it("applies a deletion made in the repo, unless the token was edited in Motif", () => {
    const { b, ...theirs } = base;
    expect(mergeTokens(base, base, theirs).merged).not.toHaveProperty("b");
    const clash = mergeTokens(base, { ...base, b: color("#abcdef") }, theirs);
    expect(clash.conflicts).toMatchObject([{ name: "b", theme: null, label: "b", mine: "light #abcdef", theirs: "Removed" }]);
    expect(resolveTokenMerge(clash, [0])).not.toHaveProperty("b");
    expect(resolveTokenMerge(clash, [])).toHaveProperty("b");
    void b;
  });

  it("with nothing synced yet, treats every difference as a clash and every addition as new", () => {
    const result = mergeTokens({}, { x: color("#111111"), y: color("#222222") }, { x: color("#999999"), z: color("#333333") });
    expect(result.conflicts.map((c) => c.label)).toEqual(["x · light"]);
    expect(Object.keys(result.merged).sort()).toEqual(["x", "y", "z"]);
  });
});

describe("describing changes", () => {
  const theirs: SyncDoc = { a: color("#111111", "#222222"), r: { kind: "radius", values: { light: "4" } } };

  it("lists what a pull request would contain, and never removals", () => {
    const merged: SyncDoc = { a: color("#111111", "#333333"), n: color("#444444", "#555555") };
    expect(changesToRepo(merged, theirs)).toEqual([
      { name: "a", kind: "color", theme: "dark", type: "changed", before: "#222222", after: "#333333" },
      { name: "n", kind: "color", theme: "light", type: "added", before: undefined, after: "#444444" },
      { name: "n", kind: "color", theme: "dark", type: "added", before: undefined, after: "#555555" },
    ]);
    expect(describeChanges(theirs, merged).some((c) => c.type === "removed")).toBe(true);
    expect(changesToRepo(theirs, theirs)).toEqual([]);
  });
});
