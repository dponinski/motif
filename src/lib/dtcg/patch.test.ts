import { describe, expect, it } from "vitest";
import { patchFiles } from "./patch";
import { mergeDtcg, describeDtcgChanges } from "./sync";
import { fixture } from "./fixture";
import { writeDtcg } from "./write";
import { readDtcg } from "./read";
import type { DtcgFiles } from "./types";

const FILE = "src/tokens/tokens.json";
const config = JSON.stringify({ files: "single", output: "src/styles/tokens.css", tailwind: true, selectors: {}, sets: [{ name: "Tokens", key: "tokens", themes: [] }] });
// A repository's own file: no hex, a description, a group nested deeper than Motif nests, hand-chosen formatting.
const own = `{
  "color": {
    "$type": "color",
    "brand": { "500": { "$value": { "colorSpace": "srgb", "components": [0.2, 0.4, 0.6] }, "$description": "The brand" } },
    "surface": { "$value": { "colorSpace": "srgb", "components": [1, 1, 1] } }
  },
  "spacing": { "sm": { "$type": "dimension", "$value": { "value": 8, "unit": "px" } } }
}
`;
const theirs = (): DtcgFiles => ({ "src/tokens/tokens.config.json": config, [FILE]: own });

describe("a repository's own files", () => {
  it("read into Motif and written back are what they were, with no change to push", () => {
    const { data } = readDtcg(theirs());
    const mine = writeDtcg(data, { files: "single", dir: "src/tokens", output: "src/styles/tokens.css", tailwind: true }).files;
    expect(describeDtcgChanges(theirs(), mine)).toEqual([]);
    // A token that was nested deeper keeps its place.
    expect(Object.keys(JSON.parse(mine[FILE]).color)).toContain("brand");
    expect(JSON.parse(mine[FILE]).color.brand["500"]).toBeDefined();
    const merge = mergeDtcg(theirs(), mine, theirs());
    expect(patchFiles(theirs(), merge.files)).toEqual({});
  });

  it("get only the token that changed written into them, in the text they have", () => {
    const { data } = readDtcg(theirs());
    const edited = { ...data, tokens: data.tokens.map((t) => (t.name === "surface" ? { ...t, values: { ...t.values, [data.sets[0].themes[0].id]: "#f0f0f0" } } : t)) };
    const mine = writeDtcg(edited, { files: "single", dir: "src/tokens", output: "src/styles/tokens.css", tailwind: true }).files;
    const merge = mergeDtcg(theirs(), mine, theirs());
    const patches = patchFiles(theirs(), merge.files);
    expect(Object.keys(patches)).toEqual([FILE]);
    const tree = JSON.parse(patches[FILE]);
    expect(tree.color.surface.$value.hex).toBe("#f0f0f0");
    // The rest is as the repository had it: no hex added, the description kept.
    expect(tree.color.brand["500"].$value).toEqual({ colorSpace: "srgb", components: [0.2, 0.4, 0.6] });
    expect(tree.color.brand["500"].$description).toBe("The brand");
    expect(tree.color.$type).toBe("color");
    expect(describeDtcgChanges(theirs(), { ...theirs(), ...patches })).toEqual([{ name: "color.surface", theme: null, type: "changed", before: "#ffffff", after: "#f0f0f0" }]);
  });

  it("get a token Motif added written in too", () => {
    const { data } = readDtcg(theirs());
    const added = { ...data, tokens: [...data.tokens, { id: "x", name: "ratio", setId: data.sets[0].id, type: "number" as const, unit: "" as const, values: { "*": "1.25" } }] };
    const mine = writeDtcg(added, { files: "single", dir: "src/tokens", output: "src/styles/tokens.css", tailwind: true }).files;
    const patches = patchFiles(theirs(), mergeDtcg(theirs(), mine, theirs()).files);
    expect(JSON.parse(patches[FILE]).ratio).toMatchObject({ $type: "number", $value: 1.25 });
    expect(JSON.parse(patches[FILE]).color.brand["500"].$description).toBe("The brand");
  });
});

describe("files Motif wrote", () => {
  it("need nothing written when nothing changed, and a new file is written whole", () => {
    const files = writeDtcg(fixture(), { files: "per-set" }).files;
    expect(patchFiles(files, mergeDtcg(files, files, files).files)).toEqual({});
    const { "src/tokens/semantic.dark.json": gone, ...planned } = files;
    expect(Object.keys(patchFiles(planned, files))).toEqual(["src/tokens/semantic.dark.json"]);
    expect(patchFiles(planned, files)["src/tokens/semantic.dark.json"]).toBe(gone);
  });
});

describe("renames", () => {
  const files = { "src/tokens/tokens.json": `${JSON.stringify({ color: { $type: "color", "gray-50": { $value: { colorSpace: "srgb", components: [1, 1, 1] } }, other: { $value: { colorSpace: "srgb", components: [0, 0, 0] } } } }, null, 2)}\n` };

  it("moves a token to its new place", async () => {
    const { applyRenames } = await import("./patch");
    const tree = JSON.parse(applyRenames(files, { "color.gray-50": "color.gray-25" })["src/tokens/tokens.json"]);
    expect(Object.keys(tree.color)).toEqual(["$type", "other", "gray-25"]);
  });

  it("is the same files without renames", async () => {
    const { applyRenames } = await import("./patch");
    expect(applyRenames(files, undefined)).toBe(files);
    expect(applyRenames(files, {})).toBe(files);
  });

  it("takes a token out where it was only when it was renamed away", async () => {
    const { patchFiles } = await import("./patch");
    const merged = { "src/tokens/tokens.json": files["src/tokens/tokens.json"].replace('"gray-50"', '"gray-25"') };
    const without = patchFiles(files, merged);
    expect(JSON.parse(without["src/tokens/tokens.json"]).color).toHaveProperty("gray-50");
    const gone = patchFiles(files, merged, { gone: new Set(["color.gray-50"]) });
    expect(JSON.parse(gone["src/tokens/tokens.json"]).color).not.toHaveProperty("gray-50");
    expect(JSON.parse(gone["src/tokens/tokens.json"]).color).toHaveProperty("gray-25");
  });
});
