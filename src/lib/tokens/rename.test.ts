import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import type { RepoToken } from "../repo-scan/types";
import { applyDoc, readMotifTokens, readRepoTokens, type LinkShape } from "../token-sync/doc";
import { changesToRepo, mergeTokens } from "../token-sync/merge";
import { namesFor, planRename } from "./rename";

const FILES = loadFixture("motif-test-system");
const scan = (files: Record<string, string>) => scanRepository(memorySource(files), { repo: "a/b", ref: "main" });
const before = await scan(FILES);
const tokenNamed = (name: string, a = before) => a.tokens.find((t) => t.name === name)!;

const token = (name: string, kind: RepoToken["kind"], tailwind: string | null, container: "css-var" | "theme" | "config" = "css-var"): RepoToken => ({
  name, kind, values: { default: "x" }, tailwind, file: "a.css", line: 1, locations: { default: { file: "a.css", line: 1, container } },
});

describe("what a name has to be", () => {
  const tokens = [token("primary", "color", "color-primary"), token("color-accent", "color", "color-accent", "theme"), token("radius-md", "radius", "radius-md", "theme"), token("surface", "color", "color-surface"), token("ink", "color", null)];
  it("a variable Tailwind is given under another name: any name", () => {
    const n = namesFor(tokens[0], "brand", tokens);
    expect(n).toMatchObject({ to: "brand", tailwindFrom: "color-primary", tailwindTo: "color-brand", classFrom: "primary", classTo: "brand", mapped: true });
  });
  it("a token that is Tailwind's as written keeps what makes it a color", () => {
    expect(namesFor(tokens[1], "color-brand", tokens)).toMatchObject({ classFrom: "accent", classTo: "brand", mapped: false });
    expect(namesFor(tokens[1], "brand", tokens)).toMatch(/start with color-/);
    expect(namesFor(tokens[2], "radius-card", tokens)).toMatchObject({ classTo: "card" });
    expect(namesFor(tokens[2], "card", tokens)).toMatch(/start with radius-/);
  });
  it("a stylesheet's token has no classes to rename", () => {
    expect(namesFor(tokens[4], "paper", tokens)).toMatchObject({ classFrom: null, mapped: false });
  });
  it("refuses a name that is taken, not a name, the same, or a source Motif can't write", () => {
    expect(namesFor(tokens[0], "surface", tokens)).toMatch(/already has that name/);
    expect(namesFor(tokens[0], "1brand", tokens)).toMatch(/letters/);
    expect(namesFor(tokens[0], "primary", tokens)).toMatch(/already/);
    expect(namesFor(token("x", "color", null, "config"), "y", [])).toMatch(/config/);
    expect(namesFor(token("f", "font", null), "g", [])).toMatch(/Only colors/);
  });
});

describe("renaming in text", () => {
  const tokens = [token("primary", "color", "color-primary"), token("primary-foreground", "color", "color-primary-foreground")];
  const run = (files: Record<string, string>, to = "brand") => planRename({ token: tokens[0], to, tokens, files });

  it("declarations in every theme, the mapping, var() and @apply in a stylesheet", async () => {
    const css = `:root { --primary: red; --primary-foreground: white; }\n.dark { --primary: blue; }\n@theme inline { --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground); }\n.a { color: var(--primary); background: var(--color-primary); @apply bg-primary text-primary-foreground hover:bg-primary/90; }\n`;
    const plan = await run({ "a.css": css });
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.files["a.css"]).toBe(`:root { --brand: red; --primary-foreground: white; }\n.dark { --brand: blue; }\n@theme inline { --color-brand: var(--brand); --color-primary-foreground: var(--primary-foreground); }\n.a { color: var(--brand); background: var(--color-brand); @apply bg-brand text-primary-foreground hover:bg-brand/90; }\n`);
  });
  it("classes with modifiers, opacity, signs and in any kind of text, but not another token that starts the same", async () => {
    const tsx = `export const A = () => <div className={cn("bg-primary hover:bg-primary/90 !text-primary", cond && 'ring-primary', \`border-primary \${x}\`)} style={{ color: "var(--primary)", "--primary": 1 }}>don't use bg-primary-foreground or primary alone</div>;`;
    const plan = await run({ "A.tsx": tsx });
    if ("refused" in plan) throw new Error(plan.refused);
    const out = plan.files["A.tsx"];
    expect(out).toContain('"bg-brand hover:bg-brand/90 !text-brand"');
    expect(out).toContain("'ring-brand'");
    expect(out).toContain("`border-brand ${x}`");
    expect(out).toContain('"var(--brand)", "--brand": 1');
    expect(out).toContain("bg-primary-foreground or primary alone");
    expect(plan.total).toBe(7);
  });
  it("leaves alone files that don't have it, and says how many places each has", async () => {
    const plan = await run({ "a.tsx": 'x = "bg-primary"', "b.tsx": 'x = "bg-secondary"', "c.tsx": 'x = "bg-primary bg-primary"' });
    if ("refused" in plan) throw new Error(plan.refused);
    expect(Object.keys(plan.files).sort()).toEqual(["a.tsx", "c.tsx"]);
    expect(plan.places).toEqual([{ path: "c.tsx", n: 2 }, { path: "a.tsx", n: 1 }]);
  });
  it("a stylesheet that doesn't parse is left alone and listed", async () => {
    const plan = await run({ "a.css": ".a { color: var(--primary) " });
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.unreadable).toEqual(["a.css"]);
    expect(plan.files).toEqual({});
  });
  it("is done once: renaming back and forth gives the text it started with", async () => {
    const text = 'x = "hover:bg-primary/90"; y = "var(--primary)"';
    const there = await run({ "a.tsx": text });
    if ("refused" in there) throw new Error(there.refused);
    const back = await planRename({ token: token("brand", "color", "color-brand"), to: "primary", tokens: [token("brand", "color", "color-brand")], files: there.files });
    if ("refused" in back) throw new Error(back.refused);
    expect(back.files["a.tsx"]).toBe(text);
  });
});

