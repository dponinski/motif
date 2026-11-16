import { beforeEach, describe, expect, it } from "vitest";
import type { GitHost, RepoReader } from "./github";
import { memoryReader } from "./repo-scan";
import { loadFixture } from "./repo-scan/fixtures";
import { finishPull, pullRepository } from "./pull";
import { emptyTokenData, useDesignSystemStore } from "../store/design-system";
import { useGitStore, type GitConnection } from "../store/git";
import { useLibraryStore } from "../store/library";

const CSS = "src/styles/motif.css";
const connection: GitConnection = { owner: "acme", repo: "ds", token: "t", defaultBranch: "main" };
const host = (files: Record<string, string>, sha = "sha-1"): GitHost & RepoReader => ({ ...memoryReader(files), getRef: async () => sha } as unknown as GitHost & RepoReader);

const ds = () => useDesignSystemStore.getState();
const git = () => useGitStore.getState();
const color = (name: string) => ds().colors.find((c) => (c.repoName ?? c.name) === name)!;
const light = () => ds().sets[0].themes[0].id;

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useLibraryStore.getState().clear();
  git().load({ connection, analysis: null, tokenLink: null, work: null, pulledSha: null });
});

describe("the first pull of a repository", () => {
  const files = loadFixture("motif-test-system");

  it("brings in its components and its tokens, as the set it was given to start with, linked to the repository", async () => {
    const out = await pullRepository(host(files), connection);
    expect(out.conflicts).toBeNull();
    expect(useLibraryStore.getState().components.length).toBeGreaterThan(5);
    // The set every project starts with is the repository's, not left empty beside another.
    expect(ds().sets).toHaveLength(1);
    expect(ds().sets[0].name).toBe("acme/ds");
    expect(git().tokenLink).toMatchObject({ repo: "acme/ds", branch: "main", setId: ds().sets[0].id });
    expect(Object.keys(git().tokenLink!.themes)).toEqual(expect.arrayContaining(["light", "dark"]));
    expect(color("primary").themeValues[light()]).toBe("#3e55df");
    expect(git().pulledSha).toBe("sha-1");
    expect(out.notes.join(" ")).toMatch(/tokens brought in/);
  });

  it("keeps the tokens that were made before it, in a set of their own, when the project had some", async () => {
    ds().addColor({ name: "mine", value: "#123456", group: "base", setId: ds().sets[0].id });
    await pullRepository(host(files), connection);
    expect(ds().sets).toHaveLength(2);
    expect(ds().colors.some((c) => c.name === "mine" && c.setId === ds().sets[0].id)).toBe(true);
    expect(git().tokenLink!.setId).toBe(ds().sets[1].id);
  });

  it("links the set that has tokens when the repository has none, to be sent with the first push", async () => {
    const bare = { "package.json": '{"dependencies":{"react":"^19.0.0"}}', "src/Button.tsx": "export function Button() { return <button>Hi</button>; }\n" };
    ds().addColor({ name: "brand", value: "#1d4ed8", group: "base", setId: ds().sets[0].id });
    await pullRepository(host(bare), connection);
    const link = git().tokenLink!;
    expect(link.setId).toBe(ds().sets[0].id);
    expect(link.base).toEqual({});
    expect(Object.keys(link.themes)).toHaveLength(ds().sets[0].themes.length);
  });

  it("links the first set even when it is empty, so the first token made is usable", async () => {
    const bare = { "package.json": '{"dependencies":{"react":"^19.0.0"}}', "src/Button.tsx": "export function Button() { return <button>Hi</button>; }\n" };
    await pullRepository(host(bare), connection);
    expect(git().tokenLink!.setId).toBe(ds().sets[0].id);
  });
});

describe("a later pull", () => {
  const files = loadFixture("motif-test-system");
  const changedRepo = (to: string) => ({ ...files, [CSS]: files[CSS].replace("--primary: oklch(0.52 0.21 270);", `--primary: ${to};`) });

  it("takes in what the repository changed, and nothing else moves", async () => {
    await pullRepository(host(files), connection);
    const before = color("secondary").themeValues[light()];
    const out = await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    expect(out.conflicts).toBeNull();
    expect(color("primary").themeValues[light()]).toBe("#de3e2d");
    expect(color("secondary").themeValues[light()]).toBe(before);
    expect(git().pulledSha).toBe("sha-2");
    expect(out.notes.join(" ")).toMatch(/token change/);
  });

  it("keeps a token changed here that the repository didn't change", async () => {
    await pullRepository(host(files), connection);
    ds().setColorText(color("secondary").id, light(), "#ff0000");
    await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    expect(color("secondary").themeValues[light()]).toBe("#ff0000");
    expect(color("primary").themeValues[light()]).toBe("#de3e2d");
  });

  it("asks about a value changed in both places, and takes nothing of the tokens until it is answered", async () => {
    await pullRepository(host(files), connection);
    ds().setColorText(color("primary").id, light(), "#ff0000");
    const out = await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    expect(out.conflicts?.plan.merge.conflicts.length).toBe(1);
    expect(color("primary").themeValues[light()]).toBe("#ff0000");
    // The person keeps the repository's value.
    finishPull(out.conflicts!, [0]);
    expect(color("primary").themeValues[light()]).toBe("#de3e2d");
  });

  it("keeps Motif's value when that is the choice, to be sent with the next push", async () => {
    await pullRepository(host(files), connection);
    ds().setColorText(color("primary").id, light(), "#ff0000");
    const out = await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    finishPull(out.conflicts!, []);
    expect(color("primary").themeValues[light()]).toBe("#ff0000");
  });

  it("is up to date when nothing changed", async () => {
    await pullRepository(host(files), connection);
    const out = await pullRepository(host(files), connection);
    expect(out.conflicts).toBeNull();
    expect(out.notes).toEqual([]);
  });
});
