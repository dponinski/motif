import { describe, expect, it } from "vitest";
import { memorySource, scanRepository } from "../repo-scan";
import type { ColorToken } from "../../store/design-system";
import { applyDoc, readMotifTokens, readRepoTokens, resolveDoc, resolveInDoc, type LinkShape, type SyncDoc, type TokenSlices } from "./doc";
import { mergeTokens } from "./merge";
import { applyEdits, generateTokensCss } from "./write";

const link: LinkShape = { setId: "set-1", themes: { light: "t-light", dark: "t-dark" }, baseTheme: "light" };
const CSS = `:root {
  --gray-50: #f9fafb;
  --gray-900: #111827;
  --background: var(--gray-50);
  --foreground: var(--gray-900);
  --brand: #4f46e5;
}
.dark {
  --background: var(--gray-900);
  --foreground: var(--gray-50);
}
`;
const PATH = "src/styles.css";
const scan = () => scanRepository(memorySource({ [PATH]: CSS, "package.json": JSON.stringify({ name: "x", dependencies: { react: "19" } }) }), { repo: "a/b", ref: "main" }, { tokensOnly: true });

describe("aliases through sync", async () => {
  const analysis = await scan();
  const snapshot = readRepoTokens(analysis.tokens, analysis.themes);
  const empty: TokenSlices = { colors: [], spacing: [], radii: [], shadows: [] };

  it("reads var(--x) as an alias, per theme", () => {
    expect(snapshot.skipped).toEqual([]);
    expect(snapshot.doc.background.values).toEqual({ light: "var(--gray-50)", dark: "var(--gray-900)" });
    expect(snapshot.doc.brand.values.light).toBe("#4f46e5");
  });

  it("shows an alias as the color it comes to, and remembers the link", () => {
    const state = applyDoc(empty, link, snapshot.doc, "t-light");
    const bg = state.colors.find((c) => c.name === "background")!;
    expect(bg.themeValues).toEqual({ "t-light": "#f9fafb", "t-dark": "#111827" });
    expect(bg.themeAlias).toEqual({ "t-light": "gray-50", "t-dark": "gray-900" });
    expect(state.colors.find((c) => c.name === "brand")!.themeAlias).toBeUndefined();
  });

  it("writes the same document back, so nothing differs", () => {
    const state = applyDoc(empty, link, snapshot.doc, "t-light");
    const back = readMotifTokens(state, link);
    expect(back.background.values).toEqual({ light: "var(--gray-50)", dark: "var(--gray-900)" });
    const merged = mergeTokens(snapshot.doc, back, snapshot.doc);
    expect(merged.conflicts).toEqual([]);
    expect(merged.merged.background).toEqual(snapshot.doc.background);
    expect(merged.merged.foreground).toEqual(snapshot.doc.foreground);
  });

  it("clears the link when the repository makes the token a plain color", () => {
    const state = applyDoc(empty, link, snapshot.doc, "t-light");
    const plain: SyncDoc = { ...snapshot.doc, background: { kind: "color", values: { light: "#ffffff", dark: "#000000" } } };
    const next = applyDoc(state, link, plain, "t-light");
    const bg = next.colors.find((c) => c.name === "background")!;
    expect(bg.themeAlias).toBeUndefined();
    expect(bg.themeValues["t-light"]).toBe("#ffffff");
  });

  it("follows a chain, and gives up on a loop", () => {
    const chain: SyncDoc = {
      a: { kind: "color", values: { light: "var(--b)" } },
      b: { kind: "color", values: { light: "var(--c)" } },
      c: { kind: "color", values: { light: "#123456" } },
      x: { kind: "color", values: { light: "var(--y)" } },
      y: { kind: "color", values: { light: "var(--x)" } },
    };
    expect(resolveInDoc(chain, "a", "light", "light")).toBe("#123456");
    expect(resolveInDoc(chain, "x", "light", "light")).toBeNull();
    expect(resolveDoc(chain, "light").a.values.light).toBe("#123456");
  });

  it("writes an edit to an alias as var(--x) in the file", async () => {
    const out = await applyEdits({ [PATH]: CSS }, analysis, snapshot, [{ name: "background", kind: "color", theme: "light", type: "changed", after: "var(--gray-900)" }]);
    expect(out.files[PATH]).toContain("--background: var(--gray-900);");
    expect(out.skipped).toEqual([]);
  });
});

it("a literal stays in Motif's own text when it means the same color", () => {
  const existing: ColorToken = { id: "1", name: "brand", repoName: "brand", value: "rgb(79, 70, 229)", group: "base", setId: "set-1", themeValues: { "t-light": "rgb(79, 70, 229)", "t-dark": "rgb(79, 70, 229)" } };
  const out = applyDoc({ colors: [existing], spacing: [], radii: [], shadows: [] }, link, { brand: { kind: "color", values: { light: "#4f46e5", dark: "#4f46e5" } } }, "t-light");
  expect(out.colors[0].themeValues["t-light"]).toBe("rgb(79, 70, 229)");
});

it("generates a tokens file with an alias as var(--x)", () => {
  const css = generateTokensCss({
    "gray-50": { kind: "color", values: { light: "#f9fafb", dark: "#030712" } },
    background: { kind: "color", values: { light: "var(--gray-50)", dark: "#0b0b0f" } },
  }, { tailwind: true, baseTheme: "light" });
  expect(css).toContain("--background: var(--gray-50);");
  expect(css).toContain("--background: #0b0b0f;");
  expect(css).toContain("--color-background: var(--background);");
});
