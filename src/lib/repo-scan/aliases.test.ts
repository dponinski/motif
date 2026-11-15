import { describe, expect, it } from "vitest";
import { memorySource, scanRepository } from "./index";
import { aliasTarget } from "./tokens";

const scan = (css: string) => scanRepository(memorySource({ "package.json": JSON.stringify({ dependencies: { react: "19.0.0", tailwindcss: "4.0.0" } }), "src/styles.css": css }), { repo: "acme/ds", ref: "main" }, { tokensOnly: true });
const find = (a: Awaited<ReturnType<typeof scan>>, name: string) => a.tokens.find((t) => t.name === name);

describe("what is an alias", () => {
  it("is exactly one var(), and names its target", () => {
    expect(aliasTarget("var(--gray-12)")).toBe("gray-12");
    expect(aliasTarget("  var( --gray-12 ) ")).toBe("gray-12");
    expect(aliasTarget("var(--a, #fff)")).toBeNull();
    expect(aliasTarget("calc(var(--a) - 4px)")).toBeNull();
    expect(aliasTarget("#fff")).toBeNull();
  });
});

describe("a Tailwind name for a variable that is set elsewhere (shadcn)", () => {
  it("names the variable for Tailwind, and is not a token of its own", async () => {
    const a = await scan(`
:root { --background: oklch(1 0 0); }
.dark { --background: oklch(0.145 0 0); }
@theme inline { --color-background: var(--background); }`);
    expect(a.tokens.map((t) => t.name)).toEqual(["background"]);
    expect(find(a, "background")).toMatchObject({ kind: "color", tailwind: "color-background", values: { light: "oklch(1 0 0)", dark: "oklch(0.145 0 0)" } });
  });
});

describe("a token in @theme that is another @theme token (Tailwind's own way)", () => {
  const css = `
@theme {
  --color-gray-50: #f9fafb;
  --color-gray-900: #111827;
  --color-background: var(--color-gray-50);
  --color-foreground: var(--color-gray-900);
}`;
  it("is a token of its own, with the other token's value as its value", async () => {
    const a = await scan(css);
    expect(a.tokens.map((t) => t.name).sort()).toEqual(["color-background", "color-foreground", "color-gray-50", "color-gray-900"]);
    expect(find(a, "color-background")).toMatchObject({ kind: "color", tailwind: "color-background", values: { default: "var(--color-gray-50)" } });
    expect(Object.values(find(a, "color-background")!.locations)[0].container).toBe("theme");
  });
  it("leaves the token it points at with its own Tailwind name", async () => {
    const a = await scan(css);
    expect(find(a, "color-gray-50")!.tailwind).toBe("color-gray-50");
    expect(find(a, "color-gray-900")!.tailwind).toBe("color-gray-900");
  });
});

describe("a variable that is another variable", () => {
  const css = `
:root { --gray-1: #fcfcfc; --gray-12: #202020; --text: var(--gray-12); --surface: var(--gray-1); --gap: 8px; --space: var(--gap); }
.dark { --gray-1: #111111; --gray-12: #eeeeee; --text: var(--gray-12); --surface: var(--gray-1); }`;
  it("is a color when what it points at is", async () => {
    const a = await scan(css);
    expect(find(a, "text")).toMatchObject({ kind: "color", values: { light: "var(--gray-12)", dark: "var(--gray-12)" } });
    expect(find(a, "surface")).toMatchObject({ kind: "color", values: { light: "var(--gray-1)", dark: "var(--gray-1)" } });
  });
  it("takes the kind of a length it points at too", async () => {
    const a = await scan(css);
    expect(find(a, "space")!.kind).toBe("spacing");
  });
  it("is a color along a chain of them", async () => {
    const a = await scan(":root { --a: #ffffff; --b: var(--a); --c: var(--b); }");
    expect(find(a, "b")!.kind).toBe("color");
    expect(find(a, "c")!.kind).toBe("color");
  });
  it("stays what it was when it points at nothing there, or has a fallback, or mixes kinds", async () => {
    const a = await scan(":root { --x: var(--missing); --y: var(--a, #fff); --a: #fff; --len: 4px; --mixed: var(--a); } .dark { --mixed: var(--len); }");
    expect(find(a, "x")!.kind).toBe("other");
    expect(find(a, "y")!.kind).toBe("other");
    expect(find(a, "mixed")!.kind).toBe("other");
  });
  it("does not loop on variables that point at each other", async () => {
    const a = await scan(":root { --a: var(--b); --b: var(--a); }");
    expect(find(a, "a")!.kind).toBe("other");
    expect(find(a, "b")!.kind).toBe("other");
  });
});
