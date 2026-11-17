import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitBlobSha, type GitHost, type RepoReader } from "../github";
import { fixture } from "../dtcg/fixture";
import { generateCss, HEADER } from "../dtcg/generate";
import { writeDtcg } from "../dtcg/write";
import type { DtcgLink } from "../dtcg/sync";
import type { StoredTokenData } from "../tokens/model";
import { useEditStore } from "../../store/edit";
import { emptyTokenData, snapshotTokens, useDesignSystemStore } from "../../store/design-system";
import { useGitStore } from "../../store/git";
import { useLibraryStore } from "../../store/library";
import { pullRepository } from "../pull";
import { setConvertOnPull } from "../dtcg/convert-flag";
import { toStored } from "../tokens/migrate";
import { overlayOf } from "./overlay";
import { dtcgSummary, stageDtcgTokens, waitingDtcgChanges } from "./dtcg-tokens";

const scope = "a/b@main";
const OPTS = { files: "per-set" as const, dir: "src/tokens", output: "src/styles/tokens.css", tailwind: true };
const PRIM = "src/tokens/primitives.json";
const CSS = "src/styles/tokens.css";

const repoOf = (initial: Record<string, string>) => {
  const files = { ...initial };
  const host = {
    listTree: async () => ({ paths: Object.keys(files), truncated: false }),
    readText: async (path: string) => files[path] ?? null,
    getFile: async (path: string) => (path in files ? { text: files[path], sha: await gitBlobSha(files[path]) } : null),
  } as unknown as GitHost & RepoReader;
  return { files, host };
};

// A repository that has what Motif wrote, linked to the tokens as they are.
function linked() {
  const model = fixture();
  const written = writeDtcg(model, OPTS).files;
  const repo = repoOf({ ...written, [CSS]: generateCss(written) });
  const link: DtcgLink = { format: "dtcg", repo: "a/b", branch: "main", ...OPTS, base: written, staged: null, syncedAt: 0 };
  return { repo, link, model };
}
const withColor = (m: StoredTokenData, id: string, theme: string, value: string): StoredTokenData => ({
  ...m, tokens: m.tokens.map((t) => (t.id === id ? { ...t, values: { ...t.values, [theme]: value }, ...(theme === "p-l" ? { value } : {}) } : t)),
});
const stage = (repo: ReturnType<typeof repoOf>, link: DtcgLink, model: StoredTokenData) =>
  stageDtcgTokens({ host: repo.host, link, model, overlay: overlayOf(useEditStore.getState()), scope });
const edits = () => { const s = useEditStore.getState(); return s.history[s.index].texts; };

