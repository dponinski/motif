import { describe, expect, it } from "vitest";
import { planDtcgExport, tokensDirFor } from "./export";
import { fixture } from "./fixture";
import { generateCss } from "./generate";
import { readDtcg } from "./read";
import type { RepoAnalysis } from "../repo-scan/types";

const analysis = (over: Partial<RepoAnalysis> & { tailwindVersion?: number | null } = {}): RepoAnalysis => ({
  tokens: [], themes: [], styleFiles: [], tailwindEntry: "src/styles/index.css", components: [],
  stack: { tailwindVersion: over.tailwindVersion === undefined ? 4 : over.tailwindVersion, entryFiles: [] },
  ...over,
} as unknown as RepoAnalysis);

const host = (files: Record<string, string>) => ({ getFile: async (path: string) => (path in files ? { path, text: files[path], sha: `sha-${path}` } : null) }) as never;

describe("putting tokens into a repository that has none", () => {
  it("puts the files beside the styles", () => {
    expect(tokensDirFor("src/styles/tokens.css")).toBe("src/tokens");
    expect(tokensDirFor("src/tokens.css")).toBe("src/tokens");
    expect(tokensDirFor("src/app/tokens.css")).toBe("src/app/tokens");
    expect(tokensDirFor("styles/tokens.css")).toBe("tokens");
    expect(tokensDirFor("tokens.css")).toBe("tokens");
  });

  it("writes the files, the stylesheet, the build and the import", async () => {
    const plan = await planDtcgExport(
      host({ "src/styles/index.css": '@import "tailwindcss";\n\nbody { margin: 0 }\n', "package.json": '{\n  "name": "app",\n  "scripts": { "dev": "vite" }\n}\n' }),
      analysis(), "main", fixture(), { files: "per-set" }
    );
    expect(Object.keys(plan.files).sort()).toEqual([
      "package.json", "src/styles/index.css", "src/styles/tokens.css", "src/tokens/primitives.dark.json", "src/tokens/primitives.json",
      "src/tokens/semantic.dark.json", "src/tokens/semantic.json", "src/tokens/tokens.config.json", "style-dictionary.config.mjs",
    ]);
    expect(plan.imported).toBe(true);
    expect(plan.files["src/styles/index.css"].text).toContain('@import "./tokens.css";');
    expect(plan.files["src/styles/index.css"].sha).toBe("sha-src/styles/index.css");
    expect(JSON.parse(plan.files["package.json"].text).scripts["tokens:build"]).toBe("node style-dictionary.config.mjs");
    expect(plan.files["src/styles/tokens.css"].text).toContain("--color-gray-50: #f9fafb;");
    expect(plan.link).toMatchObject({ dir: "src/tokens", files: "per-set", output: "src/styles/tokens.css", tailwind: true });
    expect(plan.notes).toEqual([]);
  });

  it("writes a stylesheet that is what the files come to, and files that read back as the tokens", async () => {
    const model = fixture();
    const plan = await planDtcgExport(host({}), analysis(), "main", model);
    const tokenFiles = Object.fromEntries(Object.entries(plan.files).filter(([p]) => p.startsWith("src/tokens/")).map(([p, f]) => [p, f.text]));
    expect(plan.files["src/styles/tokens.css"].text).toBe(generateCss(tokenFiles));
    expect(readDtcg(tokenFiles, model).notes).toEqual([]);
    expect(plan.link.base).toEqual(tokenFiles);
  });

  it("puts the files beside a stylesheet that is not in a styles folder", async () => {
    const plan = await planDtcgExport(host({ "src/index.css": '@import "tailwindcss";\n' }), analysis({ tailwindEntry: "src/index.css" }), "main", fixture());
    expect(plan.link).toMatchObject({ dir: "src/tokens", output: "src/tokens.css" });
    expect(plan.files["src/index.css"].text).toContain('@import "./tokens.css";');
  });

  it("lists what was written as the changes", async () => {
    const plan = await planDtcgExport(host({}), analysis(), "main", fixture());
    expect(plan.changes.some((c) => c.name === "color.brand" && c.type === "added")).toBe(true);
  });

  it("is plain CSS without Tailwind 4, and not imported", async () => {
    const plan = await planDtcgExport(host({ "src/index.css": "body {}" }), analysis({ tailwindVersion: null, tailwindEntry: null } as never), "main", fixture());
    expect(plan.link.tailwind).toBe(false);
    expect(plan.files["src/styles/tokens.css"].text).not.toContain("@theme");
    expect(plan.imported).toBe(false);
  });

  it("leaves a Style Dictionary config the repository wrote itself, and says so", async () => {
    const plan = await planDtcgExport(host({ "style-dictionary.config.mjs": "export default {};\n" }), analysis(), "main", fixture());
    expect(plan.files["style-dictionary.config.mjs"]).toBeUndefined();
    expect(plan.notes[0]).toContain("style-dictionary.config.mjs is the repository's own");
  });

  it("replaces Motif's own config, which it may have made before", async () => {
    const first = await planDtcgExport(host({}), analysis(), "main", fixture());
    const again = await planDtcgExport(host({ "style-dictionary.config.mjs": first.files["style-dictionary.config.mjs"].text }), analysis(), "main", fixture());
    expect(again.files["style-dictionary.config.mjs"].sha).toBe("sha-style-dictionary.config.mjs");
  });

  it("doesn't touch a package.json that has what it needs", async () => {
    const pkg = '{"scripts":{"tokens:build":"x"},"devDependencies":{"style-dictionary":"^5.0.0"}}';
    const plan = await planDtcgExport(host({ "package.json": pkg }), analysis(), "main", fixture());
    expect(plan.files["package.json"]).toBeUndefined();
  });
});
