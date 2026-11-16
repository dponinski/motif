import { describe, expect, it } from "vitest";
import { editConfig } from "./config-write";

const CONFIG = `/** @type {import('tailwindcss').Config} */
const base = "0.5rem";
module.exports = {
  theme: {
    colors: { white: '#ffffff' },
    extend: {
      colors: {
        brand: { DEFAULT: "#1d4ed8", 500: '#3b82f6' }, // the brand
        ink: \`#111111\`,
      },
      borderRadius: {
        sm: "0.25rem",
        md: base,
        full: 9999,
      },
      boxShadow: { card: "0 1px 2px rgb(0 0 0 / 0.1)" },
    },
  },
};
`;
const set = (token: string, path: string[], value: string, inExtend = true) => ({ token, path, inExtend, value });

describe("changing a config in place", () => {
  it("changes only the value, keeping quotes, comments and layout", async () => {
    const out = await editConfig(CONFIG, "tailwind.config.js", [set("color-brand", ["colors", "brand", "DEFAULT"], "#ff0000"), set("color-brand-500", ["colors", "brand", "500"], "#00ff00")]);
    expect(out.skipped).toEqual([]);
    const before = CONFIG.split("\n");
    const diff = out.code.split("\n").map((l, i) => [before[i], l]).filter(([a, b]) => a !== b);
    expect(diff).toEqual([[`        brand: { DEFAULT: "#1d4ed8", 500: '#3b82f6' }, // the brand`, `        brand: { DEFAULT: "#ff0000", 500: '#00ff00' }, // the brand`]]);
  });
  it("a template literal, a number and a value of the theme itself rather than extend", async () => {
    const out = await editConfig(CONFIG, "tailwind.config.js", [set("color-ink", ["colors", "ink"], "#222222"), set("radius-full", ["borderRadius", "full"], "8"), set("color-white", ["colors", "white"], "#fafafa", false)]);
    expect(out.skipped).toEqual([]);
    expect(out.code).toContain("ink: `#222222`,");
    expect(out.code).toContain("full: 8,");
    expect(out.code).toContain("colors: { white: '#fafafa' },");
  });
  it("a number given a value that isn't one becomes a string", async () => {
    const out = await editConfig(CONFIG, "tailwind.config.js", [set("radius-full", ["borderRadius", "full"], "9999px")]);
    expect(out.code).toContain('full: "9999px",');
  });
  it("says why when a value is computed or the path isn't there, and changes nothing else", async () => {
    const out = await editConfig(CONFIG, "tailwind.config.js", [set("radius-md", ["borderRadius", "md"], "1rem"), set("gone", ["colors", "nope"], "#000000"), set("radius-sm", ["borderRadius", "sm"], "0.3rem")]);
    expect(out.skipped).toEqual([{ token: "radius-md", reason: "Its value in the config is computed, not written out" }, { token: "gone", reason: "The config changed since it was read" }]);
    expect(out.code).toContain('sm: "0.3rem",');
    expect(out.code).toContain("md: base,");
  });
  it("escapes what a string can't hold", async () => {
    const out = await editConfig(CONFIG, "tailwind.config.js", [set("shadow-card", ["boxShadow", "card"], 'a "b" \\ c')]);
    expect(out.code).toContain('card: "a \\"b\\" \\\\ c"');
  });
  it("works on an ES module with a default export and types", async () => {
    const ts = `import type { Config } from "tailwindcss";\nconst config: Config = { theme: { extend: { colors: { x: "#111" } } } } satisfies Config;\nexport default config;\n`;
    const out = await editConfig(ts, "tailwind.config.ts", [set("color-x", ["colors", "x"], "#222")]);
    expect(out.code).toContain('colors: { x: "#222" }');
  });
  it("leaves a file that doesn't parse alone", async () => {
    const out = await editConfig("module.exports = {", "tailwind.config.js", [set("color-x", ["colors", "x"], "#222")]);
    expect(out.code).toBe("module.exports = {");
    expect(out.skipped).toHaveLength(1);
  });
});

import { addToConfig } from "./config-write";