describe("staging token changes when the tokens are design tokens files", () => {
  beforeEach(() => { useEditStore.setState({ scope: null }); useEditStore.getState().adopt(scope); });

  it("counts what is waiting without asking the repository, and stops once it is staged", async () => {
    const { repo, link, model } = linked();
    expect(waitingDtcgChanges(link, model)).toEqual([]);
    const edited = withColor(model, "g50", "p-l", "#ff0000");
    expect(waitingDtcgChanges(link, edited).map((c) => `${c.name} ${c.theme ?? "base"}`)).toEqual(["color.gray-50 base"]);
    const r = await stage(repo, link, edited);
    expect(r.attention).toBeNull();
    expect(r.staged).toBe(1);
    expect(waitingDtcgChanges(r.link, edited)).toEqual([]);
    expect(r.link.staged?.paths.sort()).toEqual([CSS, PRIM]);
  });

  it("writes the token and the stylesheet into the editor, not the repository", async () => {
    const { repo, link, model } = linked();
    const before = { ...repo.files };
    await stage(repo, link, withColor(model, "g50", "p-l", "#ff0000"));
    expect(repo.files).toEqual(before);
    expect(JSON.parse(edits()[PRIM]).color["gray-50"].$value.hex).toBe("#ff0000");
    expect(edits()[CSS]).toContain("--color-gray-50: #ff0000;");
    expect(edits()[CSS].startsWith(HEADER)).toBe(true);
    // Only what changed: the other tokens' text, and the other files, are as they were.
    expect(Object.keys(edits()).sort()).toEqual([CSS, PRIM]);
    expect(edits()[PRIM].includes('"g900"')).toBe(false);
  });

  it("is one step to undo, and a second sync builds on the first", async () => {
    const { repo, link, model } = linked();
    const first = await stage(repo, link, withColor(model, "g50", "p-l", "#ff0000"));
    const second = await stage(repo, first.link, withColor(withColor(model, "g50", "p-l", "#ff0000"), "g900", "p-l", "#00ff00"));
    expect(second.staged).toBe(1);
    expect(JSON.parse(edits()[PRIM]).color["gray-50"].$value.hex).toBe("#ff0000");
    expect(JSON.parse(edits()[PRIM]).color["gray-900"].$value.hex).toBe("#00ff00");
    useEditStore.getState().undo();
    expect(JSON.parse(edits()[PRIM]).color["gray-50"].$value.hex).toBe("#ff0000");
    expect(edits()[PRIM]).not.toContain("#00ff00");
  });

  it("puts a change of another theme in that theme's file", async () => {
    const { repo, link, model } = linked();
    await stage(repo, link, withColor(model, "g50", "p-d", "#222222"));
    expect(JSON.parse(edits()["src/tokens/primitives.dark.json"]).color["gray-50"].$value.hex).toBe("#222222");
    expect(Object.keys(edits())).not.toContain(PRIM);
  });

  it("has nothing to stage when the tokens are as the files say", async () => {
    const { repo, link, model } = linked();
    const r = await stage(repo, link, model);
    expect(r.staged).toBe(0);
    expect(Object.keys(edits())).toEqual([]);
  });

  it("holds off when the repository has token changes Motif hasn't taken, and says so", async () => {
    const { repo, link, model } = linked();
    const tree = JSON.parse(repo.files[PRIM]);
    tree.color["gray-900"].$value = { colorSpace: "srgb", components: [0, 0, 1], hex: "#0000ff" };
    repo.files[PRIM] = JSON.stringify(tree, null, 2);
    const r = await stage(repo, link, withColor(model, "g50", "p-l", "#ff0000"));
    expect(r.staged).toBe(0);
    expect(r.attention).toMatch(/Pull to bring them in/);
    expect(Object.keys(edits())).toEqual([]);
  });

  it("leaves a stylesheet that isn't one Motif's build writes, and says so", async () => {
    const { repo, link, model } = linked();
    repo.files[CSS] = ":root { --color-gray-50: #f9fafb; }\n";
    const r = await stage(repo, link, withColor(model, "g50", "p-l", "#ff0000"));
    expect(r.staged).toBe(1);
    expect(r.attention).toMatch(/isn't a file Motif's build writes/);
    expect(Object.keys(edits())).toEqual([PRIM]);
  });

  it("says when the files aren't in the repository any more", async () => {
    const { link, model } = linked();
    const r = await stage(repoOf({ "README.md": "x" }), link, withColor(model, "g50", "p-l", "#ff0000"));
    expect(r.staged).toBe(0);
    expect(r.attention).toMatch(/aren't in the repository/);
  });

  it("builds on a pull request that is already open: the editor's files are what is planned against", async () => {
    const { repo, link, model } = linked();
    const first = await stage(repo, link, withColor(model, "g50", "p-l", "#ff0000"));
    // The stylesheet is already regenerated in the editor, so it is changed once more, not written afresh.
    const again = await stage(repo, first.link, withColor(withColor(model, "g50", "p-l", "#ff0000"), "brand", "p-l", "#00ff00"));
    expect(again.link.staged?.paths).toEqual(expect.arrayContaining([PRIM, CSS]));
    expect(edits()[CSS]).toContain("--color-gray-50: #ff0000;");
    expect(edits()[CSS]).toContain("--color-brand: #00ff00;");
  });
});

describe("what the pull request says", () => {
  it("lists the token changes under the first line", () => {
    const text = dtcgSummary([{ name: "color.brand", theme: "dark", type: "changed", before: "#fff", after: "#000" }, { name: "ratio", theme: null, type: "added", after: "2" }], ["Not changed: `x`"]);
    expect(text.split("\n")).toEqual(["Update 2 design tokens from Motif", "`color.brand` (dark): `#fff` → `#000`", "`ratio`: `2`", "Not changed: `x`"]);
  });
});

describe("the first push of a repository that has no tokens", () => {
  beforeEach(() => { useEditStore.setState({ scope: null }); useEditStore.getState().adopt(scope); });
  const empty = () => repoOf({ "package.json": '{"name":"app","dependencies":{"react":"^19.0.0"}}', "src/Button.tsx": "export function Button() { return <button>Hi</button>; }\n" });
  const awaiting = (): DtcgLink => ({ format: "dtcg", repo: "a/b", branch: "main", dir: "src/tokens", files: "single", output: "src/styles/tokens.css", tailwind: false, base: {}, staged: null, syncedAt: 0 });

  it("counts every token of every set as waiting", () => {
    const waiting = waitingDtcgChanges(awaiting(), fixture());
    expect(waiting.length).toBeGreaterThan(10);
    expect(waiting.every((c) => c.type === "added")).toBe(true);
  });

  it("puts the files, the stylesheet, the build and package.json in the editor as one step", async () => {
    const repo = empty();
    const r = await stage(repo, awaiting(), fixture());
    expect(r.staged).toBeGreaterThan(10);
    expect(Object.keys(edits()).sort()).toEqual(["package.json", "src/styles/tokens.css", "src/tokens/tokens.config.json", "src/tokens/tokens.dark.json", "src/tokens/tokens.json", "style-dictionary.config.mjs"]);
    expect(JSON.parse(edits()["package.json"]).scripts["tokens:build"]).toBe("node style-dictionary.config.mjs");
    expect(edits()["src/styles/tokens.css"]).toContain("--color-brand: oklch(0.6 0.2 260);");
    // The repository is untouched, and it is one undo.
    expect(Object.keys(repo.files).sort()).toEqual(["package.json", "src/Button.tsx"]);
    useEditStore.getState().undo();
    expect(Object.keys(edits())).toEqual([]);
  });

  it("moves the link on to what was written, with its base still empty until the pull request is merged", async () => {
    const r = await stage(empty(), awaiting(), fixture());
    expect(r.link).toMatchObject({ dir: "src/tokens", files: "single", output: "src/styles/tokens.css", base: {} });
    expect(r.link.staged!.paths).toContain("src/tokens/tokens.json");
    expect(Object.keys(r.link.staged!.files)).toContain("src/tokens/tokens.config.json");
    expect(waitingDtcgChanges(r.link, fixture())).toEqual([]);
  });

  it("builds on itself: a token changed after is a change to the files that are in the pull request", async () => {
    const repo = empty();
    const first = await stage(repo, awaiting(), fixture());
    const second = await stage(repo, first.link, withColor(fixture(), "g50", "p-l", "#ff0000"));
    expect(second.staged).toBe(1);
    expect(second.attention).toBeNull();
    expect(edits()["src/styles/tokens.css"]).toContain("--color-gray-50: #ff0000;");
    expect(JSON.parse(edits()["src/tokens/tokens.json"]).color["gray-50"].$value.hex).toBe("#ff0000");
  });

  it("has nothing to add for a project with no tokens", async () => {
    const r = await stage(empty(), awaiting(), { ...fixture(), tokens: [], compositions: [] });
    expect(r.staged).toBe(0);
    expect(Object.keys(edits())).toEqual([]);
  });
});

// ── Tokens that are variables in the repository's stylesheets ─────────────────

const APP_CSS = `@import "tailwindcss";

:root {
  --radius: 0.5rem;
  --background: oklch(1 0 0);
  --primary: oklch(0.205 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-primary: var(--primary);
}

@theme {
  --color-brand: #4f46e5;
}

body { background: var(--background); }
`;

describe("the first push of a repository whose tokens are variables in its stylesheets", () => {
  const files = { "package.json": '{"name":"x","devDependencies":{"tailwindcss":"^4.0.0"},"dependencies":{"react":"^19.0.0"}}', "src/app.css": APP_CSS, "src/index.tsx": "export {};\n" };
  const connection = { owner: "a", repo: "b", token: "t", defaultBranch: "main" };

  async function pulled() {
    const repo = repoOf(files);
    const host = { ...repo.host, getRef: async () => "sha-1" } as unknown as GitHost & RepoReader;
    useDesignSystemStore.setState({ ...emptyTokenData() });
    useLibraryStore.getState().clear();
    useGitStore.getState().load({ connection, analysis: null, tokenLink: null, work: null, pulledSha: null });
    await pullRepository(host, connection);
    const link = useGitStore.getState().tokenLink as DtcgLink;
    return { repo: { ...repo, host }, link, model: toStored(snapshotTokens(useDesignSystemStore.getState())) };
  }

  beforeEach(() => { setConvertOnPull(true); useEditStore.setState({ scope: null }); useEditStore.getState().adopt(scope); });
  afterEach(() => setConvertOnPull(null));

  it("has nothing waiting yet (the conversion goes with the first push), and the pull wrote nothing to the repository", async () => {
    const { repo, link, model } = await pulled();
    expect(link.convert?.converted).toEqual(expect.arrayContaining(["radius", "background", "primary", "color-brand"]));
    expect(repo.files["src/app.css"]).toBe(APP_CSS);
    expect(waitingDtcgChanges(link, model)).toEqual([]);
  });

  it("puts the files, the generated stylesheet and the edited stylesheet in the editor as one step, with the check in its lines", async () => {
    const { repo, link, model } = await pulled();
    const r = await stage(repo, link, model);
    expect(r.attention).toBeNull();
    const e = edits();
    expect(Object.keys(e).sort()).toEqual(expect.arrayContaining(["package.json", "src/app.css", "src/tokens/tokens.config.json", "src/tokens/tokens.json", "src/tokens/tokens.dark.json", "src/tokens.css", "style-dictionary.config.mjs"].sort()));
    // The variables are generated now, with the names they had; the aliases Tailwind reads and the rules stay.
    expect(e["src/tokens.css"]).toContain("--primary: oklch(0.205 0 0);");
    expect(e["src/tokens.css"]).toMatch(/\.dark \{[^}]*--background: oklch\(0\.145 0 0\);/);
    expect(e["src/app.css"]).toContain('@import "tailwindcss";\n@import "./tokens.css";');
    expect(e["src/app.css"]).not.toContain("--primary: oklch");
    expect(e["src/app.css"]).toContain("--color-primary: var(--primary);");
    expect(e["src/app.css"]).toContain("body { background: var(--background); }");
    const step = useEditStore.getState().history[useEditStore.getState().index].summary ?? "";
    expect(step).toMatch(/Move \d+ design tokens? from the stylesheets into design tokens files/);
    expect(step).toMatch(/Check: \d+ variables, all identical/);
    // The link is what a merged pull request will make real.
    expect(r.link.staged?.paths).toContain("src/app.css");
    expect(r.link.convert).toBeDefined();
    expect(waitingDtcgChanges(r.link, model)).toEqual([]);
  });

  it("holds off when the stylesheets changed since they were pulled", async () => {
    const { repo, link, model } = await pulled();
    repo.files["src/app.css"] = APP_CSS.replace("oklch(0.205 0 0)", "oklch(0.3 0 0)");
    const r = await stage(repo, link, model);
    expect(r.staged).toBe(0);
    expect(r.attention).toMatch(/changed since they were pulled/);
    expect(edits()).toEqual({});
  });

  it("builds on itself: a token changed after goes into the files that are in the pull request", async () => {
    const { repo, link, model } = await pulled();
    const first = await stage(repo, link, model);
    const primary = model.tokens.find((t) => t.name === "primary")!;
    const second = await stage(repo, first.link, { ...model, tokens: model.tokens.map((t) => (t.id === primary.id ? { ...t, values: Object.fromEntries(Object.keys(t.values).map((k) => [k, "#ff0000"])), value: "#ff0000" } : t)) });
    expect(second.staged).toBe(1);
    expect(edits()["src/tokens.css"]).toContain("--primary: #ff0000;");
    expect(edits()["src/app.css"]).not.toContain("--primary: oklch");
  });
});
