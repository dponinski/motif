import { describe, expect, it } from "vitest";
import { docSections } from "./docs";
import { blockHtml, renderDocsSite, type DocsContext } from "./docs-html";
import type { DocPage } from "./motif-document";

const context = (): DocsContext => ({
  tokens: {
    colors: [{ id: "c1", name: "primary-500", value: "#6366f1", group: "primary", setId: "s", themeValues: {} }],
    typography: [],
    spacing: [{ id: "sp", name: "space-4", value: 16, setId: "s" }],
    radii: [],
    shadows: [],
  },
});

const page = (blocks: DocPage["blocks"], id = "p1", title = "Intro"): DocPage => ({ id, title, blocks });

describe("docSections", () => {
  it("gives every token category a default page and no component pages without a repository", () => {
    const [own, foundations, ...rest] = docSections([]);
    expect(own.pages).toEqual([]);
    expect(foundations.pages.map((p) => p.title)).toEqual(["Colors", "Typography", "Spacing", "Radius", "Shadows"]);
    expect(rest).toEqual([]);
  });

  it("uses a stored page over the default and keeps the designer's own pages first", () => {
    const stored = page([{ id: "x", type: "heading", text: "Custom" }], "doc-tokens-colors", "Old name");
    const sections = docSections([stored, page([], "mine", "Principles")]);
    expect(sections[0].pages.map((p) => p.title)).toEqual(["Principles"]);
    expect(sections[1].pages[0]).toMatchObject({ id: "doc-tokens-colors", blocks: stored.blocks });
  });
});

describe("blockHtml", () => {
  it("explains empty token sets and shows the ones there are", () => {
    const ctx = context();
    expect(blockHtml({ id: "b", type: "tokens", kind: "shadows" }, ctx)).toContain("No shadow tokens yet");
    expect(blockHtml({ id: "b", type: "tokens", kind: "colors" }, ctx)).toContain("primary-500");
  });

  it("escapes prose and splits it into paragraphs", () => {
    const html = blockHtml({ id: "b", type: "text", text: "One <b>\nstill one\n\nTwo" }, context());
    expect(html).toBe("<p>One &lt;b&gt;<br>still one</p><p>Two</p>");
  });

  it("says a repository component is missing when there is no repository", () => {
    expect(blockHtml({ id: "b", type: "repo-props", ref: { file: "a.tsx", name: "A" } }, context())).toContain("Connect and import");
  });
});

describe("renderDocsSite", () => {
  it("links every page from the navigation and skips empty blocks", () => {
    const docs = [page([{ id: "b1", type: "text", text: "" }, { id: "b2", type: "heading", text: "Voice & tone" }])];
    const html = renderDocsSite("Acme <DS>", docSections(docs), context());
    expect(html).toContain("<title>Acme &lt;DS&gt; · Design system</title>");
    expect(html).toContain('<a href="#p1">Intro</a>');
    expect(html).toContain('<article id="p1"><h1>Intro</h1><div class="md-block"><h2>Voice &amp; tone</h2></div></article>');
    expect(html).toContain('<article id="doc-tokens-colors">');
    expect(html).not.toContain("<script");
  });
});
