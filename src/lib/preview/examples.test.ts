import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memoryReader, memorySource, scanRepository } from "../repo-scan";
import { buildGraph } from "./graph";
import { findExamples, isExamplePath, type ExampleIndex } from "./examples";
import { componentId, toLibrary } from "./library";

async function examplesOf(files: Record<string, string>) {
  const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" });
  const components = toLibrary(analysis.components);
  const index = await findExamples({ reader: memoryReader(files), ref: "main", paths: Object.keys(files), components });
  return { analysis, components, index };
}

const forName = (index: ExampleIndex, name: string) => Object.entries(index).find(([k]) => k.endsWith(`::${name}`))?.[1] ?? [];

describe("examples from the real design system's demo", async () => {
  const files = loadFixture("motif-test-system");
  const { index, components, analysis } = await examplesOf(files);

  it("finds examples for the components the demo uses", () => {
    for (const name of ["Button", "Badge", "Alert", "Avatar", "Card", "Field", "Input", "Select", "Switch", "Checkbox", "Textarea", "Tabs", "Modal"]) {
      expect(forName(index, name).length, name).toBeGreaterThan(0);
    }
    expect(Object.keys(index).every((k) => components.some((c) => componentId(c) === k))).toBe(true);
  });

  it("only reads demo-like files", () => {
    expect(isExamplePath("demo/App.tsx")).toBe(true);
    expect(isExamplePath("src/Button.stories.tsx")).toBe(true);
    expect(isExamplePath("src/Button.test.tsx")).toBe(false);
    expect(isExamplePath("src/components/Button.tsx")).toBe(false);
    expect(isExamplePath("examples/node_modules/x/demo/a.tsx")).toBe(false);
    expect(new Set(Object.values(index).flat().map((e) => e.file))).toEqual(new Set(["demo/App.tsx"]));
  });

  it("shows each usage of a simple component with a heading naming what is special about it", () => {
    const titles = forName(index, "Button").map((e) => e.title);
    expect(titles).toContain("Button · variant: secondary");
    expect(titles).toContain("Button · variant: danger");
    expect(titles).toContain("Button · Primary");
    expect(forName(index, "Button")).toHaveLength(8);
  });

  it("shows the parts of a compound component inside their parent", () => {
    for (const name of ["Tabs", "TabsList", "TabsTrigger", "TabsContent"]) {
      const [first] = forName(index, name);
      expect(first.title, name).toBe("Tabs · defaultValue: overview");
      expect(first.code).toContain("<TabsTrigger");
      expect(first.code).toContain("<TabsContent");
    }
    // The card's parts come with the card.
    expect(forName(index, "CardTitle")[0].code).toMatch(/<Card>[\s\S]*<CardTitle>Create account<\/CardTitle>/);
  });

  it("leaves out what only exists while the demo runs", () => {
    const form = forName(index, "Card")[0];
    expect(form.code).not.toMatch(/\bemail\b\s*[=}]|emailError|setEmail/);
    expect(form.code).toContain('<Input type="email"');
    expect(form.code).toContain("onChange={() => {}}");
    expect(form.notes.join(" ")).toContain("error comes from the demo's state");
    expect(form.notes.join(" ")).toContain("value comes from the demo's state");
    // Plain props are untouched.
    expect(form.code).toContain('<Field label="Email" required');
  });

  it("opens an overlay that was controlled by state, and silences its handlers", () => {
    const [modal] = forName(index, "Modal");
    expect(modal.code).toContain("open={true}");
    expect(modal.code).not.toContain("setModalOpen");
    expect(modal.code).toContain("onClick={() => {}}");
    expect(modal.code).toContain("onClose={() => {}}");
  });

  it("carries only the imports the example uses, from the demo's own import lines", () => {
    const [button] = forName(index, "Button");
    expect(button.code.split("\n")[0]).toBe('import { Button } from "../src";');
    expect(button.code).toContain("export default function MotifExample()");
    expect(button.code).not.toContain("useState");
    const tabs = forName(index, "Tabs")[0].code;
    expect(tabs.split("\n")[0]).toMatch(/^import \{ Tabs, TabsContent, TabsList, TabsTrigger \} from "\.\.\/src";$|^import \{[^}]*Tabs[^}]*\} from "\.\.\/src";$/);
  });

  it("places each example beside the demo so its relative imports resolve", () => {
    const all = Object.values(index).flat();
    expect(all.every((e) => /^demo\/__motif_example_\d+\.tsx$/.test(e.path))).toBe(true);
    expect(new Set(all.map((e) => e.path)).size).toBe(new Set(all.map((e) => e.id)).size);
  });

  it("builds a runnable graph out of examples without touching the repository", async () => {
    const examples = forName(index, "Card").concat(forName(index, "Tabs"));
    const overlay = Object.fromEntries(examples.map((e) => [e.path, e.code]));
    const graph = await buildGraph({
      reader: memoryReader(files), repo: "a/b", ref: "main", entry: examples[0].path, extraEntries: examples.slice(1).map((e) => e.path), overlay,
      paths: Object.keys(files), tailwindEntry: analysis.tailwindEntry, tailwindVersion: analysis.stack.tailwindVersion, styleFiles: analysis.styleFiles,
    });
    for (const e of examples) expect(graph.modules[e.path].imports["../src"]).toBe("src/index.ts");
    expect(graph.modules["src/components/Tabs.tsx"]).toBeDefined();
    expect(graph.unsupported).toEqual([]);
    expect(graph.warnings).toEqual([]);
    expect(Object.keys(files)).not.toContain(examples[0].path);
  });
});

