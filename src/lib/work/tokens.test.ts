import { beforeEach, describe, expect, it } from "vitest";
import { gitBlobSha, type GitHost, type RepoReader } from "../github";
import { loadFixture } from "../repo-scan/fixtures";
import { applyDoc, type SyncDoc, type TokenSlices } from "../token-sync/doc";
import { readRepoState, type TokenLink } from "../token-sync/flow";
import { useEditStore } from "../../store/edit";
import { overlayOf } from "./overlay";
import { advanceLink, changedTokenNames, stageTokens, waitingTokenChanges } from "./tokens";

const CSS = "src/styles/motif.css";
const empty: TokenSlices = { colors: [], spacing: [], radii: [], shadows: [] };
const themes = { light: "t-light", dark: "t-dark" };
const scope = "a/b@main";
const set = { id: "set-1", themes: [{ id: "t-light", name: "Light" }, { id: "t-dark", name: "Dark" }] };

const repoOf = (initial: Record<string, string>) => {
  const files = { ...initial };
  const host = {
    listTree: async () => ({ paths: Object.keys(files), truncated: false }),
    readText: async (path: string) => files[path] ?? null,
    getFile: async (path: string) => (path in files ? { text: files[path], sha: await gitBlobSha(files[path]) } : null),
  } as unknown as GitHost & RepoReader;
  return { files, host };
};

const setColor = (s: TokenSlices, name: string, themeId: string, value: string): TokenSlices => ({
  ...s,
  colors: s.colors.map((c) => (c.name === name ? { ...c, themeValues: { ...c.themeValues, [themeId]: value } } : c)),
});

async function linked() {
  const repo = repoOf(loadFixture("motif-test-system"));
  const state = await readRepoState(repo.host, "a/b", "main");
  const link: TokenLink = { repo: "a/b", branch: "main", setId: "set-1", themes, baseTheme: "light", base: state.snapshot.doc, staged: null, syncedAt: 0 };
  return { repo, link, slices: applyDoc(empty, link, state.snapshot.doc, "t-light") };
}

const stage = (repo: ReturnType<typeof repoOf>, link: TokenLink, slices: TokenSlices) =>
  stageTokens({ host: repo.host, link, slices, set, overlay: overlayOf(useEditStore.getState()), scope });

