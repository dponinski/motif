import { describe, expect, it } from "vitest";
import type { RepoReader } from "../github";
import { loadFixture } from "../repo-scan/fixtures";
import { applyDoc, type TokenSlices } from "./doc";
import { addImport, applyMerged, newTokensPath, planExport, planSync, readRepoState, relativeImport, type RepoState, type TokenLink } from "./flow";
import { resolveTokenMerge } from "./merge";
import { applyEdits, filesNeeded } from "./write";

const CSS = "src/styles/motif.css";
const empty: TokenSlices = { colors: [], spacing: [], radii: [], shadows: [] };

function repoOf(initial: Record<string, string>) {
  const files = { ...initial };
  const reader: RepoReader = {
    listTree: async () => ({ paths: Object.keys(files), truncated: false }),
    readText: async (path) => files[path] ?? null,
  };
  return { files, reader, read: () => readRepoState(reader, "a/b", "main") };
}

// What the app does when a pull request is created, merged, and the repository read again.
async function mergeTokenPr(repo: ReturnType<typeof repoOf>, state: RepoState, changes: Parameters<typeof applyEdits>[3]) {
  const inputs = Object.fromEntries(filesNeeded(state.analysis).map((p) => [p, repo.files[p]]));
  const result = await applyEdits(inputs, state.analysis, state.snapshot, changes);
  Object.assign(repo.files, result.files);
  return result;
}

const themes = { light: "t-light", dark: "t-dark" };
const setColor = (s: TokenSlices, name: string, themeId: string, value: string): TokenSlices => ({
  ...s,
  colors: s.colors.map((c) => (c.name === name ? { ...c, themeValues: { ...c.themeValues, [themeId]: value } } : c)),
});

async function linked(): Promise<{ repo: ReturnType<typeof repoOf>; link: TokenLink; slices: TokenSlices; state: RepoState }> {
  const repo = repoOf(loadFixture("motif-test-system"));
  const state = await repo.read();
  const link: TokenLink = { repo: "a/b", branch: "main", setId: "set-1", themes, baseTheme: "light", base: state.snapshot.doc, pending: null, syncedAt: 0 };
  return { repo, link, slices: applyDoc(empty, link, state.snapshot.doc, "t-light"), state };
}

describe("a freshly imported set", () => {
  it("is in sync with the repository, with nothing to do either way", async () => {
    const { link, slices, state } = await linked();
    const plan = planSync(link, slices, state);
    expect(plan.merge.conflicts).toEqual([]);
    expect(plan.toMotif).toEqual([]);
    expect(plan.toRepo).toEqual([]);
    expect(slices.colors).toHaveLength(17);
  });
});

describe("pushing edits made in Motif", () => {
  it("writes them to the stylesheet, and once merged the two sides agree exactly", async () => {
    const { repo, link, slices: imported, state } = await linked();
    let slices = setColor(imported, "primary", "t-light", "#ff0000");
    slices = {
      ...slices,
      radii: slices.radii.map((r) => (r.name === "radius-md" ? { ...r, value: 10 } : r)),
      colors: [...slices.colors, { id: "n", name: "Brand Blue", value: "#112233", group: "base", setId: "set-1", themeValues: { "t-light": "#112233", "t-dark": "#aabbcc" } }],
    };

    const plan = planSync(link, slices, state);
    expect(plan.merge.conflicts).toEqual([]);
    expect(plan.toMotif).toEqual([]);
    expect(plan.toRepo.map((c) => `${c.name} ${c.theme} ${c.type}`)).toEqual(["primary light changed", "radius-md light changed", "brand-blue light added", "brand-blue dark added"]);

    const before = repo.files[CSS];
    const result = await mergeTokenPr(repo, state, plan.toRepo);
    expect(result.skipped).toEqual([]);
    expect(Object.keys(result.files)).toEqual([CSS]);
    expect(repo.files[CSS]).not.toBe(before);

    // The pull request is merged; the next sync finds nothing left to do and no false conflicts.
    const after = await repo.read();
    const next = planSync(link, slices, after);
    expect(next.merge.conflicts).toEqual([]);
    expect(next.toMotif).toEqual([]);
    expect(next.toRepo).toEqual([]);
    expect(after.analysis.tokens.find((t) => t.name === "brand-blue")!.tailwind).toBe("color-brand-blue");
  });

  it("keeps showing the changes as pending until the pull request is merged", async () => {
    const { link, slices: imported, state } = await linked();
    const slices = setColor(imported, "primary", "t-light", "#ff0000");
    expect(planSync(link, slices, state).toRepo).toHaveLength(1);
    expect(planSync({ ...link, pending: { number: 3, url: "u", branch: "b" } }, slices, state).toRepo).toHaveLength(1);
  });
});

