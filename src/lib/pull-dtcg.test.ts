import { beforeEach, describe, expect, it } from "vitest";
import type { GitHost, RepoReader } from "./github";
import { memoryReader } from "./repo-scan";
import { finishPull, pullRepository } from "./pull";
import { fixture } from "./dtcg/fixture";
import { writeDtcg } from "./dtcg/write";
import { fromStored } from "./tokens/migrate";
import { emptyTokenData, useDesignSystemStore } from "../store/design-system";
import { isDtcgLink, useGitStore, type GitConnection } from "../store/git";
import { useLibraryStore } from "../store/library";

const connection: GitConnection = { owner: "acme", repo: "ds", token: "t", defaultBranch: "main" };
const APP = { "package.json": '{"dependencies":{"react":"^19.0.0"}}', "src/Button.tsx": "export function Button() { return <button>Hi</button>; }\n" };
const host = (files: Record<string, string>, sha = "sha-1"): GitHost & RepoReader => ({ ...memoryReader(files), getRef: async () => sha } as unknown as GitHost & RepoReader);

const ds = () => useDesignSystemStore.getState();
const git = () => useGitStore.getState();
const link = () => { const l = git().tokenLink; return isDtcgLink(l) ? l : null; };
const color = (name: string) => ds().colors.find((c) => c.name === name)!;
const written = () => writeDtcg(fixture(), { files: "per-set" }).files;
const edit = (files: Record<string, string>, file: string, change: (tree: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const tree = JSON.parse(files[file]);
  change(tree);
  return { ...files, [file]: `${JSON.stringify(tree, null, 2)}\n` };
};
const red = { colorSpace: "srgb", components: [1, 0, 0], hex: "#ff0000" };
const blue = { colorSpace: "srgb", components: [0, 0, 1], hex: "#0000ff" };

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useLibraryStore.getState().clear();
  git().load({ connection, analysis: null, tokenLink: null, work: null, pulledSha: null });
});

describe("the first pull of a repository of design tokens files", () => {
  it("brings the tokens in as the sets, themes and tokens the files say, linked to the repository", async () => {
    const out = await pullRepository(host({ ...APP, ...written() }), connection);
    expect(out.notes.join(" ")).toMatch(/tokens brought in/);
    expect(ds().sets.map((s) => s.name)).toEqual(["Primitives", "Semantic"]);
    expect(ds().sets[0].themes.map((t) => t.name)).toEqual(["Light", "Dark"]);
    expect(color("gray-50").themeValues[ds().sets[0].themes[1].id]).toBe("#1f2937");
    // A color that is another color, in another set, is still it.
    expect(color("surface").themeAlias?.[ds().sets[1].themes[0].id]).toBe(`${ds().sets[0].id}/gray-50`);
    expect(ds().compositions.map((c) => c.name).sort()).toEqual(["badge", "card", "heading"]);
    expect(link()).toMatchObject({ repo: "acme/ds", branch: "main", dir: "src/tokens", files: "per-set", output: "src/styles/tokens.css" });
    expect(link()!.base).toEqual(written());
  });

  it("leaves a project that has tokens of its own as it is, and says so", async () => {
    ds().addColor({ name: "mine", value: "#123456", group: "base", setId: ds().sets[0].id });
    const out = await pullRepository(host({ ...APP, ...written() }), connection);
    expect(out.notes.join(" ")).toMatch(/already has tokens of its own/);
    expect(link()).toBeNull();
    expect(ds().colors.map((c) => c.name)).toEqual(["mine"]);
  });

  it("waits for the first push, with every set going in as design tokens files, when it has no tokens at all", async () => {
    ds().addColor({ name: "brand", value: "#1d4ed8", group: "base", setId: ds().sets[0].id });
    await pullRepository(host(APP), connection);
    expect(link()).toMatchObject({ repo: "acme/ds", branch: "main", files: "single", base: {}, tailwind: false });
    expect(link()!.output).toMatch(/tokens\.css$/);
    expect(ds().colors.map((c) => c.name)).toEqual(["brand"]);
  });

  it("starts the same way when the repository uses Tailwind 4, and says so in the link", async () => {
    await pullRepository(host({ ...APP, "package.json": '{"dependencies":{"react":"^19.0.0"},"devDependencies":{"tailwindcss":"^4.0.0"}}', "src/index.css": '@import "tailwindcss";\n' }), connection);
    expect(link()).toMatchObject({ tailwind: true, base: {} });
  });

  it("keeps the stylesheet sync for a Tailwind 3 repository with no tokens", async () => {
    await pullRepository(host({ ...APP, "package.json": '{"dependencies":{"react":"^19.0.0"},"devDependencies":{"tailwindcss":"^3.4.0"}}', "tailwind.config.js": "module.exports = { content: [] };\n" }), connection);
    expect(link()).toBeNull();
    expect(git().tokenLink).toMatchObject({ repo: "acme/ds", setId: ds().sets[0].id, base: {} });
  });
});

