import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import { readRepoTokens, type SyncDoc } from "./doc";
import type { TokenChange } from "./merge";
import { applyEdits, filesNeeded, generateTokensCss, tokensFile } from "./write";

const FILES = loadFixture("motif-test-system");
const CSS_PATH = "src/styles/motif.css";
const CSS = FILES[CSS_PATH];

const scan = (files: Record<string, string>) => scanRepository(memorySource(files), { repo: "a/b", ref: "main" }, { tokensOnly: true });
const analysis = await scan(FILES);
const snapshot = readRepoTokens(analysis.tokens, analysis.themes);

const change = (name: string, kind: TokenChange["kind"], theme: string, type: TokenChange["type"], after: string): TokenChange => ({ name, kind, theme, type, after });
const changedLines = (before: string, after: string) => {
  const a = before.split("\n"), b = after.split("\n");
  expect(b.length).toBe(a.length);
  return b.flatMap((line, i) => (line === a[i] ? [] : [{ line: i + 1, before: a[i], after: line }]));
};

describe("tokensFile and filesNeeded", () => {
  it("finds the stylesheet that holds the tokens", () => {
    expect(tokensFile(analysis)).toBe(CSS_PATH);
    expect(filesNeeded(analysis)).toEqual([CSS_PATH]);
  });
});

describe("applyEdits: changing values in place", () => {
  it("changes one line for one value, written in the notation the repo uses", async () => {
    const out = await applyEdits({ [CSS_PATH]: CSS }, analysis, snapshot, [change("primary", "color", "light", "changed", "#ff0000")]);
    const diff = changedLines(CSS, out.files[CSS_PATH]);
    expect(diff).toHaveLength(1);
    expect(diff[0].before).toBe("  --primary: oklch(0.52 0.21 270);");
    expect(diff[0].after).toMatch(/^  --primary: oklch\(0\.628 0\.258 29\.\d+\);$/);
    expect(out.skipped).toEqual([]);
  });

  it("targets the right theme, and radius and shadows keep their units and layers", async () => {
    const out = await applyEdits({ [CSS_PATH]: CSS }, analysis, snapshot, [
      change("primary", "color", "dark", "changed", "#000000"),
      change("radius-md", "radius", "light", "changed", "10"),
      change("shadow-card", "shadow", "light", "changed", "0 2px 2px 0 #0000000a, 0 1px 3px 0 #0000000f"),
    ]);
    const diff = changedLines(CSS, out.files[CSS_PATH]);
    expect(diff.map((d) => d.after.trim())).toEqual([
      "--primary: oklch(0 0 0);",
      "--radius-md: 0.625rem;",
      "--shadow-card: 0 2px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06);",
    ]);
  });

  it("does not touch files it did not edit", async () => {
    expect((await applyEdits({ [CSS_PATH]: CSS }, analysis, snapshot, [])).files).toEqual({});
  });

  it("says so when the file moved since it was read, or the token is gone, or cannot be edited", async () => {
    const shifted = "/* new */\n" + CSS;
    const moved = await applyEdits({ [CSS_PATH]: shifted }, analysis, snapshot, [change("primary", "color", "light", "changed", "#ff0000")]);
    expect(moved.files).toEqual({});
    expect(moved.skipped).toEqual([{ name: "primary", theme: "light", reason: `Couldn't find it in ${CSS_PATH}; the file changed since it was read` }]);

    const gone = await applyEdits({ [CSS_PATH]: CSS }, analysis, snapshot, [change("nope", "color", "light", "changed", "#ff0000")]);
    expect(gone.skipped[0].reason).toBe("It is not in the repository any more");

    const config = await scan({ "package.json": '{"dependencies":{"react":"^18","tailwindcss":"^3"}}', "tailwind.config.js": "module.exports = { theme: { extend: { colors: { brand: '#112233' } } } };" });
    const snap = readRepoTokens(config.tokens, config.themes);
    const blocked = await applyEdits({}, config, snap, [change("color-brand", "color", "default", "changed", "#ffffff")]);
    expect(blocked.skipped).toEqual([{ name: "color-brand", theme: "default", reason: "Defined in a Tailwind config file, which can't be edited yet" }]);
  });
});

