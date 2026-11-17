import { beforeEach, describe, expect, it } from "vitest";
import type { GitHost, RepoReader } from "./github";
import { memoryReader } from "./repo-scan";
import { loadFixture } from "./repo-scan/fixtures";
import { finishPull, pullRepository } from "./pull";
import { readRepoState } from "./token-sync/flow";
import { importRepoTokens } from "../store/token-sync";
import { emptyTokenData, useDesignSystemStore } from "../store/design-system";
import { isDtcgLink, stylesheetLink, useGitStore, type GitConnection } from "../store/git";
import { useLibraryStore } from "../store/library";

const CSS = "src/styles/motif.css";
const connection: GitConnection = { owner: "acme", repo: "ds", token: "t", defaultBranch: "main" };
const host = (files: Record<string, string>, sha = "sha-1"): GitHost & RepoReader => ({ ...memoryReader(files), getRef: async () => sha } as unknown as GitHost & RepoReader);

const ds = () => useDesignSystemStore.getState();
const git = () => useGitStore.getState();
const sheetLink = () => stylesheetLink(git().tokenLink);
const color = (name: string) => ds().colors.find((c) => c.name === name || c.repoName === name)!;
const light = () => ds().sets[0].themes[0].id;

// A project that was linked to the repository's stylesheets before tokens were converted on pull: it stays as it is.
async function linkedBefore(files: Record<string, string>) {
  const state = await readRepoState(memoryReader(files), "acme/ds", "main");
  git().setAnalysis(state.analysis);
  importRepoTokens("acme/ds", "main", state, { reuseEmpty: true });
}

beforeEach(() => {
  useDesignSystemStore.setState({ ...emptyTokenData() });
  useLibraryStore.getState().clear();
  git().load({ connection, analysis: null, tokenLink: null, work: null, pulledSha: null });
});

describe("the first pull of a repository", () => {
  const files = loadFixture("motif-test-system");

  it("brings in its components and its tokens as design tokens, with the names the variables have, nothing written to the repository", async () => {
    const out = await pullRepository(host(files), connection);
    expect(out.conflicts).toBeNull();
    expect(useLibraryStore.getState().components.length).toBeGreaterThan(5);
    // The set every project starts with is the repository's, not left empty beside another.
    expect(ds().sets).toHaveLength(1);
    expect(ds().sets[0].name).toBe("ds");
    const link = git().tokenLink;
    expect(isDtcgLink(link)).toBe(true);
    expect(sheetLink()).toBeNull();
    if (!isDtcgLink(link)) return;
    expect(link).toMatchObject({ repo: "acme/ds", branch: "main", files: "single", tailwind: true });
    expect(link.convert!.converted).toEqual(expect.arrayContaining(["primary", "background", "radius-lg"]));
    expect(ds().sets[0].themes.map((t) => t.name)).toEqual(["Light", "Dark"]);
    expect(color("primary").themeValues[light()]).toMatch(/^oklch\(0\.52 0\.21 270\)$/);
    expect(git().pulledSha).toBe("sha-1");
    expect(out.notes.join(" ")).toMatch(/tokens brought in/);
  });

  it("leaves a project that has tokens of its own alone, and says so", async () => {
    ds().addColor({ name: "mine", value: "#123456", group: "base", setId: ds().sets[0].id });
    const out = await pullRepository(host(files), connection);
    expect(ds().sets).toHaveLength(1);
    expect(ds().colors.map((c) => c.name)).toEqual(["mine"]);
    expect(git().tokenLink).toBeNull();
    expect(out.notes.join(" ")).toMatch(/already has tokens of its own/);
  });

  it("links the set that has tokens when the repository has none, to be sent with the first push", async () => {
    // (Tailwind 3: the stylesheet sync stays; a repository with no tokens that isn't, starts with design tokens files: see pull-dtcg.test.ts.)
    const bare = { "package.json": '{"dependencies":{"react":"^19.0.0"},"devDependencies":{"tailwindcss":"^3.4.0"}}', "tailwind.config.js": "module.exports = { content: [] };\n", "src/Button.tsx": "export function Button() { return <button>Hi</button>; }\n" };
    ds().addColor({ name: "brand", value: "#1d4ed8", group: "base", setId: ds().sets[0].id });
    await pullRepository(host(bare), connection);
    const link = sheetLink()!;
    expect(link.setId).toBe(ds().sets[0].id);
    expect(link.base).toEqual({});
    expect(Object.keys(link.themes)).toHaveLength(ds().sets[0].themes.length);
  });

  it("links the first set even when it is empty, so the first token made is usable", async () => {
    // (Tailwind 3: the stylesheet sync stays; a repository with no tokens that isn't, starts with design tokens files: see pull-dtcg.test.ts.)
    const bare = { "package.json": '{"dependencies":{"react":"^19.0.0"},"devDependencies":{"tailwindcss":"^3.4.0"}}', "tailwind.config.js": "module.exports = { content: [] };\n", "src/Button.tsx": "export function Button() { return <button>Hi</button>; }\n" };
    await pullRepository(host(bare), connection);
    expect(sheetLink()!.setId).toBe(ds().sets[0].id);
  });
});

