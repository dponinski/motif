import { describe, expect, it } from "vitest";
import { loadFixture } from "./repo-scan/fixtures";
import { memorySource, scanRepository } from "./repo-scan";
import { toLibrary } from "./preview/library";
import { blockHtml, renderDocsSite, type DocsContext } from "./docs-html";
import { createBlock, docSections, isBuiltInPage, pageRepoRef, previewKey, repoPageId, BLOCK_TYPES } from "./docs";
import type { DocBlock } from "./motif-document";

describe("documenting repository components", async () => {
  const files = loadFixture("motif-test-system");
  const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" });
  const library = toLibrary(analysis.components);
  const button = library.find((c) => c.name === "Button")!;
  const card = library.find((c) => c.name === "Card")!;
  const ctx = (previews?: Record<string, string>): DocsContext => ({
    components: [],
    tokens: { colors: [], typography: [], spacing: [], radii: [], shadows: [] },
    repo: { components: library, previews },
  });
  const refOf = (c: { file: string; name: string }) => ({ file: c.file, name: c.name });

  describe("pages", () => {
    const repo = library.map((c) => ({ ...refOf(c), hasVariants: c.variants.length > 0 }));

    it("gives every imported component a page, in its own section, after the others", () => {
      const sections = docSections([], [], repo);
      expect(sections.map((s) => s.title)).toEqual(["Pages", "Foundations", "Components", "Repository components"]);
      const pages = sections[3].pages;
      expect(pages).toHaveLength(library.length);
      expect(pages[0].id).toBe(repoPageId(refOf(library[0])));
      expect(pages.every((p) => isBuiltInPage(p.id))).toBe(true);
    });

    it("has no section when nothing is imported", () => {
      expect(docSections([], [], []).map((s) => s.title)).toEqual(["Pages", "Foundations", "Components"]);
      expect(docSections([], []).map((s) => s.title)).toEqual(["Pages", "Foundations", "Components"]);
    });

    it("starts a page with a preview of every variant when there are variants, and the props and usage", () => {
      const page = docSections([], [], repo)[3].pages.find((p) => p.title === "Button")!;
      expect(page.blocks.map((b) => b.type)).toEqual(["text", "repo-preview", "repo-props", "repo-code"]);
      expect(page.blocks[1]).toMatchObject({ view: "variants", ref: refOf(button) });
      const plain = docSections([], [], repo)[3].pages.find((p) => p.title === "Card")!;
      expect(plain.blocks[1]).toMatchObject({ view: "single" });
    });

    it("uses what was stored for a page in place of the default, found by where the component is declared", () => {
      const stored = { id: repoPageId(refOf(button)), title: "Whatever", blocks: [{ id: "x", type: "text" as const, text: "Hello" }] };
      const page = docSections([stored], [], repo)[3].pages.find((p) => p.id === stored.id)!;
      expect(page.blocks).toEqual(stored.blocks);
      expect(page.title).toBe("Button");
    });

    it("reads a component back from its page's id, however odd the path", () => {
      for (const ref of [refOf(button), { file: "src/a b/Weird (1).tsx", name: "Weird" }, { file: "a::b.tsx", name: "C" }]) {
        expect(pageRepoRef(repoPageId(ref))).toEqual(ref);
      }
      expect(pageRepoRef("doc-comp-x")).toBeNull();
      expect(pageRepoRef("doc-repo-nope")).toBeNull();
    });

    it("lets the designer add a block of each kind, for the component the page is about", () => {
      for (const type of ["repo-preview", "repo-props", "repo-code"] as const) {
        expect(BLOCK_TYPES.some((b) => b.type === type)).toBe(true);
        expect(createBlock(type, "b", "", refOf(button))).toMatchObject({ type, ref: refOf(button) });
      }
      expect(createBlock("repo-preview", "b", "", refOf(button))).toMatchObject({ view: "single" });
    });
  });

  describe("blocks", () => {
    const block = (type: "repo-preview" | "repo-props" | "repo-code", ref = refOf(button), view: "single" | "variants" = "variants"): DocBlock =>
      type === "repo-preview" ? { id: "b", type, ref, view } : { id: "b", type, ref };

    it("lists the props with their types, defaults and the options of a variant", () => {
      const html = blockHtml(block("repo-props"), ctx());
      expect(html).toContain("<th>Prop</th><th>Type</th><th>Default</th><th>Description</th>");
      expect(html).toContain("<code>loading</code>");
      expect(html).toMatch(/<code class="md-chip">danger<\/code>/);
      expect(html).toContain("<code>primary</code>");
    });

    it("writes usage code with the import and the variants each can be", () => {
      const html = blockHtml(block("repo-code"), ctx());
      expect(html).toContain("import { Button } from &quot;./src/components/Button&quot;;");
      expect(html).toContain("// variant: primary | secondary | outline | ghost | danger (default primary)");
      expect(html).toContain("&lt;Button&gt;Button&lt;/Button&gt;");
    });

    it("says why a preview isn't running, and runs it when there is a page for it", () => {
      const none = blockHtml(block("repo-preview"), ctx());
      expect(none).toContain("runs here when the page is shown or exported from Motif");
      expect(none).not.toContain("<iframe");
      const page = '<!doctype html><script>alert("a & b")</script>';
      const live = blockHtml(block("repo-preview"), ctx({ [previewKey(refOf(button), "variants")]: page }));
      expect(live).toContain('sandbox="allow-scripts"');
      expect(live).not.toContain("allow-same-origin");
      expect(live).toContain("srcdoc=\"&lt;!doctype html&gt;&lt;script&gt;alert(&quot;a &amp; b&quot;)&lt;/script&gt;\"");
      // The same component shown the other way is a different preview.
      expect(blockHtml(block("repo-preview", refOf(button), "single"), ctx({ [previewKey(refOf(button), "variants")]: page }))).not.toContain("<iframe");
    });

    it("says so when the component isn't imported, or no repository is", () => {
      expect(blockHtml(block("repo-props", { file: "x.tsx", name: "Gone" }), ctx())).toContain("Gone isn&#39;t among the imported repository components.");
      expect(blockHtml(block("repo-props"), { ...ctx(), repo: undefined })).toContain("Connect and import the repository");
      expect(blockHtml(block("repo-props", refOf(card)), ctx())).toContain("Card has no props of its own.");
    });

    it("escapes what a component's own props say", () => {
      const evil = { ...button, name: "<b>x</b>", props: [{ name: "a<script>", type: "x\"y", required: true, default: "<i>", description: "<img onerror=1>", options: null }], variants: [] };
      const html = blockHtml({ id: "b", type: "repo-props", ref: { file: button.file, name: "<b>x</b>" } }, { ...ctx(), repo: { components: [evil] } });
      expect(html).not.toMatch(/<script|<img|<i>/);
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("the exported site", () => {
    const sections = docSections([], [], [{ ...refOf(button), hasVariants: true }]);
    const previews = { [previewKey(refOf(button), "variants")]: "<!doctype html><p>x</p>" };

    it("carries the small script that sizes each live preview, only when there are some", () => {
      const withPreviews = renderDocsSite("DS", sections, ctx(previews));
      expect(withPreviews).toContain("iframe[data-md-live]");
      expect((withPreviews.match(/<script>/g) ?? []).length).toBe(1);
      expect(renderDocsSite("DS", sections, ctx())).not.toContain("<script>");
    });

    it("lists the repository components in its navigation", () => {
      const html = renderDocsSite("DS", sections, ctx(previews));
      expect(html).toContain("Repository components");
      expect(html).toContain(`href="#${repoPageId(refOf(button))}"`);
    });
  });
});
