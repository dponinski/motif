import { describe, expect, it } from "vitest";
import { generateCss, HEADER, variablesOf } from "./generate";
import { writeDtcg } from "./write";
import { fixture } from "./fixture";
import { emptyStoredTokenData } from "../tokens/migrate";

const files = (config: object, trees: Record<string, unknown>) => ({
  "src/tokens/tokens.config.json": JSON.stringify(config),
  ...Object.fromEntries(Object.entries(trees).map(([f, t]) => [`src/tokens/${f}`, JSON.stringify(t)])),
});
const single = { files: "single", output: "src/styles/tokens.css", tailwind: true, selectors: { dark: ".dark" }, sets: [{ name: "Tokens", key: "tokens", themes: [{ key: "light", name: "Light" }, { key: "dark", name: "Dark" }] }] };

describe("the stylesheet the files come to", () => {
  it("is just the header when there are no tokens", () => {
    expect(generateCss(writeDtcg(emptyStoredTokenData()).files)).toBe(HEADER);
  });

  it("gives a token the variable its path says, and a reference var() of the variable it names", () => {
    const css = generateCss(files(single, { "tokens.json": { color: { a: { $type: "color", $value: { colorSpace: "srgb", components: [1, 0, 0] } }, b: { $type: "color", $value: "{color.a}" } } } }));
    expect(css).toContain("--color-a: #ff0000;");
    expect(css).toContain("--color-b: var(--color-a);");
  });

  it("uses the type of a group for what is in it, and of the base for a theme's value", () => {
    const css = generateCss(files(single, {
      "tokens.json": { spacing: { $type: "dimension", sm: { $value: { value: 8, unit: "px" } } } },
      "tokens.dark.json": { spacing: { sm: { $value: { value: 4, unit: "px" } } } },
    }));
    expect(css).toContain("--spacing-sm: 8px;");
    expect(css).toMatch(/\.dark \{\n  --spacing-sm: 4px;\n\}/);
  });

  it("puts a theme under the selector the config gives it", () => {
    const config = { ...single, selectors: { dark: '[data-theme="dark"]' } };
    const css = generateCss(files(config, {
      "tokens.json": { color: { a: { $type: "color", $value: { colorSpace: "srgb", components: [1, 1, 1] } } } },
      "tokens.dark.json": { color: { a: { $value: { colorSpace: "srgb", components: [0, 0, 0] } } } },
    }));
    expect(css).toContain('[data-theme="dark"] {\n  --color-a: #000000;\n}');
  });

  it("is all in :root without Tailwind", () => {
    const css = generateCss(files({ ...single, tailwind: false }, { "tokens.json": { color: { a: { $type: "color", $value: { colorSpace: "srgb", components: [1, 1, 1] } } }, ratio: { $type: "number", $value: 1.5 } } }));
    expect(css).not.toContain("@theme");
    expect(css).toContain(":root {\n  --color-a: #ffffff;\n  --ratio: 1.5;\n}");
  });

  it("puts the sets together in the order of the config, a group joined to the group of the same name", () => {
    const config = { ...single, files: "per-set", selectors: {}, sets: [{ name: "A", key: "a", themes: [] }, { name: "B", key: "b", themes: [] }] };
    const css = generateCss(files(config, {
      "a.json": { color: { one: { $type: "color", $value: { colorSpace: "srgb", components: [0, 0, 0] } } }, spacing: { x: { $type: "number", $value: 1 } } },
      "b.json": { color: { two: { $type: "color", $value: { colorSpace: "srgb", components: [1, 1, 1] } } } },
    }));
    expect(css.indexOf("--color-one")).toBeLessThan(css.indexOf("--color-two"));
    expect(css.indexOf("--color-two")).toBeLessThan(css.indexOf("--spacing-x"));
  });

  it("needs the config", () => {
    expect(() => generateCss({ "src/tokens/tokens.json": "{}" })).toThrow("tokens.config.json");
  });
});

describe("the variables of a token", () => {
  it("are the size of a text style, and what goes with it after it", () => {
    expect(variablesOf(["text", "h1"], "typography", { fontSize: { value: 2, unit: "rem" }, lineHeight: 1.1, fontFamily: "{font.sans}", fontWeight: 700 }, {})).toEqual([
      ["--text-h1", "2rem"], ["--text-h1--line-height", "1.1"], ["--text-h1--font-weight", "700"], ["--text-h1--font-family", "var(--font-sans)"],
    ]);
  });

  it("are one shadow, with what isn't given as 0, or the text it was written as", () => {
    expect(variablesOf(["shadow", "s"], "shadow", { offsetY: { value: 2, unit: "px" }, blur: { value: 4, unit: "px" }, color: "{color.k}" }, {})).toEqual([["--shadow-s", "0 2px 4px 0 var(--color-k)"]]);
    expect(variablesOf(["shadow", "s"], "shadow", {}, { raw: "0 1px 2px red, 0 2px 4px blue" })).toEqual([["--shadow-s", "0 1px 2px red, 0 2px 4px blue"]]);
  });

  it("are a font family as a list of fonts", () => {
    expect(variablesOf(["font", "sans"], "fontFamily", ["Inter", "system-ui"], {})).toEqual([["--font-sans", "Inter, system-ui"]]);
  });
});

describe("the files Motif writes", () => {
  it("come to a stylesheet that has every token of the project", () => {
    const written = writeDtcg(fixture(), { files: "per-set" });
    const css = generateCss(written.files);
    for (const name of ["gray-50", "gray-900", "brand", "overlay", "surface", "text", "accent"]) expect(css).toContain(`--color-${name}:`);
  });
});

describe("numbers and strings that differ by theme", () => {
  it("are in their theme's block of the stylesheet, and only there", async () => {
    const { fixture } = await import("./fixture");
    const { writeDtcg } = await import("./write");
    const css = generateCss(writeDtcg(fixture(), { files: "single" }).files);
    expect(css).toMatch(/--text-xl:\s*1\.5rem/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--text-xl:\s*1\.75rem/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--label:\s*Save changes/);
    expect(css).not.toMatch(/--text-ratio[^;]*1\.75/);
  });
});

describe("compositions that differ by theme", () => {
  it("are in their theme's block of the stylesheet", async () => {
    const css = generateCss(writeDtcg(fixture(), { files: "single" }).files);
    const dark = [...css.matchAll(/\.dark\s*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
    // a text style: the parts that differ; a shadow: the whole value (it is one variable); a custom composition: the parts that differ
    expect(dark).toMatch(/--text-heading--line-height:\s*1\.4/);
    expect(dark).toMatch(/--shadow-card:[^;]*2px/);
    expect(dark).toMatch(/--composition-badge-label:\s*Nouveau/);
    expect(css).toMatch(/--text-heading--line-height:\s*1\.2/);
  });
});