describe("renaming a real repository's token", () => {
  const rename = async (from: string, to: string) => {
    const plan = await planRename({ token: tokenNamed(from), to, tokens: before.tokens, files: FILES });
    if ("refused" in plan) throw new Error(plan.refused);
    return { plan, files: { ...FILES, ...plan.files } };
  };

  it("primary → brand: the same tokens, used as often, nothing left behind", async () => {
    const { plan, files } = await rename("primary", "brand");
    const after = await scan(files);
    expect(plan.unreadable).toEqual([]);
    expect(after.tokens.map((t) => t.name).sort()).toEqual(before.tokens.map((t) => (t.name === "primary" ? "brand" : t.name)).sort());
    expect(after.tokenUsage!.brand.n).toBe(before.tokenUsage!.primary.n);
    expect(after.tokenUsage!.primary).toBeUndefined();
    expect(after.tokenUsage!["primary-foreground"]).toEqual(before.tokenUsage!["primary-foreground"]);
    expect(tokenNamed("brand", after).values).toEqual(tokenNamed("primary").values);
    expect(tokenNamed("brand", after).tailwind).toBe("color-brand");
    for (const text of Object.values(files)) {
      expect(text).not.toMatch(/(?<![\w-])--primary(?![\w-])/);
      expect(text).not.toMatch(/\b(bg|text|border|ring|accent|outline)-primary(?![\w-])/);
    }
  });
  it("a radius: radius-md → radius-control", async () => {
    const { files } = await rename("radius-md", "radius-control");
    const after = await scan(files);
    expect(after.tokenUsage!["radius-control"].n).toBe(before.tokenUsage!["radius-md"].n);
    expect(Object.values(files).some((t) => /rounded(-[a-z]+)?-md(?![\w-])/.test(t))).toBe(false);
  });
});

describe("what sync makes of a rename that is staged in the pull request", () => {
  const link: LinkShape = { setId: "s", themes: { light: "t-l", dark: "t-d" }, baseTheme: "light" };
  it("is no conflict, nothing to send, and no token brought back or made twice", async () => {
    const snapshot = readRepoTokens(before.tokens, before.themes);
    const motif = applyDoc({ colors: [], spacing: [], radii: [], shadows: [] }, link, snapshot.doc, "t-l");
    // Motif's own token is renamed, as the Tokens screen does.
    const renamed = { ...motif, colors: motif.colors.map((c) => (c.name === "primary" ? { ...c, name: "brand", repoName: "brand" } : c)) };
    const mine = readMotifTokens(renamed, link);

    const plan = await planRename({ token: tokenNamed("primary"), to: "brand", tokens: before.tokens, files: FILES });
    if ("refused" in plan) throw new Error(plan.refused);
    const overlay = await scan({ ...FILES, ...plan.files });
    const theirs = readRepoTokens(overlay.tokens, overlay.themes).doc;

    const merge = mergeTokens(snapshot.doc, mine, theirs);
    expect(merge.conflicts).toEqual([]);
    expect(merge.restored).toEqual([]);
    expect(Object.keys(merge.merged)).toContain("brand");
    expect(Object.keys(merge.merged)).not.toContain("primary");
    expect(changesToRepo(merge.merged, theirs)).toEqual([]);
  });
});

describe("reading the code to rename in", () => {
  it("reads every file that can name a token, and refuses a repository that is too big", async () => {
    const { findRename, readCodeFiles, isCodePath } = await import("./rename-scan");
    const reader = {
      listTree: async () => ({ paths: [...Object.keys(FILES), "node_modules/x/index.js", "dist/a.js", "lib/types.d.ts", "logo.png"], truncated: false }),
      readText: async (path: string) => FILES[path] ?? "",
    };
    expect(isCodePath("src/a.tsx") && isCodePath("docs/page.mdx") && isCodePath("demo/index.html")).toBe(true);
    expect(isCodePath("node_modules/x/index.js") || isCodePath("lib/types.d.ts") || isCodePath("logo.png")).toBe(false);
    const read = await readCodeFiles(reader, "main");
    if ("refused" in read) throw new Error(read.refused);
    expect(Object.keys(read.files)).toContain("src/styles/motif.css");
    expect(Object.keys(read.files)).not.toContain("logo.png");
    expect(await readCodeFiles(reader, "main", { limit: 3 })).toEqual({ refused: expect.stringMatching(/more than the 3/) });

    const progress: number[] = [];
    const plan = await findRename({ reader, branch: "main", token: tokenNamed("primary"), to: "brand", tokens: before.tokens, onProgress: (done) => progress.push(done) });
    if ("refused" in plan) throw new Error(plan.refused);
    // Every use, and the declarations and the mapping besides.
    expect(plan.total).toBeGreaterThan(before.tokenUsage!.primary.n);
    expect(progress.length).toBeGreaterThan(10);
    // A name that can't be is refused before anything is read.
    let reads = 0;
    const counting = { ...reader, readText: async (p: string) => { reads++; return reader.readText(p); } };
    expect(await findRename({ reader: counting, branch: "main", token: tokenNamed("primary"), to: "surface", tokens: before.tokens })).toEqual({ refused: expect.stringMatching(/already has that name/) });
    expect(reads).toBe(0);
  });
});
