import { describe, expect, it } from "vitest";
import type { CanvasElement } from "../store/canvas";
import { componentPageId, docSections } from "./docs";
import { blockHtml, renderDocsSite, sceneToSvg, type DocsContext } from "./docs-html";
import {
  mergeDocuments,
  parseDocument,
  serializeDocument,
  type DocPage,
  type DocumentComponent,
  type MotifDocument,
} from "./motif-document";

const el = (id: string, extra: Partial<CanvasElement> = {}): CanvasElement => ({
  id, type: "rectangle", name: id, x: 0, y: 0, width: 10, height: 10, fill: "#000000", opacity: 1, rotation: 0, ...extra,
});

const component = (extra: Partial<DocumentComponent> = {}): DocumentComponent => ({
  id: "btn", name: "Button", groupId: null, variantProps: [], elements: {}, order: [], ...extra,
});

const context = (components: DocumentComponent[] = [component()]): DocsContext => ({
  components,
  tokens: {
    colors: [{ id: "c1", name: "primary-500", value: "#6366f1", group: "primary", setId: "s", themeValues: {} }],
    typography: [],
    spacing: [{ id: "sp", name: "space-4", value: 16, setId: "s" }],
    radii: [],
    shadows: [],
  },
});

const page = (blocks: DocPage["blocks"], id = "p1", title = "Intro"): DocPage => ({ id, title, blocks });

const doc = (docs: DocPage[]): MotifDocument => ({
  motif: 1, id: "file1", name: "Design", componentGroups: [], components: [component()], docs,
});

describe("docs in the document format", () => {
  it("leaves docs out of the file while there are none", () => {
    expect(serializeDocument(doc([]))).not.toContain('"docs"');
    expect(parseDocument(serializeDocument(doc([]))).docs).toEqual([]);
  });

  it("round-trips pages and blocks", () => {
    const d = doc([page([{ id: "b1", type: "heading", text: "Usage" }, { id: "b2", type: "guideline", do: "Be clear", dont: "Be vague" }])]);
    expect(parseDocument(serializeDocument(d))).toEqual(d);
  });

  it("drops blocks it does not understand instead of failing", () => {
    const raw = JSON.parse(serializeDocument(doc([page([{ id: "b1", type: "text", text: "ok" }])])));
    raw.docs[0].blocks.push({ id: "b2", type: "video", src: "x" }, { id: "b3", type: "text" }, "junk");
    expect(parseDocument(JSON.stringify(raw)).docs[0].blocks).toEqual([{ id: "b1", type: "text", text: "ok" }]);
  });

  it("merges edits to different blocks and reports edits to the same one", () => {
    const base = doc([page([{ id: "b1", type: "text", text: "one" }, { id: "b2", type: "text", text: "two" }])]);
    const edit = (blockId: string, text: string) => {
      const copy = structuredClone(base);
      const block = copy.docs[0].blocks.find((b) => b.id === blockId)!;
      if (block.type === "text") block.text = text;
      return copy;
    };

    const clean = mergeDocuments(base, edit("b1", "mine"), edit("b2", "theirs"));
    expect(clean.conflicts).toEqual([]);
    expect(clean.merged.docs[0].blocks).toMatchObject([{ text: "mine" }, { text: "theirs" }]);

    const clash = mergeDocuments(base, edit("b1", "mine"), edit("b1", "theirs"));
    expect(clash.conflicts.map((c) => c.label)).toEqual(["Docs › Intro · content"]);
  });
});

describe("docSections", () => {
  it("gives every token category and component a default page", () => {
    const [own, foundations, components] = docSections([], [{ id: "btn", name: "Button" }]);
    expect(own.pages).toEqual([]);
    expect(foundations.pages.map((p) => p.title)).toEqual(["Colors", "Typography", "Spacing", "Radius", "Shadows"]);
    expect(components.pages[0]).toMatchObject({ id: componentPageId("btn"), title: "Button" });
    expect(components.pages[0].blocks.map((b) => b.type)).toEqual(["text", "preview", "props", "code"]);
  });

  it("uses a stored page over the default and keeps the component's current name", () => {
    const stored = page([{ id: "x", type: "heading", text: "Custom" }], componentPageId("btn"), "Old name");
    const sections = docSections([stored, page([], "mine", "Principles")], [{ id: "btn", name: "Button" }]);
    expect(sections[0].pages.map((p) => p.title)).toEqual(["Principles"]);
    expect(sections[2].pages[0]).toMatchObject({ title: "Button", blocks: stored.blocks });
  });
});

