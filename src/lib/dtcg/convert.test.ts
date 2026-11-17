import { describe, expect, it } from "vitest";
import { finalizeTokens, newAccumulator, scanCss } from "../repo-scan/tokens";
import { readDtcg } from "./read";
import { generateCss } from "./generate";
import { convertTokens } from "./convert";

const SHADCN = `@import "tailwindcss";

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --card: var(--background);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-primary: var(--primary);
  --radius-sm: calc(var(--radius) - 4px);
}

@theme {
  --color-brand: #4f46e5;
  --spacing-18: 4.5rem;
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.1);
  --font-sans: Inter, sans-serif;
}
`;

async function tokensOf(css: string) {
  const acc = newAccumulator();
  await scanCss([{ path: "src/app.css", text: css }], acc, []);
  return finalizeTokens(acc);
}

const input = (found: Awaited<ReturnType<typeof tokensOf>>) => ({ tokens: found.tokens, themes: found.themes, tailwind: true, name: "acme", dir: "src/tokens", output: "src/styles/tokens.css" });

describe("convertTokens", () => {
  it("makes the variables of a stylesheet into design tokens files that keep their names", async () => {
    const found = await tokensOf(SHADCN);
    const out = convertTokens(input(found))!;
    expect(out).not.toBeNull();
    expect(out.converted).toEqual(expect.arrayContaining(["radius", "background", "primary", "card", "color-brand", "spacing-18", "shadow-card"]));
    // Left where they are: the aliases for Tailwind, the calc(), the font.
    expect(out.converted).not.toContain("color-background");
    expect(out.converted).not.toContain("radius-sm");
    expect(out.converted).not.toContain("font-sans");

    const css = generateCss(out.files);
    expect(css).toContain("--primary: oklch(0.205 0 0);");
    expect(css).toContain("--radius: 0.625rem;");
    expect(css).toContain("--card: var(--background);");
    expect(css).toContain("@theme {\n  --color-brand: #4f46e5;");
    expect(css).toContain("--spacing-18: 4.5rem;");
    expect(css).toMatch(/\.dark \{[^}]*--primary: oklch\(0\.922 0 0\);/);
    // `--card` is the same as `--background` in both themes, so the dark block doesn't repeat it.
    expect(css).not.toMatch(/\.dark \{[^}]*--card/);
  });

  it("reads back as the tokens it was made from", async () => {
    const found = await tokensOf(SHADCN);
    const out = convertTokens(input(found))!;
    const read = readDtcg(out.files);
    const primary = read.data.tokens.find((t) => t.name === "primary")!;
    expect(primary.type).toBe("color");
    expect(Object.values(primary.values)).toHaveLength(2);
    expect(read.data.tokens.find((t) => t.name === "card")?.ref).toBeDefined();
    expect(read.data.tokens.find((t) => t.name === "radius")).toMatchObject({ type: "number", unit: "rem", use: "radius", values: { "*": "0.625" } });
    expect(read.data.sets[0].themes.map((t) => t.name)).toEqual(["Light", "Dark"]);
  });

  it("leaves a variable alone that is declared where the stylesheet can't reproduce it", async () => {
    const found = await tokensOf(`:root { --a: #111; }\n@media (prefers-color-scheme: dark) { :root { --b: #222; } }\n@layer base { :root { --c: #333; } }\n.card { --d: #444; }`);
    const out = convertTokens({ ...input(found), tailwind: false })!;
    expect(out.converted).toEqual(["a"]);
    expect(out.left.map((l) => l.name).sort()).toEqual(["b", "c"]);
  });

  it("drops a token whose name is also a group", async () => {
    const found = await tokensOf(`:root { --radius: 8px; }\n@theme { --radius-lg: 12px; }`);
    const out = convertTokens(input(found))!;
    expect(out.converted).toEqual(["radius-lg"]);
    expect(out.left.some((l) => l.name === "radius")).toBe(true);
  });

  it("converts nothing from a stylesheet with nothing it can keep", async () => {
    const found = await tokensOf(`:root { --font-body: Inter; }`);
    expect(convertTokens(input(found))).toBeNull();
  });

  it("keeps the selector a theme is written under", async () => {
    const found = await tokensOf(`:root { --bg: #fff; }\n[data-theme="dark"] { --bg: #000; }`);
    const out = convertTokens(input(found))!;
    expect(out.selectors).toEqual({ dark: '[data-theme="dark"]' });
    expect(generateCss(out.files)).toContain('[data-theme="dark"] {\n  --bg: #000000;');
  });
});
