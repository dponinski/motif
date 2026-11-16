import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memoryReader, memorySource, scanRepository } from "../repo-scan";
import { readRepoTokens } from "../token-sync/doc";
import { buildGraph } from "./graph";
import { channelForms, tailwind3Extend, tokenOverrides } from "./overrides";
import { buildSrcdoc, runtimeUrlFor } from "./srcdoc";
import { findTailwindConfig, isTailwind3Module, tailwind3Url } from "./tailwind3";

const files = loadFixture("motif-test-system-v3");
const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" }, {});
const graph = await buildGraph({
  reader: memoryReader(files), repo: "a/b", ref: "main", entry: "src/components/Button.tsx", paths: Object.keys(files),
  tailwindEntry: analysis.tailwindEntry, tailwindVersion: 3, styleFiles: analysis.styleFiles,
});

describe("a Tailwind 3 repository's page", () => {
  it("takes @tailwind base for the entry of Tailwind's stylesheet", () => {
    expect(analysis.tailwindEntry).toBe("src/styles/globals.css");
  });

  it("runs the config as a module, with what the bundle provides left out of the packages to load", () => {
    expect(graph.tailwindConfig).toBe("tailwind.config.js");
    expect(graph.modules["tailwind.config.js"]).toBeDefined();
    expect(graph.bare).not.toContain("tailwindcss-animate");
    expect(graph.unsupported).toEqual([]);
  });

  it("keeps the stylesheet's directives for the page to build", () => {
    expect(graph.css.map((c) => c.path)).toEqual(["src/styles/globals.css"]);
    expect(graph.css[0].text).toContain("@tailwind base;");
  });

  it("builds the page around an engine file instead of the v4 browser build", () => {
    const html = buildSrcdoc({ graph, tailwindVersion: 3, runtimeUrl: runtimeUrlFor("https://motif.test"), nonce: "n0nce" });
    expect(html).toContain('src="https://motif.test/motif-tailwind3.js"');
    expect(html).toContain('<style id="motif-tw3"></style>');
    expect(html).not.toContain("@tailwindcss/browser");
    expect(html).not.toContain("text/tailwindcss");
    const data = JSON.parse(/<script type="application\/json" id="motif-data">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(data.tailwind3.config).toBe("tailwind.config.js");
    expect(data.tailwind3.css[0].text).toContain("@tailwind base;");
    // The CDN is asked for none of the config's own packages.
    expect(Object.keys(data.externals).some((s) => isTailwind3Module(s))).toBe(false);
  });

  it("can't be a page that has to run without Motif, which the engine file would be missing from", () => {
    expect(() => buildSrcdoc({ graph, tailwindVersion: 3, runtimeUrl: "", nonce: "n", runtimeSource: "//" })).toThrow(/can't be exported/);
  });

  it("finds the config nearest the root", () => {
    expect(findTailwindConfig(["apps/web/tailwind.config.ts", "tailwind.config.js", "x/tailwind.config.mjs"])).toBe("tailwind.config.js");
    expect(findTailwindConfig(["src/a.ts"])).toBeNull();
    expect(tailwind3Url("http://localhost:3000/motif-preview-runtime.js")).toBe("http://localhost:3000/motif-tailwind3.js");
  });
});

describe("Motif's token changes in a Tailwind 3 preview", () => {
  const snapshot = readRepoTokens(analysis.tokens, analysis.themes);
  const link = { repo: "a/b", branch: "main", base: snapshot.doc, baseTheme: snapshot.baseTheme };
  const doc = () => structuredClone(link.base);
  const theme = link.baseTheme;

  it("writes a color the config wraps in hsl() as the channels the variable holds", () => {
    const current = doc();
    current.primary.values[theme] = "#ff0000";
    const { css } = tokenOverrides(current, link.base, theme, analysis.themes, channelForms(analysis.tokens));
    expect(css).toMatch(/--primary: 0 100% 50%;/);
    expect(tokenOverrides(current, link.base, theme, analysis.themes).css).toContain("--primary: #ff0000;");
  });

  it("gives the config entries for a changed value kept in the config and for a token only Motif has", () => {
    const current = doc();
    const radius = Object.keys(current).find((n) => current[n].kind === "radius");
    expect(radius).toBeDefined();
    current[radius!].values[theme] = "20";
    current["brand"] = { kind: "color", values: { [theme]: "#336699" } };
    current["radius-pill"] = { kind: "radius", values: { [theme]: "999" } };
    const extend = tailwind3Extend(current, link.base, theme, analysis.tokens);
    expect(extend.colors.brand).toBe("hsl(var(--brand))");
    expect(extend.borderRadius["pill"]).toMatch(/999px|62\.4375rem/);
    // A variable the config wraps is shown by the variable alone.
    expect(extend.colors.primary).toBeUndefined();
    expect(JSON.stringify(extend)).toContain("20px");
  });

  it("is empty when nothing changed", () => {
    expect(tailwind3Extend(doc(), link.base, theme, analysis.tokens)).toEqual({});
  });
});
