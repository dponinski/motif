import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateCss } from "./generate";
import { patchPackageJson, scaffoldFiles } from "./scaffold";
import { fixture } from "./fixture";
import { writeDtcg } from "./write";
import { convertTokens } from "./convert";
import { finalizeTokens, newAccumulator, scanCss } from "../repo-scan/tokens";

// The scaffolded config, run by the real Style Dictionary over the files Motif writes, must write the stylesheet Motif writes itself.

const root = resolve(__dirname, "../../..");
const installed = existsSync(join(root, "node_modules/style-dictionary/package.json"));
const made: string[] = [];

function build(files: Record<string, string>, dir = "src/tokens"): string {
  const tmp = mkdtempSync(join(tmpdir(), "motif-sd-"));
  made.push(tmp);
  symlinkSync(join(root, "node_modules"), join(tmp, "node_modules"));
  for (const [file, text] of Object.entries({ ...files, ...scaffoldFiles(dir) })) {
    mkdirSync(dirname(join(tmp, file)), { recursive: true });
    writeFileSync(join(tmp, file), text);
  }
  const config = JSON.parse(files[`${dir}/tokens.config.json`]);
  execFileSync(process.execPath, ["style-dictionary.config.mjs"], { cwd: tmp, stdio: "pipe" });
  return readFileSync(join(tmp, config.output), "utf8");
}

afterAll(() => { for (const tmp of made) rmSync(tmp, { recursive: true, force: true }); });

describe.skipIf(!installed)("the scaffolded Style Dictionary config", () => {
  for (const files of ["single", "per-set"] as const) {
    for (const tailwind of [true, false]) {
      it(`writes what Motif writes (${files}, ${tailwind ? "Tailwind 4" : "plain CSS"})`, () => {
        const written = writeDtcg(fixture(), { files, tailwind });
        expect(build(written.files)).toBe(generateCss(written.files));
      }, 60000);
    }
  }

  it("writes the variables the design system names, with the references kept", () => {
    const css = generateCss(writeDtcg(fixture(), { files: "per-set" }).files);
    expect(css).toContain("@theme {");
    expect(css).toContain("--color-gray-50: #f9fafb;");
    expect(css).toContain("--color-brand: oklch(0.6 0.2 260);");
    expect(css).toContain("--color-surface: var(--color-gray-50);");
    expect(css).toContain("--spacing-4: 16px;");
    expect(css).toContain("--text-heading: var(--text-xl);");
    expect(css).toContain("--text-heading--line-height: 1.2;");
    expect(css).toContain("--shadow-card: inset 0px 4px 8px 0px var(--color-overlay);");
    expect(css).toContain("--composition-badge-background: var(--color-brand);");
    expect(css).toMatch(/\.dark \{[^}]*--color-gray-50: #1f2937;/);
    // A theme file holds only what is different: `surface` is the same token in both.
    expect(css.split(".dark {")[1]).not.toContain("--color-surface");
  });

  it("writes into :root what Tailwind makes no classes from", () => {
    const css = generateCss(writeDtcg(fixture(), { files: "single" }).files);
    expect(css).toMatch(/:root \{[^}]*--ratio: 1\.25;/);
    expect(css.split(":root {")[1].split("}")[0]).not.toMatch(/--color-[\w-]+:/);
  });
});

describe("package.json for the build", () => {
  it("gets the script and the dependency, and what is there stays", () => {
    const out = patchPackageJson('{\n    "name": "x",\n    "scripts": { "dev": "vite" },\n    "devDependencies": { "vite": "^5.0.0" }\n}\n')!;
    const pkg = JSON.parse(out);
    expect(pkg.scripts).toEqual({ dev: "vite", "tokens:build": "node style-dictionary.config.mjs" });
    expect(pkg.devDependencies).toEqual({ "style-dictionary": "^5.8.0", vite: "^5.0.0" });
    expect(out).toContain('\n    "name"');
    expect(out.endsWith("}\n")).toBe(true);
  });

  it("leaves a script and a version that are there", () => {
    const text = '{"scripts":{"tokens:build":"custom"},"devDependencies":{"style-dictionary":"^4.0.0"}}';
    expect(patchPackageJson(text)).toBe(text);
    const pkg = JSON.parse(patchPackageJson('{"scripts":{"tokens:build":"custom"}}')!);
    expect(pkg.scripts["tokens:build"]).toBe("custom");
  });

  it("works for a package.json with neither", () => {
    expect(JSON.parse(patchPackageJson("{}")!)).toEqual({ scripts: { "tokens:build": "node style-dictionary.config.mjs" }, devDependencies: { "style-dictionary": "^5.8.0" } });
    expect(patchPackageJson("nope")).toBeNull();
  });

  it("writes the stylesheet of a converted repository, with the names its variables have and its themes' selectors", async () => {
    const acc = newAccumulator();
    await scanCss([{ path: "src/app.css", text: `:root { --radius: 0.5rem; --background: oklch(1 0 0); --card: var(--background); }\n[data-theme="dark"] { --background: oklch(0.2 0 0); }\n@theme { --color-brand: #4f46e5; --spacing-18: 4.5rem; }` }], acc, []);
    const found = finalizeTokens(acc);
    const conv = convertTokens({ tokens: found.tokens, themes: found.themes, tailwind: true, name: "acme", dir: "src/tokens", output: "src/styles/tokens.css" })!;
    const css = build(conv.files);
    expect(css).toBe(generateCss(conv.files));
    expect(css).toContain("--background: oklch(1 0 0);");
    expect(css).toContain('[data-theme="dark"] {');
  }, 60000);
});