describe("a repository whose tokens are variables in its stylesheets, on a later pull", () => {
  const files = loadFixture("motif-test-system");
  const changedRepo = (to: string) => ({ ...files, [CSS]: files[CSS].replace("--primary: oklch(0.52 0.21 270);", `--primary: ${to};`) });
  const dtcgLink = () => git().tokenLink as Extract<NonNullable<ReturnType<typeof git>["tokenLink"]>, { format: "dtcg" }>;

  it("takes in what the stylesheets changed, and nothing else moves", async () => {
    await pullRepository(host(files), connection);
    const before = color("secondary").themeValues[light()];
    const out = await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    expect(out.conflicts).toBeNull();
    expect(color("primary").themeValues[light()]).toBe("oklch(0.6 0.2 30)");
    expect(color("secondary").themeValues[light()]).toBe(before);
    expect(out.notes.join(" ")).toMatch(/token change/);
    expect(dtcgLink().convert).toBeDefined();
  });

  it("asks about a value changed in both places", async () => {
    await pullRepository(host(files), connection);
    ds().setColorText(color("primary").id, light(), "#ff0000");
    const out = await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    expect(out.conflicts?.format).toBe("dtcg");
    expect(color("primary").themeValues[light()]).toBe("#ff0000");
    finishPull(out.conflicts!, [0]);
    expect(color("primary").themeValues[light()]).toBe("oklch(0.6 0.2 30)");
  });

  it("is up to date when nothing changed", async () => {
    await pullRepository(host(files), connection);
    const out = await pullRepository(host(files), connection);
    expect(out.conflicts).toBeNull();
    expect(out.notes).toEqual([]);
  });

  it("is a repository of design tokens files once the pull request that made them is merged", async () => {
    await pullRepository(host(files), connection);
    const virtual = dtcgLink().base;
    expect(Object.keys(virtual).length).toBeGreaterThan(1);
    const out = await pullRepository(host({ ...files, ...virtual }, "sha-2"), connection);
    expect(out.conflicts).toBeNull();
    expect(dtcgLink().convert).toBeUndefined();
    expect(color("primary").themeValues[light()]).toBe("oklch(0.52 0.21 270)");
  });

  it("keeps Tailwind 3 repositories on the stylesheet and the config", async () => {
    await pullRepository(host(loadFixture("motif-test-system-v3")), connection);
    expect(sheetLink()).not.toBeNull();
    expect(isDtcgLink(git().tokenLink)).toBe(false);
  });
});