describe("adding to a config", () => {
  const add = (section: string, key: string, value: string) => ({ section, key, value, token: `${section}-${key}` });
  it("appends to the end of a section in its layout, keeping a trailing comma", async () => {
    const out = await addToConfig(CONFIG, "tailwind.config.js", [add("colors", "accent", "#ff00ff")]);
    expect(out.skipped).toEqual([]);
    expect(out.code).toContain(`        ink: \`#111111\`,\n        accent: "#ff00ff",\n      },`);
  });
  it("without a trailing comma, adds the separator", async () => {
    const out = await addToConfig(CONFIG, "tailwind.config.js", [add("boxShadow", "overlay", "0 0 4px #000")]);
    expect(out.code).toContain(`boxShadow: { card: "0 1px 2px rgb(0 0 0 / 0.1)",\n      overlay: "0 0 4px #000"`);
  });
  it("makes a section that isn't there, and a key that needs quotes", async () => {
    const out = await addToConfig(CONFIG, "tailwind.config.js", [add("spacing", "gutter-lg", "24px")]);
    expect(out.skipped).toEqual([]);
    expect(out.code).toContain(`      spacing: {\n        "gutter-lg": "24px",\n      },`);
    // What is made reads back where it was put.
    expect(out.code).toMatch(/spacing: \{\n\s+"gutter-lg": "24px",\n\s+\},\n\s*\},\n\s*\},\n\};/);
  });
  it("makes theme.extend too, and an empty object is filled", async () => {
    const bare = "module.exports = {\n  theme: {\n    colors: { a: '#111' },\n  },\n};\n";
    const out = await addToConfig(bare, "tailwind.config.js", [add("colors", "b", "#222")]);
    expect(out.code).toBe("module.exports = {\n  theme: {\n    colors: { a: '#111' },\n    extend: {\n      colors: {\n        b: \"#222\",\n      },\n    },\n  },\n};\n");
    const empty = await addToConfig("module.exports = { theme: { extend: { colors: {} } } };", "tailwind.config.js", [add("colors", "b", "#222")]);
    expect(empty.code).toContain('b: "#222"');
  });
  it("two in one go, and not one that is there already", async () => {
    const out = await addToConfig(CONFIG, "tailwind.config.js", [add("colors", "a", "#111111"), add("colors", "b", "#222222"), add("colors", "ink", "#333333")]);
    expect(out.skipped).toEqual([{ token: "colors-ink", reason: "The config has ink in colors already" }]);
    expect(out.code.indexOf('a: "#111111"')).toBeLessThan(out.code.indexOf('b: "#222222"'));
  });
  it("is read again by the scanner", async () => {
    const { scanTailwindConfig, newAccumulator } = await import("../repo-scan/tokens");
    const out = await addToConfig(CONFIG, "tailwind.config.js", [add("colors", "accent", "#ff00ff"), add("borderRadius", "card", "12px"), add("spacing", "gutter", "24px")]);
    const acc = newAccumulator();
    await scanTailwindConfig({ path: "tailwind.config.js", text: out.code }, acc, []);
    expect(acc.tokens.get("color-accent")?.values.base).toBe("#ff00ff");
    expect(acc.tokens.get("radius-card")?.values.base).toBe("12px");
    expect(acc.tokens.get("spacing-gutter")?.values.base).toBe("24px");
    expect(acc.tokens.get("color-ink")?.values.base).toBe("#111111");
  });
});

import { renameConfigEntry } from "./config-write";

describe("renaming an entry of a config", () => {
  const SHADCN = `module.exports = {
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
        },
        danger: {
          foreground: "hsl(var(--danger-foreground))",
          DEFAULT: "hsl(var(--danger))"
        },
      },
    },
  },
};
`;
  const move = (path: string[], classFrom: string, classTo: string) => ({ path: ["colors", ...path], inExtend: true, classFrom, classTo });
  const run = async (m: ReturnType<typeof move>, code = SHADCN) => renameConfigEntry(code, "tailwind.config.js", m);
  const lines = (before: string, after: string) => {
    const a = before.split("\n"), b = after.split("\n");
    return { removed: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
  };

  it("a flat entry has its key changed", async () => {
    const out = await run(move(["border"], "border", "edge"));
    expect("code" in out && lines(SHADCN, out.code)).toEqual({ removed: ['        border: "hsl(var(--border))",'], added: ['        edge: "hsl(var(--border))",'] });
  });
  it("a leaf of a group keeps its group, and can't leave it", async () => {
    const out = await run(move(["primary", "foreground"], "primary-foreground", "primary-fg"));
    expect("code" in out && out.code).toContain('          fg: "hsl(var(--primary-foreground))",');
    expect(await run(move(["primary", "foreground"], "primary-foreground", "brand-foreground"))).toEqual({ refused: "It is foreground in the primary group of the config, so its name has to keep starting with primary-" });
  });
  it("a DEFAULT that is alone takes the group's key", async () => {
    const out = await run(move(["secondary", "DEFAULT"], "secondary", "accent"));
    expect("code" in out && out.code).toContain('        accent: {\n          DEFAULT: "hsl(var(--secondary))",\n        },');
  });
  it("a DEFAULT that shares its group is taken out and put beside it, so the others keep their names", async () => {
    const out = await run(move(["primary", "DEFAULT"], "primary", "brand"));
    if (!("code" in out)) throw new Error(out.refused);
    expect(out.code).toContain('        primary: {\n          foreground: "hsl(var(--primary-foreground))",\n        },\n        brand: "hsl(var(--primary))",\n        secondary: {');
    expect(out.code).not.toContain('DEFAULT: "hsl(var(--primary))"');
  });
  it("and when it is the last of its group, without a comma of its own", async () => {
    const out = await run(move(["danger", "DEFAULT"], "danger", "alert"));
    if (!("code" in out)) throw new Error(out.refused);
    expect(out.code).toContain('        danger: {\n          foreground: "hsl(var(--danger-foreground))",\n        },\n        alert: "hsl(var(--danger))",');
  });
  it("what it makes is read again with the classes it should give", async () => {
    const { scanTailwindConfig, newAccumulator } = await import("../repo-scan/tokens");
    const out = await run(move(["primary", "DEFAULT"], "primary", "brand"));
    if (!("code" in out)) throw new Error(out.refused);
    const acc = newAccumulator();
    await scanTailwindConfig({ path: "tailwind.config.js", text: out.code }, acc, []);
    expect([...acc.tokens.keys()].sort()).toEqual(["color-alert".replace("alert", "border"), "color-brand", "color-danger", "color-danger-foreground", "color-primary-foreground", "color-secondary"].sort());
  });
  it("refuses a name that is taken, and a path that isn't there", async () => {
    expect(await run(move(["border"], "border", "secondary"))).toEqual({ refused: "The config has secondary in colors already" });
    expect(await run(move(["nope"], "nope", "x"))).toEqual({ refused: "The config changed since it was read" });
  });
});