describe("pulling edits made in the repository", () => {
  it("brings them into Motif while Motif's own edits stay pending", async () => {
    const { repo, link, slices: imported, state } = await linked();
    // Someone edits the repository: a radius, and a dark-theme color.
    repo.files[CSS] = repo.files[CSS].replace("--radius-lg: 0.75rem;", "--radius-lg: 1rem;").replace("--background: oklch(0.17 0.015 265);", "--background: oklch(0.2 0.015 265);");
    const slices = setColor(imported, "success", "t-light", "#00ff00");
    const theirs = await repo.read();

    const plan = planSync(link, slices, theirs);
    expect(plan.merge.conflicts).toEqual([]);
    expect(plan.toMotif.map((c) => `${c.name} ${c.theme}`)).toEqual(["background dark", "radius-lg light"]);
    expect(plan.toRepo.map((c) => `${c.name} ${c.theme}`)).toEqual(["success light"]);

    const applied = applyMerged(link, slices, plan.merge.merged, theirs, "t-light");
    expect(applied.slices.radii.find((r) => r.name === "radius-lg")!.value).toBe(16);
    expect(applied.slices.colors.find((c) => c.name === "success")!.themeValues["t-light"]).toBe("#00ff00");
    // After applying, only Motif's own edit is left to send.
    const again = planSync(applied.link, applied.slices, theirs);
    expect(again.toMotif).toEqual([]);
    expect(again.toRepo.map((c) => c.name)).toEqual(["success"]);
  });

  it("applies a token removed from the repository, and restores one removed in Motif", async () => {
    const { repo, link, slices, state } = await linked();
    repo.files[CSS] = repo.files[CSS].split("\n").filter((l) => !/^\s*--ring:/.test(l)).join("\n");
    const theirs = await repo.read();
    expect(theirs.snapshot.doc.ring).toBeUndefined();

    const withoutBorder = { ...slices, colors: slices.colors.filter((c) => c.name !== "border") };
    const plan = planSync(link, withoutBorder, theirs);
    expect(plan.merge.restored).toEqual(["border"]);
    expect(plan.merge.conflicts).toEqual([]);
    const applied = applyMerged(link, withoutBorder, plan.merge.merged, theirs, "t-light");
    expect(applied.slices.colors.some((c) => c.name === "ring")).toBe(false);
    expect(applied.slices.colors.some((c) => c.name === "border")).toBe(true);
    // Nothing is ever deleted from the repository by a sync.
    expect(plan.toRepo).toEqual([]);
  });
});

describe("both sides editing the same value", () => {
  it("raises a conflict, and either choice leaves the two sides consistent", async () => {
    const { repo, link, slices: imported, state } = await linked();
    repo.files[CSS] = repo.files[CSS].replace("--primary: oklch(0.52 0.21 270);", "--primary: oklch(0.6 0.2 200);");
    const slices = setColor(imported, "primary", "t-light", "#ff0000");
    const theirs = await repo.read();
    const plan = planSync(link, slices, theirs);
    expect(plan.merge.conflicts.map((c) => c.label)).toEqual(["primary · light"]);

    // Take the repository's value.
    const takeTheirs = resolveTokenMerge(plan.merge, [0]);
    const applied = applyMerged(link, slices, takeTheirs, theirs, "t-light");
    const settled = planSync(applied.link, applied.slices, theirs);
    expect(settled.merge.conflicts).toEqual([]);
    expect(settled.toRepo).toEqual([]);

    // Keep Motif's value: it is then sent to the repository, and the sides agree after the merge.
    const keepMine = resolveTokenMerge(plan.merge, []);
    const kept = applyMerged(link, slices, keepMine, theirs, "t-light");
    const pending = planSync(kept.link, kept.slices, theirs);
    expect(pending.toRepo.map((c) => `${c.name} ${c.theme}`)).toEqual(["primary light"]);
    await mergeTokenPr(repo, theirs, pending.toRepo);
    const done = planSync(kept.link, kept.slices, await repo.read());
    expect(done.merge.conflicts).toEqual([]);
    expect(done.toRepo).toEqual([]);
    expect(done.toMotif).toEqual([]);
  });
});

