import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixtures";
import { memorySource, scanRepository } from ".";
import { tokenUsage } from "./usage";
import type { RepoToken } from "./types";

const analysis = await scanRepository(memorySource(loadFixture("motif-test-system")), { repo: "a/b", ref: "main" });

describe("where the fixture's tokens are used", () => {
  const use = analysis.tokenUsage!;
  it("counts class names, with modifiers and opacity, in the files they are in", () => {
    expect(use.primary.n).toBe(11);
    // `accent-primary` is a use though the inspector has no control for it.
    expect(use.primary.files).toContain("src/components/Checkbox.tsx");
    expect(use.primary.files).toContain("src/components/Button.tsx");
  });
  it("reads radius and shadow classes as the tokens they name", () => {
    expect(use["radius-sm"].files).toEqual(["src/components/Checkbox.tsx"]);
    expect(use["radius-xl"].files).toEqual(["src/components/Modal.tsx"]);
    expect(use["shadow-card"].files.sort()).toEqual(["src/components/Card.tsx", "src/components/Switch.tsx", "src/components/Tabs.tsx"]);
  });
  it("leaves out what nothing uses", () => {
    expect(analysis.tokens.map((t) => t.name).filter((n) => !use[n]).sort()).toEqual(["font-mono", "success-foreground"]);
  });
  it("is not made by a scan that only reads tokens", async () => {
    const tokensOnly = await scanRepository(memorySource(loadFixture("motif-test-system")), { repo: "a/b", ref: "main" }, { tokensOnly: true });
    expect(tokensOnly.tokenUsage).toBeUndefined();
  });
});

const token = (name: string, kind: RepoToken["kind"], tailwind: string | null): RepoToken => ({ name, kind, values: { default: "x" }, locations: { default: { file: "a.css", line: 1, container: "css-var" } }, tailwind, file: "a.css", line: 1 });
const tokens = [token("primary", "color", "color-primary"), token("gutter", "spacing", "spacing-gutter"), token("card", "radius", "radius-card"), token("gray-50", "color", null)];
const run = (sources: { path: string; text: string; css?: boolean }[], tailwind: 3 | 4 | null = 4) =>
  tokenUsage({ tokens, themes: ["default"], tailwind, sources: sources.map((s) => ({ css: false, ...s })) });

describe("what counts as a use", () => {
  it("negative and sided utilities, variants, important", () => {
    const u = run([{ path: "a.tsx", text: 'x = "-mt-gutter hover:bg-primary/90 !px-gutter rounded-t-card md:dark:text-primary"' }]);
    expect(u.gutter.n).toBe(2);
    expect(u.primary.n).toBe(2);
    expect(u.card.n).toBe(1);
  });
  it("a word that only looks like one is not", () => {
    const u = run([{ path: "a.tsx", text: 'x = "primary gutter bg-primary-foreground sm:gutter-x"' }]);
    expect(u).toEqual({});
  });
  it("var() in a component and in a stylesheet, but not the mapping that gives Tailwind the token", () => {
    const u = run([
      { path: "a.tsx", text: 'style={{ color: "var(--primary)" }}' },
      { path: "a.css", css: true, text: ":root { --color-primary: var(--primary); --background: var(--gray-50); } .x { color: var(--primary); }" },
    ]);
    expect(u.primary.n).toBe(2);
    expect(u["gray-50"].n).toBe(1);
  });
  it("@apply in a stylesheet", () => {
    const u = run([{ path: "a.css", css: true, text: ".btn { @apply bg-primary p-gutter; }" }]);
    expect(u.primary.n).toBe(1);
    expect(u.gutter.n).toBe(1);
  });
  it("in a stylesheet repository only var() counts", () => {
    const u = run([{ path: "a.tsx", text: 'x = "bg-primary"; y = "var(--primary)"' }], null);
    expect(u.primary.n).toBe(1);
  });
  it("lists the files that use it most first, at most twelve", () => {
    const sources = Array.from({ length: 15 }, (_, i) => ({ path: `f${String(i).padStart(2, "0")}.tsx`, text: 'x = "bg-primary"' }));
    sources.push({ path: "z.tsx", text: 'x = "bg-primary bg-primary"' });
    const u = run(sources);
    expect(u.primary.n).toBe(17);
    expect(u.primary.files).toHaveLength(12);
    expect(u.primary.files[0]).toBe("z.tsx");
  });
});
