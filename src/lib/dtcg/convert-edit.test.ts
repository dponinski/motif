import { describe, expect, it } from "vitest";
import { finalizeTokens, newAccumulator, scanCss } from "../repo-scan/tokens";
import { convertTokens } from "./convert";
import { checkConversion, describeCheck, editStylesheets } from "./convert-edit";
import { generateCss } from "./generate";

const CSS = `@import "tailwindcss";

/* The palette */
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --primary: oklch(0.205 0 0);
  --card: var(--background);
  --header-height: 64px;
}

.dark {
  --background: oklch(0.145 0 0);
  --primary: oklch(0.922 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-primary: var(--primary);
}

@theme {
  --color-brand: #4f46e5;
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.1);
}

body { background: var(--background); }
`;

async function run(css: string, tailwind = true) {
  const acc = newAccumulator();
  await scanCss([{ path: "src/app.css", text: css }], acc, []);
  const found = finalizeTokens(acc);
  const output = "src/styles/tokens.css";
  const conv = convertTokens({ tokens: found.tokens, themes: found.themes, tailwind, name: "acme", dir: "src/tokens", output })!;
  const generated = generateCss(conv.files);
  const edit = await editStylesheets({ sheets: [{ path: "src/app.css", text: css, sha: "abc" }], conversion: conv, entry: "src/app.css", tailwind, output, generated });
  return { conv, edit, generated };
}

describe("editStylesheets", () => {
  it("takes out what is generated, imports the generated stylesheet, and leaves the rest", async () => {
    const { edit } = await run(CSS);
    const text = edit.files["src/app.css"].text;
    expect(text).toContain('@import "tailwindcss";\n@import "./styles/tokens.css";');
    expect(text).not.toContain("--primary: oklch(0.205");
    expect(text).not.toContain(".dark {");
    expect(text).not.toContain("--color-brand");
    // Not generated: the alias Tailwind reads, a length Motif doesn't keep, the comment and the rules.
    expect(text).toContain("--color-primary: var(--primary);");
    expect(text).toContain("--header-height: 64px;");
    expect(text).toContain("/* The palette */");
    expect(text).toContain("body { background: var(--background); }");
    expect(edit.imported).toBe(true);
    expect(edit.removed).toBe(8);
  });

  it("finds every variable identical", async () => {
    const { edit } = await run(CSS);
    expect(edit.check.differences).toEqual([]);
    expect(edit.check.identical).toBe(edit.check.total);
    expect(describeCheck(edit.check)).toMatch(/^\d+ variables, all identical$/);
  });

  it("finds a variable that differs", async () => {
    const before = [{ path: "a.css", text: ":root { --a: #111; --radius: 8px; }" }];
    const after = [{ path: "a.css", text: ":root { --a: #112; --radius: 0.5rem; }" }];
    const check = await checkConversion(before, after);
    expect(check.total).toBe(2);
    expect(check.identical).toBe(1);
    expect(check.differences).toMatchObject([{ name: "a", before: "#111", after: "#112" }]);
    expect(describeCheck(check)).toBe("1 of 2 variables identical; 1 differ");
  });

  it("finds a variable that moved out of @theme", async () => {
    const check = await checkConversion([{ path: "a.css", text: "@theme { --color-x: #111; }" }], [{ path: "a.css", text: ":root { --color-x: #111; }" }]);
    expect(check.differences).toHaveLength(1);
  });

  it("follows the variables a variable is when comparing", async () => {
    const check = await checkConversion(
      [{ path: "a.css", text: ":root { --a: #fff; --b: var(--a); }" }],
      [{ path: "a.css", text: ":root { --a: #ffffff; --b: #fff; }" }]
    );
    expect(check.differences).toEqual([]);
  });

  it("looks for a variable that was renamed under its new name", async () => {
    const before = [{ path: "a.css", text: ":root { --a: #111; --b: var(--a); }" }];
    const after = [{ path: "a.css", text: ":root { --c: #111; --b: var(--c); }" }];
    expect((await checkConversion(before, after)).differences.length).toBeGreaterThan(0);
    expect((await checkConversion(before, after, { a: "c" })).differences).toEqual([]);
  });

  it("imports into a stylesheet without Tailwind after its own imports", async () => {
    const { edit } = await run(`@import url("x.css");\n:root { --a: #111; }\n.btn { color: var(--a); }\n`, false);
    expect(edit.files["src/app.css"].text.startsWith('@import url("x.css");\n@import "./styles/tokens.css";')).toBe(true);
    expect(edit.check.differences).toEqual([]);
  });
});
