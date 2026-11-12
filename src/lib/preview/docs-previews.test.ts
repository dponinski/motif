import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memoryReader, memorySource, scanRepository } from "../repo-scan";
import { buildGraph } from "./graph";
import { toLibrary } from "./library";
import { previewMessage, previewPage } from "./docs-previews";

describe("previews for documentation pages", async () => {
  const files = loadFixture("motif-test-system");
  const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" });
  const library = toLibrary(analysis.components);
  const button = library.find((c) => c.name === "Button")!;
  const card = library.find((c) => c.name === "Card")!;
  const graph = await buildGraph({ reader: memoryReader(files), repo: "a/b", ref: "main", entry: button.file, paths: Object.keys(files), tailwindEntry: analysis.tailwindEntry, tailwindVersion: 4, styleFiles: analysis.styleFiles });

  it("shows one component as big as it is, or all its variants in a grid", () => {
    const single = previewMessage(button, "single");
    expect(single).toMatchObject({ layout: "bare", fit: true, dark: false, overrides: "" });
    expect(single.items).toHaveLength(1);
    expect(single.items[0]).toMatchObject({ path: "src/components/Button.tsx", exportName: "Button" });
    const all = previewMessage(button, "variants");
    expect(all).toMatchObject({ layout: "grid", fit: false });
    expect(all.items).toHaveLength(20);
    expect(all.items.every((i) => typeof i.label === "string")).toBe(true);
  });

  it("falls back to the single view for a component with no variants", () => {
    expect(card.variants).toHaveLength(0);
    const msg = previewMessage(card, "variants");
    expect(msg.items).toHaveLength(1);
    expect(msg).toMatchObject({ layout: "bare", fit: true });
  });

  it("makes a page that runs on its own: runtime inline, and told what to show", () => {
    const runtimeSource = "/* runtime */ window.__ran = true; // a </script> in it must not end the tag";
    const page = previewPage({ graph, tailwindVersion: 4, runtimeSource, component: button, view: "variants" });
    expect(page).toContain("window.__ran = true;");
    expect(page).not.toMatch(/<script[^>]*src="[^"]*motif-preview-runtime/);
    expect(page.match(/<\/script/gi)!.length).toBe(page.match(/<script/gi)!.length);
    expect(page).toContain('"initial":{"type":"render"');
    expect(page).toContain('"layout":"grid"');
    // No host is trusted for the runtime, since it isn't loaded from one.
    const csp = page.match(/Content-Security-Policy" content="([^"]+)"/)![1];
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).not.toMatch(/localhost|https:\/\/[^ ]*\.test/);
    expect(csp).toContain("connect-src 'none'");
  });

  it("is still the page it always was when asked for the other way", async () => {
    const { buildSrcdoc } = await import("./srcdoc");
    const normal = buildSrcdoc({ graph, tailwindVersion: 4, runtimeUrl: "http://localhost:3000/motif-preview-runtime.js", nonce: "abc" });
    expect(normal).toContain('src="http://localhost:3000/motif-preview-runtime.js"');
    expect(normal).toContain('"initial":null');
  });
});
