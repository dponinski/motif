import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import { toLibrary } from "../preview/library";
import { analyze } from "./element";
import { importEdits, relativeSpecifier } from "./imports";
import { changeTag, insertElement, unwrapElement, wrapElement } from "./insert";
import { componentSnippet, SNIPPETS } from "./snippets";

const code = [
  'import { useState } from "react";',
  "",
  "export function A() {",
  "  return (",
  '    <div className="flex">',
  "      <h1>Title</h1>",
  "      <p>One</p>",
  "      <ul>",
  "        <li>a</li>",
  "      </ul>",
  "      <span />",
  "      <b></b>",
  "    </div>",
  "  );",
  "}",
  "",
].join("\n");
const P = "src/components/A.tsx";
const at = (opening: string) => code.indexOf(opening);
const at2 = (text: string, opening: string, nth = 0) => { let i = -1; for (let n = 0; n <= nth; n++) i = text.indexOf(opening, i + 1); return i; };

describe("inserting an element", () => {
  const jsx = '<p className="x">New</p>';

  it("adds before and after a sibling, on its own line with the sibling's indentation", async () => {
    const before = await insertElement(P, code, at("<p>One"), "before", jsx);
    expect(before.code).toContain('      <h1>Title</h1>\n      <p className="x">New</p>\n      <p>One</p>');
    expect(before.code.slice(before.selection!, before.selection! + 3)).toBe("<p ");
    const after = await insertElement(P, code, at("<p>One"), "after", jsx);
    expect(after.code).toContain('      <p>One</p>\n      <p className="x">New</p>\n      <ul>');
    expect(after.code.slice(after.selection!, after.selection! + 3)).toBe("<p ");
    expect(after.summary).toBe("p: added <p> after");
  });

  it("adds as the last or first child, keeping the closing tag where it was", async () => {
    const last = await insertElement(P, code, at("<ul>"), "last-child", jsx);
    expect(last.code).toContain("        <li>a</li>\n        <p className=\"x\">New</p>\n      </ul>");
    expect(last.code.slice(last.selection!, last.selection! + 3)).toBe("<p ");
    const first = await insertElement(P, code, at("<ul>"), "first-child", jsx);
    expect(first.code).toContain('      <ul>\n        <p className="x">New</p>\n        <li>a</li>');
    expect(first.code.slice(first.selection!, first.selection! + 3)).toBe("<p ");
  });

  it("fills an empty element and opens a self-closing one", async () => {
    const empty = await insertElement(P, code, at("<b></b>"), "last-child", jsx);
    expect(empty.code).toContain('      <b>\n        <p className="x">New</p>\n      </b>');
    const closed = await insertElement(P, code, at("<span />"), "last-child", jsx);
    expect(closed.code).toContain('      <span>\n        <p className="x">New</p>\n      </span>');
    expect(closed.code.slice(closed.selection!, closed.selection! + 3)).toBe("<p ");
  });

  it("re-indents a snippet of several lines", async () => {
    const list = SNIPPETS.find((s) => s.id === "list")!.jsx;
    const out = await insertElement(P, code, at("<p>One"), "after", list);
    expect(out.code).toContain('      <p>One</p>\n      <ul className="flex flex-col gap-1">\n        <li>Item</li>\n        <li>Item</li>\n      </ul>\n      <ul>');
  });

  it("puts a new element inline when the target is inline", async () => {
    const inline = "export const B = () => (<div><b>x</b></div>);";
    const out = await insertElement("B.tsx", inline, inline.indexOf("<b>"), "after", "<i>y</i>");
    expect(out.code).toContain("<b>x</b><i>y</i>");
    const inside = await insertElement("B.tsx", inline, inline.indexOf("<b>"), "last-child", "<i>y</i>");
    expect(inside.code).toContain("<b>x<i>y</i></b>");
  });

  it("refuses what would make invalid JSX", async () => {
    await expect(insertElement(P, code, at('<div className="flex">'), "after", jsx)).rejects.toThrow(/inside a parent element/);
    const img = "export const C = () => (<div><img src='a' /></div>);";
    await expect(insertElement("C.tsx", img, img.indexOf("<img"), "last-child", jsx)).rejects.toThrow(/can't contain/);
  });
});

describe("imports", () => {
  it("writes the specifier from one file to another", () => {
    expect(relativeSpecifier("src/components/A.tsx", "src/components/Badge.tsx")).toBe("./Badge");
    expect(relativeSpecifier("src/pages/A.tsx", "src/components/Badge.tsx")).toBe("../components/Badge");
    expect(relativeSpecifier("src/A.tsx", "src/components/Badge.tsx")).toBe("./components/Badge");
    expect(relativeSpecifier("src/components/A.tsx", "src/components/ui/index.ts")).toBe("./ui");
    expect(relativeSpecifier("A.tsx", "src/Badge.tsx")).toBe("./src/Badge");
  });

  it("adds an import after the last one, in the file's style", async () => {
    const single = "import { useState } from 'react';\nimport x from './x';\n\nexport const A = () => null;\n";
    const { edits, local } = await importEdits("src/A.tsx", single, { name: "Badge", file: "src/Badge.tsx", exported: "named" });
    expect(local).toBe("Badge");
    expect(edits[0].text).toBe("\nimport { Badge } from './Badge';");
    const bare = await importEdits("src/A.tsx", "export const A = () => null;\n", { name: "Badge", file: "src/Badge.tsx", exported: "default" });
    expect(bare.edits[0].text).toBe('import Badge from "./Badge";\n\n');
    const noSemi = await importEdits("src/A.tsx", 'import x from "./x"\n', { name: "Badge", file: "src/Badge.tsx", exported: "named" });
    expect(noSemi.edits[0].text).toBe('\nimport { Badge } from "./Badge"');
  });

  it("joins an existing import of the same module, however it is spelled", async () => {
    const existing = 'import { Card } from "./ui/Card";\nimport { Other } from "./ui";\n';
    const added = await importEdits("src/A.tsx", existing, { name: "CardTitle", file: "src/ui/Card.tsx", exported: "named" });
    expect(added.edits).toEqual([{ start: 13, end: 13, text: ", CardTitle" }]);
    const have = await importEdits("src/A.tsx", existing, { name: "Card", file: "src/ui/Card.tsx", exported: "named" });
    expect(have).toEqual({ edits: [], local: "Card" });
    const viaIndex = await importEdits("src/A.tsx", existing, { name: "Tabs", file: "src/ui/index.ts", exported: "named" });
    expect(viaIndex.edits).toHaveLength(1);
    expect(viaIndex.edits[0].text).toBe(", Tabs");
  });

  it("refuses a name the file already uses for something else", async () => {
    await expect(importEdits("src/A.tsx", 'import { Badge } from "./other";\n', { name: "Badge", file: "src/Badge.tsx", exported: "named" })).rejects.toThrow(/already used/);
    await expect(importEdits("src/A.tsx", "const Badge = 1;\n", { name: "Badge", file: "src/Badge.tsx", exported: "named" })).rejects.toThrow(/already used/);
  });

  it("inserts a library component with its import and selects it", async () => {
    const files = loadFixture("motif-test-system");
    const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" });
    const badge = toLibrary(analysis.components).find((c) => c.name === "Badge")!;
    const snippet = componentSnippet(badge);
    expect(snippet.jsx).toMatch(/^<Badge[^>]*>.*<\/Badge>$|^<Badge[^>]* \/>$/);
    expect(snippet.imp).toEqual({ name: "Badge", file: "src/components/Badge.tsx", exported: "named" });
    const out = await insertElement("src/pages/Page.tsx", 'import { useState } from "react";\n\nexport const P = () => (\n  <div>\n    <p>a</p>\n  </div>\n);\n', 'import { useState } from "react";\n\nexport const P = () => (\n  <div>\n    <p>a</p>\n  </div>\n);\n'.indexOf("<p>"), "after", snippet.jsx, snippet.imp);
    expect(out.code).toContain('import { Badge } from "../components/Badge";');
    expect(out.code).toContain(`    <p>a</p>\n    ${snippet.jsx}\n  </div>`);
    expect(out.code.slice(out.selection!, out.selection! + 6)).toBe("<Badge");
    const info = await analyze("src/pages/Page.tsx", out.code, out.selection!);
    expect(info?.tag).toBe("Badge");
  });

  it("makes a component snippet from the props it needs", async () => {
    const files = loadFixture("motif-test-system");
    const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" });
    const lib = toLibrary(analysis.components);
    expect(componentSnippet(lib.find((c) => c.name === "Button")!).jsx).toBe("<Button>Button</Button>");
    expect(componentSnippet(lib.find((c) => c.name === "Input")!).jsx).toMatch(/^<Input[^>]*\/>$/);
  });
});

describe("wrapping and unwrapping", () => {
  it("wraps an element, keeping its indentation and everything inside", async () => {
    const out = await wrapElement(P, code, at("<ul>"), "div", "flex gap-2");
    expect(out.code).toContain('      <div className="flex gap-2">\n        <ul>\n          <li>a</li>\n        </ul>\n      </div>\n      <span />');
    expect(out.selection).toBe(at("<ul>"));
    expect(out.code.slice(out.selection!, out.selection! + 4)).toBe("<div");
    expect(out.summary).toBe("ul: wrapped in <div>");
  });

  it("wraps the root of what a component returns", async () => {
    const out = await wrapElement(P, code, at('<div className="flex">'), "section", null);
    expect(out.code).toContain("    <section>\n      <div className=\"flex\">\n        <h1>Title</h1>");
    expect(out.code).toContain("      </div>\n    </section>\n  );");
  });

  it("wraps inline, and in a library component with its import", async () => {
    const inline = "export const B = () => (<div><b>x</b></div>);";
    expect((await wrapElement("B.tsx", inline, inline.indexOf("<b>"), "i", null)).code).toContain("<div><i><b>x</b></i></div>");
    const imp = await wrapElement(P, code, at("<p>One"), "Card", null, { name: "Card", file: "src/components/Card.tsx", exported: "named" });
    expect(imp.code).toContain('import { Card } from "./Card";');
    expect(imp.code).toContain("      <Card>\n        <p>One</p>\n      </Card>");
    expect(imp.code.slice(imp.selection!, imp.selection! + 5)).toBe("<Card");
  });

  it("takes a wrapper off, and is undone by wrapping again", async () => {
    const wrapped = await wrapElement(P, code, at("<ul>"), "div", "flex gap-2");
    const back = await unwrapElement(P, wrapped.code, wrapped.selection!);
    expect(back!.code).toBe(code);
    expect(await unwrapElement(P, code, at('<div className="flex">'))).toBeNull();
    expect(await unwrapElement(P, code, at("<p>One"))).toBeNull();
  });
});

describe("changing the tag", () => {
  it("renames the opening and closing tag, keeping everything else", async () => {
    const out = (await changeTag(P, code, at("<ul>"), "ol"))!;
    expect(out.code).toContain("      <ol>\n        <li>a</li>\n      </ol>");
    expect(out.summary).toBe("ul: now <ol>");
    expect(out.selection).toBe(at("<ul>"));
    const root = (await changeTag(P, code, at('<div className="flex">'), "section"))!;
    expect(root.code).toContain('<section className="flex">');
    expect(root.code).toContain("    </section>");
  });

  it("handles self-closing elements, no-ops and refusals", async () => {
    const self = (await changeTag(P, code, at("<span />"), "i"))!;
    expect(self.code).toContain("      <i />");
    expect((await changeTag(P, code, at("<ul>"), "ul"))!.code).toBe(code);
    await expect(changeTag(P, code, at("<ul>"), "Not Valid")).rejects.toThrow(/isn't an HTML element/);
    await expect(changeTag(P, code, at("<ul>"), "img")).rejects.toThrow(/can't contain/);
    expect(at2(code, "<p>")).toBeGreaterThan(0);
  });
});