describe("sceneToSvg", () => {
  it("returns nothing for an empty or fully hidden scene", () => {
    expect(sceneToSvg(component(), context())).toBe("");
    const hidden = component({ elements: { a: el("a", { visible: false }) }, order: ["a"] });
    expect(sceneToSvg(hidden, context())).toBe("");
  });

  it("places children relative to their parent and fits the view box to the scene", () => {
    const scene = component({
      elements: {
        f: el("f", { type: "frame", x: 100, y: 50, width: 200, height: 100, children: ["c"] }),
        c: el("c", { parentId: "f", x: 20, y: 10, width: 40, height: 30, fillTokenId: "c1" }),
      },
      order: ["f"],
    });
    const svg = sceneToSvg(scene, context());
    expect(svg).toContain('viewBox="100 50 200 100"');
    expect(svg).toContain('<rect x="120" y="60" width="40" height="30" rx="0" fill="#6366f1"');
  });

  it("escapes text and refuses unsafe style values", () => {
    const scene = component({
      elements: {
        t: el("t", { type: "text", content: '<img src=x onerror="alert(1)">', fontColor: "red;background:url(//evil)" }),
        r: el("r", { fill: '"/><script>alert(1)</script>' }),
      },
      order: ["t", "r"],
    });
    const svg = sceneToSvg(scene, context());
    expect(svg).not.toContain("<img");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("evil");
    expect(svg).toContain("&lt;img");
  });
});

describe("blockHtml", () => {
  it("renders a props table and usage code from variant props", () => {
    const btn = component({ variantProps: [{ id: "p", name: "size", values: ["sm", "md"], default: "md" }] });
    const ctx = context([btn]);
    expect(blockHtml({ id: "b", type: "props", componentId: "btn" }, ctx)).toContain('<code class="md-chip">sm</code>');
    const code = blockHtml({ id: "b", type: "code", componentId: "btn" }, ctx);
    expect(code).toContain("interface ButtonProps");
    expect(code).toContain("&lt;Button size=&quot;md&quot; /&gt;");
  });

  it("explains missing components, empty canvases and empty token sets", () => {
    const ctx = context();
    expect(blockHtml({ id: "b", type: "preview", componentId: "gone" }, ctx)).toContain("no longer exists");
    expect(blockHtml({ id: "b", type: "preview", componentId: "btn" }, ctx)).toContain("nothing on its canvas");
    expect(blockHtml({ id: "b", type: "tokens", kind: "shadows" }, ctx)).toContain("No shadow tokens yet");
    expect(blockHtml({ id: "b", type: "tokens", kind: "colors" }, ctx)).toContain("primary-500");
  });

  it("escapes prose and splits it into paragraphs", () => {
    const html = blockHtml({ id: "b", type: "text", text: "One <b>\nstill one\n\nTwo" }, context());
    expect(html).toBe("<p>One &lt;b&gt;<br>still one</p><p>Two</p>");
  });
});

describe("renderDocsSite", () => {
  it("links every page from the navigation and skips empty blocks", () => {
    const d = doc([page([{ id: "b1", type: "text", text: "" }, { id: "b2", type: "heading", text: "Voice & tone" }])]);
    const html = renderDocsSite("Acme <DS>", docSections(d.docs, d.components), context());
    expect(html).toContain("<title>Acme &lt;DS&gt; · Design system</title>");
    expect(html).toContain('<a href="#p1">Intro</a>');
    expect(html).toContain('<article id="p1"><h1>Intro</h1><div class="md-block"><h2>Voice &amp; tone</h2></div></article>');
    expect(html).toContain(`<article id="${componentPageId("btn")}">`);
    expect(html).not.toContain("<script");
  });
});