describe("a project linked to the stylesheets before, on a later pull", () => {
  const files = loadFixture("motif-test-system");
  const changedRepo = (to: string) => ({ ...files, [CSS]: files[CSS].replace("--primary: oklch(0.52 0.21 270);", `--primary: ${to};`) });

  it("takes in what the repository changed, and nothing else moves", async () => {
    await linkedBefore(files);
    const before = color("secondary").themeValues[light()];
    const out = await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    expect(out.conflicts).toBeNull();
    expect(color("primary").themeValues[light()]).toBe("#de3e2d");
    expect(color("secondary").themeValues[light()]).toBe(before);
    expect(git().pulledSha).toBe("sha-2");
    expect(out.notes.join(" ")).toMatch(/token change/);
  });

  it("keeps a token changed here that the repository didn't change", async () => {
    await linkedBefore(files);
    ds().setColorText(color("secondary").id, light(), "#ff0000");
    await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    expect(color("secondary").themeValues[light()]).toBe("#ff0000");
    expect(color("primary").themeValues[light()]).toBe("#de3e2d");
  });

  it("asks about a value changed in both places, and takes nothing of the tokens until it is answered", async () => {
    await linkedBefore(files);
    ds().setColorText(color("primary").id, light(), "#ff0000");
    const out = await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    expect(out.conflicts?.plan.merge.conflicts.length).toBe(1);
    expect(color("primary").themeValues[light()]).toBe("#ff0000");
    // The person keeps the repository's value.
    finishPull(out.conflicts!, [0]);
    expect(color("primary").themeValues[light()]).toBe("#de3e2d");
  });

  it("keeps Motif's value when that is the choice, to be sent with the next push", async () => {
    await linkedBefore(files);
    ds().setColorText(color("primary").id, light(), "#ff0000");
    const out = await pullRepository(host(changedRepo("oklch(0.6 0.2 30)"), "sha-2"), connection);
    finishPull(out.conflicts!, []);
    expect(color("primary").themeValues[light()]).toBe("#ff0000");
  });

  it("is up to date when nothing changed", async () => {
    await linkedBefore(files);
    const out = await pullRepository(host(files), connection);
    expect(out.conflicts).toBeNull();
    expect(out.notes).toEqual([]);
  });
});

describe("a theme deleted here that the repository has", () => {
  const files = loadFixture("motif-test-system");
  const themeOf = (name: string) => ds().sets[0].themes.find((t) => t.name === name);

  it("comes back with the next pull, as a theme of the set that the repository's values go to, and the link maps it again", async () => {
    await linkedBefore(files);
    const dark = themeOf("Dark")!;
    const before = color("background").themeValues[dark.id];
    ds().deleteThemeFromSet(ds().sets[0].id, dark.id);
    expect(themeOf("Dark")).toBeUndefined();
    const out = await pullRepository(host(files, "sha-2"), connection);
    expect(out.conflicts).toBeNull();
    expect(out.notes.join(" ")).toMatch(/1 theme brought back: Dark/);
    const back = themeOf("Dark")!;
    expect(back).toBeDefined();
    expect(sheetLink()!.themes.dark).toBe(back.id);
    // The repository's own values, not a copy of the light theme's.
    expect(color("background").themeValues[back.id]).toBe(before);
    expect(color("background").themeValues[back.id]).not.toBe(color("background").themeValues[light()]);
  });

  it("is not left as values of a theme that isn't there, when the theme is not brought back", async () => {
    await linkedBefore(files);
    const dark = themeOf("Dark")!;
    ds().deleteThemeFromSet(ds().sets[0].id, dark.id);
    await pullRepository(host(files, "sha-2"), connection);
    const known = new Set(ds().sets[0].themes.map((t) => t.id));
    for (const c of ds().colors) for (const id of Object.keys(c.themeValues)) expect(known.has(id)).toBe(true);
  });

  it("changes nothing in the repository: the deleted theme's values are not sent as removed", async () => {
    await linkedBefore(files);
    const dark = themeOf("Dark")!;
    ds().deleteThemeFromSet(ds().sets[0].id, dark.id);
    const out = await pullRepository(host(files, "sha-2"), connection);
    expect(out.analysis.tokens.some((t) => t.name === "background")).toBe(true);
    // Nothing is waiting to be sent for it.
    const link = sheetLink()!;
    expect(link.staged ?? null).toBeNull();
  });
});