describe("a repository with no tokens", () => {
  const bare = (extra: Record<string, string> = {}) => repoOf({
    "package.json": JSON.stringify({ dependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" } }),
    "src/index.css": '@import "tailwindcss";\n\nbody { margin: 0; }\n',
    ...extra,
  });

  const set = { id: "set-9", themes: [{ id: "th-1", name: "Light" }, { id: "th-2", name: "Dark" }] };
  const slices: TokenSlices = {
    colors: [{ id: "c", name: "Primary", value: "#4f46e5", group: "g", setId: "set-9", themeValues: { "th-1": "#4f46e5", "th-2": "#818cf8" } }],
    radii: [{ id: "r", name: "radius-md", value: 8, setId: "set-9" }],
    spacing: [], shadows: [],
  };

  it("plans a tokens file, imports it from the Tailwind stylesheet, and reads back as the same tokens", async () => {
    const repo = bare();
    const state = await repo.read();
    expect(state.snapshot.doc).toEqual({});

    const plan = await planExport(
      { getFile: async (path) => (repo.files[path] === undefined ? null : { text: repo.files[path], sha: "sha-" + path }) },
      state, "main", set, slices
    );
    expect(plan.tokensPath).toBe("src/tokens.css");
    expect(plan.imported).toBe(true);
    expect(Object.keys(plan.files)).toEqual(["src/tokens.css", "src/index.css"]);
    expect(plan.files["src/index.css"]).toEqual({ text: '@import "tailwindcss";\n@import "./tokens.css";\n\nbody { margin: 0; }\n', sha: "sha-src/index.css" });
    expect(plan.files["src/tokens.css"].sha).toBeNull();
    expect(plan.link).toMatchObject({ setId: "set-9", themes: { light: "th-1", dark: "th-2" }, baseTheme: "light" });
    expect(Object.keys(plan.doc)).toEqual(["primary", "radius-md"]);

    // After the pull request merges, the repository's tokens are exactly Motif's: nothing to sync.
    for (const [path, file] of Object.entries(plan.files)) repo.files[path] = file.text;
    const after = await repo.read();
    const link: TokenLink = { ...plan.link, repo: "a/b", branch: "main", base: {}, pending: null, syncedAt: 0 };
    const next = planSync(link, slices, after);
    expect(next.merge.conflicts).toEqual([]);
    expect(next.toMotif).toEqual([]);
    expect(next.toRepo).toEqual([]);
  });

  it("leaves out colors it cannot write and says so", async () => {
    const repo = bare();
    const plan = await planExport({ getFile: async () => null }, await repo.read(), "main", set, {
      ...slices,
      colors: [...slices.colors, { id: "x", name: "Odd", value: "red", group: "g", setId: "set-9", themeValues: { "th-1": "red", "th-2": "red" } }],
    });
    expect(Object.keys(plan.doc)).toEqual(["primary", "radius-md"]);
    expect(plan.skipped).toEqual([{ name: "odd", reason: "Its color isn't a hex value Motif can write" }]);
  });

  it("without Tailwind, writes plain variables and does not touch other files", async () => {
    const repo = repoOf({ "package.json": JSON.stringify({ dependencies: { react: "^18" } }), "src/app.css": "body { margin: 0; }\n" });
    const plan = await planExport({ getFile: async () => null }, await repo.read(), "main", set, slices);
    expect(Object.keys(plan.files)).toEqual(["src/tokens.css"]);
    expect(plan.files["src/tokens.css"].text).not.toContain("@theme");
    expect(plan.imported).toBe(false);
  });
});

describe("paths and imports", () => {
  it("computes relative import paths", () => {
    expect(relativeImport("src/index.css", "src/tokens.css")).toBe("./tokens.css");
    expect(relativeImport("src/app/globals.css", "src/styles/tokens.css")).toBe("../styles/tokens.css");
    expect(relativeImport("globals.css", "styles/tokens.css")).toBe("./styles/tokens.css");
  });

  it("adds the import once, right after Tailwind's", () => {
    const css = '@import "tailwindcss";\n@plugin "x";\n';
    const once = addImport(css, "./tokens.css")!;
    expect(once).toBe('@import "tailwindcss";\n@import "./tokens.css";\n@plugin "x";\n');
    expect(addImport(once, "./tokens.css")).toBe(once);
    expect(addImport("body {}", "./tokens.css")).toBeNull();
  });

  it("puts the file next to the stylesheets, and avoids a name that is taken", () => {
    const base = { stack: { entryFiles: [] }, styleFiles: [], tailwindEntry: null } as unknown as Parameters<typeof newTokensPath>[0];
    expect(newTokensPath({ ...base, styleFiles: ["src/styles/a.css"] })).toBe("src/styles/tokens.css");
    expect(newTokensPath({ ...base, styleFiles: ["src/styles/tokens.css"] })).toBe("src/styles/motif-tokens.css");
    expect(newTokensPath({ ...base, tailwindEntry: "app/globals.css", styleFiles: ["app/globals.css"] })).toBe("app/tokens.css");
    expect(newTokensPath({ ...base, stack: { entryFiles: ["src/index.ts"] } as never })).toBe("src/styles/tokens.css");
    expect(newTokensPath(base)).toBe("styles/tokens.css");
  });
});