const pkg = JSON.stringify({ dependencies: { react: "^18.2.0", "react-dom": "^18.2.0", tailwindcss: "^4.0.0" } });
const base = {
  "package.json": pkg,
  "src/index.ts": 'export { Button } from "./Button";\nexport { Card, CardBody } from "./Card";',
  "src/styles.css": '@import "tailwindcss";',
  "src/Button.tsx": 'export function Button({ label = "Go", tone }: { label?: string; tone?: "a" | "b" }) { return <button data-tone={tone}>{label}</button>; }',
  "src/Card.tsx": 'import { createContext, useContext, type ReactNode } from "react";\nconst Ctx = createContext(0);\nexport function Card({ children }: { children: ReactNode }) { return <Ctx.Provider value={1}><div>{children}</div></Ctx.Provider>; }\nexport function CardBody({ children }: { children: ReactNode }) { useContext(Ctx); return <p>{children}</p>; }',
};

describe("what is made of the demo's code", () => {
  const demo = (body: string, head = "") => ({ ...base, "examples/Demo.tsx": `import { useState } from "react";\nimport { Button, Card, CardBody } from "../src";\n${head}\nexport function Demo() {\n  const [n, setN] = useState(0);\n  const label = "x" + n;\n  return (\n    <div>\n${body}\n    </div>\n  );\n}\n` });

  it("keeps a handler that shows content but silences one that only acts", async () => {
    const { index } = await examplesOf(demo('<Button label={label} tone="a" onClick={() => setN(n + 1)} />'));
    const [e] = forName(index, "Button");
    expect(e.code).toContain('<Button  tone="a" onClick={() => {}} />');
    expect(e.title).toBe("Button · tone: a");
  });

  it("brings along top-level helpers and constants the example uses, and what they use", async () => {
    const head = 'const tones = ["a", "b"] as const;\nfunction Row({ children }: { children: React.ReactNode }) { return <div className="row">{children}</div>; }';
    const { index } = await examplesOf(demo('<Card><Row>{tones.map((t) => <CardBody key={t}>{t}</CardBody>)}</Row></Card>', head));
    const [e] = forName(index, "Card");
    expect(e.code).toContain('const tones = ["a", "b"] as const;');
    expect(e.code).toContain("function Row(");
    // The map's own parameter is part of the example, so it is kept.
    expect(e.code).toContain("tones.map((t) => <CardBody key={t}>{t}</CardBody>)");
    expect(e.code).toContain('import { Card, CardBody } from "../src";');
  });

  it("takes the whole parent for a part that can't stand alone, and never a part by itself", async () => {
    const { index } = await examplesOf(demo("<Card><CardBody>Hello</CardBody></Card>"));
    expect(forName(index, "CardBody")[0].code).toContain("<Card><CardBody>Hello</CardBody></Card>");
    expect(forName(index, "CardBody")[0].title).toBe("Card");
  });

  it("drops a prop that needs a component the demo defines inside itself, and skips an example that is made of one", async () => {
    const demoFile = (jsx: string) => ({ ...base, "examples/Demo.tsx": `import { Button, Card } from "../src";\nexport function Demo() {\n  const Local = () => <i />;\n  return ${jsx};\n}\n` });
    const dropped = await examplesOf(demoFile('<Button label="x" icon={<Local />} />'));
    expect(forName(dropped.index, "Button")[0].code).not.toContain("Local");
    const skipped = await examplesOf(demoFile("<Card><Local /></Card>"));
    expect(forName(skipped.index, "Card")).toEqual([]);
  });

  it("ignores demos that don't use the library, and files it can't parse", async () => {
    const { index } = await examplesOf({ ...base, "examples/A.tsx": "export const A = () => <div />;", "examples/B.tsx": "export const = ;" });
    expect(index).toEqual({});
  });

  it("limits how many examples one component gets", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `<Button tone="a" label="n${i}" />`).join("\n");
    const { index } = await examplesOf(demo(many));
    expect(forName(index, "Button")).toHaveLength(8);
  });

  it("does not repeat an example that is reached twice", async () => {
    const { index } = await examplesOf(demo("<Card><CardBody>One</CardBody><CardBody>Two</CardBody></Card>"));
    expect(forName(index, "CardBody")).toHaveLength(1);
  });
});
