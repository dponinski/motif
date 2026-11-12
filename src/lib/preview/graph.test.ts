import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memoryReader, memorySource, scanRepository } from "../repo-scan";
import { buildGraph, packageName, type GraphInput } from "./graph";

async function graphOf(files: Record<string, string>, entry: string, extra: Partial<GraphInput> = {}) {
  const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" }, { tokensOnly: true });
  return buildGraph({
    reader: memoryReader(files), repo: "a/b", ref: "main", entry, paths: Object.keys(files),
    tailwindEntry: analysis.tailwindEntry, tailwindVersion: analysis.stack.tailwindVersion, styleFiles: analysis.styleFiles, ...extra,
  });
}

const pkg = (extra: Record<string, unknown> = {}) => JSON.stringify({ dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" }, ...extra });

describe("a component from the real design system", async () => {
  const files = loadFixture("motif-test-system");
  const graph = await graphOf(files, "src/components/Button.tsx");

  it("follows its imports and nothing else", () => {
    expect(Object.keys(graph.modules).sort()).toEqual(["src/components/Button.tsx", "src/lib/cn.ts"]);
    expect(graph.modules["src/components/Button.tsx"].imports).toEqual({ "../lib/cn": "src/lib/cn.ts" });
    expect(graph.unsupported).toEqual([]);
    expect(graph.warnings).toEqual([]);
  });

  it("collects the packages from the repository's own package.json", () => {
    expect(graph.bare).toEqual(["class-variance-authority", "clsx", "react", "tailwind-merge"]);
    expect(graph.deps).toEqual({
      "class-variance-authority": "^0.7.1", clsx: "^2.1.1", react: "^19.3.1", "react-dom": "^19.3.1", "tailwind-merge": "^3.7.0",
    });
  });

  it("brings Tailwind's stylesheet, which is imported by the app rather than the component", () => {
    expect(graph.css.map((c) => c.path)).toEqual(["src/styles/motif.css"]);
    expect(graph.css[0].text).toContain('@import "tailwindcss";');
  });

  it("compiles TypeScript and JSX to CommonJS", () => {
    const code = graph.modules["src/components/Button.tsx"].code;
    expect(code).toContain('require("react/jsx-runtime")');
    expect(code).toMatch(/require\(['"]\.\.\/lib\/cn['"]\)/);
    expect(code).not.toMatch(/\bimport\s+[{\w*]/);
    expect(code).not.toContain("ButtonHTMLAttributes");
  });

  it("follows the whole public API from the entry file", async () => {
    const all = await graphOf(files, "src/index.ts");
    expect(Object.keys(all.modules)).toHaveLength(14);
    expect(all.modules["src/index.ts"].imports["./components/Tabs"]).toBe("src/components/Tabs.tsx");
  });
});

describe("module graph edge cases", () => {
  it("handles cycles and aliases", async () => {
    const g = await graphOf({
      "package.json": pkg(),
      "src/a.tsx": `import { B } from "./b";\nexport const A = () => <B />;`,
      "src/b.tsx": `import { A } from "./a";\nimport { x } from "@/util/x";\nexport const B = () => <i>{x}{typeof A}</i>;`,
      "src/util/x.ts": `export const x: number = 1;`,
    }, "src/a.tsx");
    expect(Object.keys(g.modules).sort()).toEqual(["src/a.tsx", "src/b.tsx", "src/util/x.ts"]);
    expect(g.modules["src/b.tsx"].imports).toEqual({ "./a": "src/a.tsx", "@/util/x": "src/util/x.ts" });
  });

  it("gathers stylesheets imported by components and inlines their own imports", async () => {
    const g = await graphOf({
      "package.json": pkg({ devDependencies: { tailwindcss: "^4.0.0" } }),
      "src/app.css": '@import "tailwindcss";\n@import "./theme.css";\n.x { color: red; }',
      "src/theme.css": ":root { --c: #fff; }",
      "src/widget.css": ".w { margin: 0; }",
      "src/Widget.tsx": `import "./widget.css";\nexport const Widget = () => <b className="w" />;`,
    }, "src/Widget.tsx");
    expect(g.css.map((c) => c.path)).toEqual(["src/app.css", "src/widget.css"]);
    expect(g.css[0].text).toBe('@import "tailwindcss";\n:root { --c: #fff; }\n.x { color: red; }');
    expect(g.modules["src/Widget.tsx"].imports).toEqual({ "./widget.css": null });
  });

  it("without Tailwind, brings the repository's global stylesheets", async () => {
    const g = await graphOf({
      "package.json": pkg(),
      "src/base.css": "body { margin: 0; }",
      "src/Thing.tsx": `export const Thing = () => <p className="p" />;`,
    }, "src/Thing.tsx");
    expect(g.css.map((c) => c.path)).toEqual(["src/base.css"]);
  });

  it("says what it cannot run instead of failing mysteriously", async () => {
    const files = (body: string, extra: Record<string, string> = {}) => ({ "package.json": pkg(), "src/T.tsx": body, ...extra });
    expect((await graphOf(files(`import s from "./t.module.css";\nexport const T = () => <i className={s.a} />;`, { "src/t.module.css": ".a{}" }), "src/T.tsx")).unsupported)
      .toEqual(["CSS modules can't be previewed yet"]);
    expect((await graphOf(files(`import "./t.scss";\nexport const T = () => <i />;`, { "src/t.scss": "a{b{c:d}}" }), "src/T.tsx")).unsupported)
      .toEqual(["SCSS stylesheets can't be previewed yet"]);
    expect((await graphOf(files(`import Image from "next/image";\nexport const T = () => <Image />;`), "src/T.tsx")).unsupported)
      .toEqual(["src/T.tsx imports `next/image`; Next.js modules can't be previewed yet"]);
    expect((await graphOf(files(`import fs from "fs";\nexport const T = () => <i>{typeof fs}</i>;`), "src/T.tsx")).unsupported)
      .toEqual(["src/T.tsx uses Node's `fs`, which isn't available in a browser"]);
  });

  it("warns about imports it cannot find, and names the file that does not compile", async () => {
    const missing = await graphOf({ "package.json": pkg(), "src/T.tsx": `import { nope } from "./nope";\nexport const T = () => <i>{nope}</i>;` }, "src/T.tsx");
    expect(missing.warnings).toEqual(["Couldn't find ./nope imported by src/T.tsx"]);
    await expect(graphOf({ "package.json": pkg(), "src/T.tsx": `export const T = () => <i ;` }, "src/T.tsx")).rejects.toThrow(/Could not parse src\/T\.tsx: Unexpected token/);
    await expect(graphOf({ "package.json": pkg(), "src/T.tsx": `import { B } from "./B";\nexport const T = () => <B />;`, "src/B.tsx": `const = ;` }, "src/T.tsx")).rejects.toThrow(/Could not parse src\/B\.tsx/);
  });

  it("turns JSON and assets into modules", async () => {
    const g = await graphOf({
      "package.json": pkg(),
      "src/data.json": '{"a":1}',
      "src/logo.svg": "<svg/>",
      "src/T.tsx": `import data from "./data.json";\nimport logo from "./logo.svg";\nexport const T = () => <img src={logo} alt={String(data.a)} />;`,
    }, "src/T.tsx");
    expect(g.modules["src/data.json"].code).toBe('module.exports = {"a":1};');
    expect(g.modules["src/logo.svg"].code).toBe('module.exports = "https://raw.githubusercontent.com/a/b/main/src/logo.svg";');
  });

  it("uses the nearest package.json for versions in a monorepo", async () => {
    const g = await graphOf({
      "package.json": pkg({ dependencies: { react: "^17.0.0", clsx: "^1.0.0" } }),
      "packages/ui/package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "packages/ui/src/T.tsx": `import clsx from "clsx";\nexport const T = () => <i className={clsx("a")} />;`,
    }, "packages/ui/src/T.tsx");
    expect(g.deps).toMatchObject({ react: "^19.0.0", clsx: "^1.0.0" });
  });

  it("refuses graphs that are too big", async () => {
    const files: Record<string, string> = { "package.json": pkg() };
    for (let i = 0; i < 6; i++) files[`src/m${i}.tsx`] = `${i ? `import "./m${i - 1}";` : ""}\nexport const M${i} = () => <i />;`;
    files["src/m5.tsx"] = `import "./m4";\nexport const M5 = () => <i />;`;
    await expect(graphOf(files, "src/m5.tsx", { limits: { files: 3 } })).rejects.toThrow(/more than 3 files/);
    await expect(graphOf(files, "src/m5.tsx", { limits: { bytes: 40 } })).rejects.toThrow(/KB of code/);
  });

  it("names the package of a specifier", () => {
    expect([packageName("clsx"), packageName("lucide-react/icons"), packageName("@radix-ui/react-dialog"), packageName("@radix-ui/react-dialog/sub")])
      .toEqual(["clsx", "lucide-react", "@radix-ui/react-dialog", "@radix-ui/react-dialog"]);
  });
});