describe("a later pull", () => {
  const start = async () => { await pullRepository(host({ ...APP, ...written() }), connection); };

  it("has nothing to say when nothing changed", async () => {
    await start();
    const out = await pullRepository(host({ ...APP, ...written() }), connection);
    expect(out.notes).toEqual([]);
    expect(out.conflicts).toBeNull();
  });

  it("takes what the repository changed, and keeps what Motif has, ids and all", async () => {
    await start();
    const id = color("gray-50").id;
    ds().addColor({ name: "added-here", value: "#abcdef", group: "base", setId: ds().sets[0].id });
    const theirs = edit(written(), "src/tokens/primitives.json", (t) => { t.color["gray-50"].$value = red; });
    const out = await pullRepository(host({ ...APP, ...theirs }, "sha-2"), connection);
    expect(out.notes.join(" ")).toMatch(/1 token change from the repository/);
    expect(color("gray-50").id).toBe(id);
    expect(color("gray-50").themeValues[ds().sets[0].themes[0].id]).toBe("#ff0000");
    // The color that is gray-50 follows it, and what was made here is still here.
    expect(color("surface").themeValues[ds().sets[1].themes[0].id]).toBe("#ff0000");
    expect(color("added-here")).toBeDefined();
    expect(link()!.base).toEqual(theirs);
  });

  it("asks about a value changed in both places, and takes the side that was chosen", async () => {
    await start();
    const l0 = ds().sets[0].themes[0].id;
    ds().setColorText(color("brand").id, l0, "#00ff00");
    const theirs = edit(written(), "src/tokens/primitives.json", (t) => { t.color.brand.$value = red; t.color["gray-900"].$value = blue; });
    const out = await pullRepository(host({ ...APP, ...theirs }, "sha-2"), connection);
    expect(out.conflicts?.format).toBe("dtcg");
    expect(out.conflicts!.plan.merge.conflicts.map((c) => c.label)).toEqual(["color.brand"]);
    // Nothing is taken until it is chosen.
    expect(color("gray-900").themeValues[l0]).toBe("#111827");
    const text = finishPull(out.conflicts!, [0]);
    expect(text).toMatch(/token changes? taken/);
    expect(color("brand").themeValues[l0]).toBe("#ff0000");
    expect(color("gray-900").themeValues[l0]).toBe("#0000ff");
  });

  it("keeps Motif's value when that is what was chosen, to be sent with the next push", async () => {
    await start();
    const l0 = ds().sets[0].themes[0].id;
    ds().setColorText(color("brand").id, l0, "#00ff00");
    const theirs = edit(written(), "src/tokens/primitives.json", (t) => { t.color.brand.$value = red; });
    const out = await pullRepository(host({ ...APP, ...theirs }, "sha-2"), connection);
    finishPull(out.conflicts!, []);
    expect(color("brand").themeValues[l0]).toBe("#00ff00");
    expect(link()!.base).toEqual(theirs);
  });

  it("brings back what Motif deleted, since a sync never deletes from a repository", async () => {
    await start();
    ds().deleteColor(color("overlay").id);
    const out = await pullRepository(host({ ...APP, ...written() }), connection);
    expect(out.notes.join(" ")).toMatch(/1 token change/);
    expect(color("overlay")).toBeDefined();
  });

  it("says when the files are gone from the repository, and leaves the tokens", async () => {
    await start();
    const out = await pullRepository(host(APP), connection);
    expect(out.notes.join(" ")).toMatch(/aren't in the repository any more/);
    expect(ds().colors.length).toBeGreaterThan(0);
  });

  it("isn't followed on another branch", async () => {
    await start();
    git().setTokenLink({ ...link()!, branch: "other" });
    const theirs = edit(written(), "src/tokens/primitives.json", (t) => { t.color["gray-50"].$value = red; });
    const out = await pullRepository(host({ ...APP, ...theirs }), connection);
    expect(out.notes).toEqual([]);
    expect(color("gray-50").themeValues[ds().sets[0].themes[0].id]).toBe("#f9fafb");
  });
});

describe("the tokens a pull takes in", () => {
  it("are the tokens of the files, to the last color", async () => {
    await pullRepository(host({ ...APP, ...written() }), connection);
    const from = fromStored(fixture());
    expect(ds().colors.map((c) => [c.name, c.value]).sort()).toEqual(from.colors.map((c) => [c.name, c.value]).sort());
    expect(ds().numbers.length + ds().spacing.length + ds().radii.length).toBe(from.numbers.length + from.spacing.length + from.radii.length);
    expect(ds().strings.length).toBe(from.strings.length);
  });
});