describe("applyEdits: adding tokens", () => {
  const added: TokenChange[] = [
    change("brand", "color", "light", "added", "#112233"),
    change("brand", "color", "dark", "added", "#aabbcc"),
    change("radius-2xl", "radius", "light", "added", "24"),
    change("shadow-pop", "shadow", "light", "added", "0 4px 8px -2px #00000040"),
  ];

  it("follows the repository's conventions: variables per theme, a Tailwind alias, and @theme for the rest", async () => {
    const out = await applyEdits({ [CSS_PATH]: CSS }, analysis, snapshot, added);
    const text = out.files[CSS_PATH];
    expect(text).toContain("--brand: oklch(");
    expect(out.skipped).toEqual([]);

    // Reading the edited file back finds exactly what was added, with the alias and containers right.
    const again = await scan({ ...FILES, [CSS_PATH]: text });
    const snap = readRepoTokens(again.tokens, again.themes);
    expect(snap.doc.brand).toEqual({ kind: "color", values: { light: "#112233", dark: "#aabbcc" } });
    expect(again.tokens.find((t) => t.name === "brand")).toMatchObject({ tailwind: "color-brand", locations: { light: { container: "css-var" }, dark: { container: "css-var" } } });
    expect(snap.doc["radius-2xl"]).toEqual({ kind: "radius", values: { light: "24" } });
    expect(again.tokens.find((t) => t.name === "radius-2xl")!.locations.light.container).toBe("theme");
    expect(text).toContain("--radius-2xl: 1.5rem;");
    expect(snap.doc["shadow-pop"].values.light).toBe("0 4px 8px -2px #00000040");
    expect(again.tokens.find((t) => t.name === "shadow-pop")!.locations.light.container).toBe("theme");
    // Nothing else moved.
    expect(Object.keys(snap.doc).length).toBe(Object.keys(snapshot.doc).length + 3);
  });

  it("only appends: every original line is still there, in order", async () => {
    const out = await applyEdits({ [CSS_PATH]: CSS }, analysis, snapshot, added);
    const result = out.files[CSS_PATH].split("\n");
    let at = 0;
    for (const line of CSS.split("\n")) {
      at = result.indexOf(line, at);
      expect(at, line).toBeGreaterThanOrEqual(0);
      at++;
    }
  });

  it("creates a theme block when a token gains a value for a theme the file has none of", async () => {
    const out = await applyEdits({ [CSS_PATH]: CSS }, analysis, snapshot, [change("brand", "color", "dark", "added", "#aabbcc")]);
    expect(out.files[CSS_PATH]).toContain("--brand: oklch(");
    const plain = await scan({ "package.json": '{"dependencies":{"react":"^18"}}', "a.css": ":root { --bg: #ffffff; }\n" });
    const edited = await applyEdits({ "a.css": ":root { --bg: #ffffff; }\n" }, plain, readRepoTokens(plain.tokens, plain.themes), [change("bg", "color", "dark", "added", "#000000")]);
    expect(edited.files["a.css"]).toContain(".dark {");
    expect(edited.files["a.css"]).toMatch(/--bg: #000000;/);
  });
});

describe("generateTokensCss", () => {
  const doc: SyncDoc = {
    primary: { kind: "color", values: { light: "#4f46e5", dark: "#818cf8" } },
    border: { kind: "color", values: { light: "#e5e5e5", dark: "#333333" } },
    "radius-sm": { kind: "radius", values: { light: "4" } },
    "spacing-4": { kind: "spacing", values: { light: "16" } },
    "shadow-card": { kind: "shadow", values: { light: "0 1px 2px 0 #0000000a, 0 1px 3px 0 #0000000f" } },
  };

  it("writes Tailwind v4 tokens as variables plus @theme", () => {
    expect(generateTokensCss(doc, { tailwind: true, baseTheme: "light" })).toBe(`/* Design tokens, kept in sync with Motif. */

:root {
  --primary: #4f46e5;
  --border: #e5e5e5;
}

.dark {
  --primary: #818cf8;
  --border: #333333;
}

@theme inline {
  --color-primary: var(--primary);
  --color-border: var(--border);
}

@theme {
  --radius-sm: 4px;
  --spacing-4: 16px;
  --shadow-card: 0 1px 2px 0 #0000000a, 0 1px 3px 0 #0000000f;
}
`);
  });

  it("writes everything as variables when there is no Tailwind", () => {
    const css = generateTokensCss(doc, { tailwind: false, baseTheme: "light" });
    expect(css).toContain(":root {\n  --primary: #4f46e5;\n  --border: #e5e5e5;\n  --radius-sm: 4px;\n  --spacing-4: 16px;");
    expect(css).not.toContain("@theme");
  });

  it("reads back as the same tokens, with or without Tailwind", async () => {
    for (const tailwind of [true, false]) {
      const css = generateTokensCss(doc, { tailwind, baseTheme: "light" });
      const pkg = JSON.stringify({ dependencies: { react: "^18", ...(tailwind ? { tailwindcss: "^4.0.0" } : {}) } });
      const again = await scan({ "package.json": pkg, "tokens.css": css });
      expect(again.themes).toEqual(["light", "dark"]);
      expect(readRepoTokens(again.tokens, again.themes).doc, `tailwind=${tailwind}`).toEqual(doc);
    }
  });

  it("emits custom themes as data attributes", () => {
    const css = generateTokensCss({ a: { kind: "color", values: { light: "#ffffff", sepia: "#f4ecd8" } } }, { tailwind: false, baseTheme: "light" });
    expect(css).toContain('[data-theme="sepia"] {\n  --a: #f4ecd8;\n}');
  });
});