describe("staging token changes among the editor's changes", () => {
  beforeEach(() => { useEditStore.setState({ scope: null }); useEditStore.getState().adopt(scope); });

  it("counts what is waiting without asking the repository, and stops once it is staged", async () => {
    const { repo, link, slices } = await linked();
    expect(waitingTokenChanges(link, slices)).toEqual([]);
    const edited = setColor(slices, "primary", "t-light", "#ff0000");
    expect(waitingTokenChanges(link, edited).map((c) => `${c.name} ${c.theme}`)).toEqual(["primary light"]);

    const r = await stage(repo, link, edited);
    expect(r.attention).toBeNull();
    expect(r.staged).toBe(1);
    expect(waitingTokenChanges(r.link, edited)).toEqual([]);
    expect(r.link.staged?.paths).toEqual([CSS]);
  });

  it("changes the stylesheet in the editor, not the repository, as one step to undo", async () => {
    const { repo, link, slices } = await linked();
    const before = repo.files[CSS];
    await stage(repo, link, setColor(slices, "primary", "t-light", "#ff0000"));
    const edit = useEditStore.getState();
    expect(repo.files[CSS]).toBe(before);
    expect(edit.history[edit.index].texts[CSS]).not.toBe(before);
    expect(edit.history[edit.index].texts[CSS]).not.toContain("--primary: oklch(0.52 0.21 270)");
    expect(edit.bases[CSS].text).toBe(before);
    expect(edit.history).toHaveLength(2);
    expect(edit.history[1].summary.split("\n")[0]).toBe("Update 1 design token from Motif");
    edit.undo();
    expect(overlayOf(useEditStore.getState()).texts).toEqual({});
  });

  it("stages the next edit on top of the first, and doesn't stage the same thing twice", async () => {
    const { repo, link, slices } = await linked();
    const one = setColor(slices, "primary", "t-light", "#ff0000");
    const first = await stage(repo, link, one);
    const again = await stage(repo, first.link, one);
    expect(again.staged).toBe(0);
    expect(useEditStore.getState().history).toHaveLength(2);

    const two = { ...one, radii: one.radii.map((r) => (r.name === "radius-md" ? { ...r, value: 10 } : r)) };
    const second = await stage(repo, first.link, two);
    expect(second.staged).toBe(1);
    const text = useEditStore.getState().history[useEditStore.getState().index].texts[CSS];
    expect(text).not.toContain("--primary: oklch(0.52 0.21 270)");
    expect(text).toMatch(/--radius-md:\s*0\.625rem/);
    expect(useEditStore.getState().history).toHaveLength(3);
  });

  it("a value changed back is the repository's own text again, so the file isn't a change at all", async () => {
    const { repo, link, slices } = await linked();
    const first = await stage(repo, link, setColor(slices, "primary", "t-light", "#ff0000"));
    const back = await stage(repo, first.link, slices);
    expect(back.staged).toBe(1);
    expect(overlayOf(useEditStore.getState()).texts).toEqual({});
  });

  it("stages nothing, and says why, when the repository has token changes Motif hasn't taken", async () => {
    const { repo, link, slices } = await linked();
    repo.files[CSS] = repo.files[CSS].replace(/--primary:\s*[^;]+;/, "--primary: #00ff00;");
    const r = await stage(repo, link, setColor(slices, "primary", "t-dark", "#123456"));
    expect(r.staged).toBe(0);
    expect(r.attention).toMatch(/Open Tokens/);
    expect(overlayOf(useEditStore.getState()).texts).toEqual({});
  });

  it("makes the stylesheet when the repository has no tokens, and later edits go into it", async () => {
    const repo = repoOf({ "README.md": "# new" });
    const colors = [{ id: "c", name: "Primary", value: "#3366ff", group: "base", setId: "set-1", themeValues: { "t-light": "#3366ff", "t-dark": "#6699ff" } }];
    const link: TokenLink = { repo: "a/b", branch: "main", setId: "set-1", themes, baseTheme: "light", base: {}, staged: null, syncedAt: 0 };
    const slices: TokenSlices = { ...empty, colors };
    const first = await stage(repo, link, slices);
    expect(first.staged).toBeGreaterThan(0);
    const created = Object.keys(overlayOf(useEditStore.getState()).texts);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/tokens\.css$/);
    expect(useEditStore.getState().bases[created[0]].sha).toBeNull();

    // Edited afterwards, the same file is changed, not another one made.
    const edited = setColor(slices, "Primary", "t-light", "#ff0000");
    await stage(repo, first.link, edited);
    expect(Object.keys(overlayOf(useEditStore.getState()).texts)).toEqual(created);
    expect(overlayOf(useEditStore.getState()).texts[created[0]]).toContain("#ff0000");
  });
});

describe("after the pull request is merged", () => {
  const tok = (v: string): SyncDoc[string] => ({ kind: "color", values: { light: v } });

  it("finds the tokens the pull request changed, and nothing else", () => {
    const base: SyncDoc = { a: tok("#111111"), b: tok("#222222") };
    expect(changedTokenNames({ a: tok("#111111"), b: tok("#333333"), c: tok("#444444") }, base)).toEqual(["b", "c"]);
  });

  it("moves only those tokens to what the repository now has, so its own changes still show as coming from it", () => {
    const link: TokenLink = { repo: "a/b", branch: "main", setId: "s", themes, baseTheme: "light", base: { a: tok("#111111"), b: tok("#222222") }, staged: { doc: {}, paths: ["x.css"] }, syncedAt: 1 };
    // The repository now has b as merged, and a as someone else changed it.
    const next = advanceLink(link, ["b"], { a: tok("#999999"), b: tok("#333333") }, 5);
    expect(next.base.b).toEqual(tok("#333333"));
    expect(next.base.a).toEqual(tok("#111111"));
    expect(next.staged).toBeNull();
    expect(next.syncedAt).toBe(5);
  });
});
