import { describe, expect, it } from "vitest";
import { memoryReader, scanRepository, memorySource } from "../repo-scan";
import { toLibrary } from "../preview/library";
import { NEW_FILE } from "../../store/edit";
import { checkName, componentDir, componentSource, exportLine, libraryEntry, planComponent, rootClass } from "./create";
import { stylesheetOf } from "./css-element";

const analysisOf = (files: Record<string, string>) => scanRepository(memorySource(files), { repo: "acme/ds", ref: "main" });
const planIn = async (files: Record<string, string>, name = "Button") => {
  const analysis = await analysisOf(files);
  const components = toLibrary(analysis.components);
  return { plan: await planComponent({ name, analysis, components, paths: Object.keys(files), reader: memoryReader(files), ref: "main" }), analysis, components };
};

describe("choosing a name", () => {
  const taken = { components: ["Card", "Badge"], paths: ["src/components/Tabs.tsx"] };
  it("accepts a component's name", () => {
    expect(checkName("Button", taken, "src/components")).toBeNull();
    expect(checkName("PricingCard2", taken, "src/components")).toBeNull();
  });
  it("says what is wrong with one that isn't", () => {
    expect(checkName("", taken, "src/components")).toMatch(/Give the component a name/);
    for (const bad of ["button", "My Button", "My-Button", "1Button", "Bütton", "Button!"]) expect(checkName(bad, taken, "src/components"), bad).toMatch(/capital letter/);
    expect(checkName("A".repeat(41), taken, "src/components")).toMatch(/40 characters/);
    expect(checkName("React", taken, "src/components")).toMatch(/already uses/);
    expect(checkName("Card", taken, "src/components")).toMatch(/already a component called Card/);
    expect(checkName("card", taken, "src/components")).toMatch(/capital/);
    expect(checkName("BADGE", taken, "src/components")).toMatch(/already a component/);
    expect(checkName("Tabs", taken, "src/components")).toMatch(/already exists in the repository/);
  });
});

describe("where components go", () => {
  it("is where most of the repository's are, or src/components", () => {
    expect(componentDir([])).toBe("src/components");
    expect(componentDir([{ file: "src/ui/A.tsx" }, { file: "src/ui/B.tsx" }, { file: "src/other/C.tsx" }])).toBe("src/ui");
    expect(componentDir([{ file: "Root.tsx" }])).toBe("");
  });
});

describe("the files of a new component", () => {
  it("is a function component with its stylesheet, whose class is the component's name in kebab case", () => {
    const { code, css, rootStart } = componentSource("PricingCard", "css");
    expect(code).toBe(`import "./PricingCard.css";\n\nexport function PricingCard() {\n  return <div className="pricing-card">PricingCard</div>;\n}\n`);
    expect(css).toBe(".pricing-card {\n  padding: 16px;\n}\n");
    expect(code.slice(rootStart)).toMatch(/^<div className="pricing-card">/);
    expect(rootClass("Button")).toBe("button");
    expect(rootClass("HTMLTable")).toBe("htmltable");
  });
  it("is made of Tailwind classes in a Tailwind project, with no stylesheet", () => {
    const { code, css } = componentSource("Button", "tailwind");
    expect(css).toBeNull();
    expect(code).toBe(`export function Button() {\n  return <div className="p-4">Button</div>;\n}\n`);
  });
  it("imports its stylesheet, which the editor then finds", () => {
    expect(stylesheetOf("src/components/Button.tsx", componentSource("Button", "css").code)).toBe("src/components/Button.css");
  });
  it("is exported by a line that is a relative import of it", () => {
    expect(exportLine("src/index.ts", "src/components/Button.tsx", "Button")).toBe(`export { Button } from "./components/Button";`);
    expect(exportLine("index.ts", "Button.tsx", "Button")).toBe(`export { Button } from "./Button";`);
    expect(exportLine("src/lib/index.ts", "src/components/Button.tsx", "Button")).toBe(`export { Button } from "../components/Button";`);
  });
});

describe("planning a component", () => {
  it("in a repository with a README only: both files, and a new entry file", async () => {
    const { plan } = await planIn({ "README.md": "# ds" });
    expect(plan).toMatchObject({ name: "Button", file: "src/components/Button.tsx", stylesheet: "src/components/Button.css", engine: "css", entry: "src/index.ts" });
    expect(Object.keys(plan.texts).sort()).toEqual(["package.json", "src/components/Button.css", "src/components/Button.tsx", "src/index.ts"]);
    expect(plan.texts["src/index.ts"]).toBe(`export { Button } from "./components/Button";\n`);
    expect(plan.bases).toEqual({ "src/components/Button.tsx": NEW_FILE, "src/components/Button.css": NEW_FILE, "src/index.ts": NEW_FILE, "package.json": NEW_FILE });
    // The repository has to say it uses React for its components to be read
    expect(JSON.parse(plan.texts["package.json"])).toMatchObject({ name: "ds", private: true, peerDependencies: { react: ">=18" }, devDependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } });
    expect(plan.texts[plan.file].slice(plan.rootStart, plan.rootStart + 4)).toBe("<div");
  });

  it("appends to the entry file the repository has, and keeps what it said", async () => {
    const files = {
      "package.json": `{"name":"ds","main":"src/index.ts","dependencies":{"react":"^19.0.0"}}`,
      "src/index.ts": `export { Card } from "./ui/Card";`,
      "src/ui/Card.tsx": `export function Card() { return <div>card</div>; }\n`,
    };
    const { plan } = await planIn(files);
    // Components are where the others are
    expect(plan.file).toBe("src/ui/Button.tsx");
    // It already depends on React, so package.json is left alone
    expect(plan.texts["package.json"]).toBeUndefined();
    expect(plan.texts["src/index.ts"]).toBe(`export { Card } from "./ui/Card";\nexport { Button } from "./ui/Button";\n`);
    expect(plan.bases["src/index.ts"]).toMatchObject({ text: files["src/index.ts"] });
    expect(plan.bases["src/index.ts"].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(plan.bases[plan.file]).toBe(NEW_FILE);
  });

  it("makes a Tailwind component with no stylesheet in a Tailwind v4 repository", async () => {
    const { plan } = await planIn({ "package.json": `{"devDependencies":{"tailwindcss":"^4.0.0"}}`, "src/app.css": `@import "tailwindcss";`, "README.md": "x" });
    expect(plan.engine).toBe("tailwind");
    expect(plan.stylesheet).toBeNull();
    // Tailwind v4 but no React yet: React is added to the package.json that is there
    expect(Object.keys(plan.texts).sort()).toEqual(["package.json", "src/components/Button.tsx", "src/index.ts"]);
    expect(JSON.parse(plan.texts["package.json"]).devDependencies).toEqual({ tailwindcss: "^4.0.0", react: "^19.0.0", "react-dom": "^19.0.0" });
    expect(plan.bases["package.json"].sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("refuses a name that is taken", async () => {
    await expect(planIn({ "src/components/Button.tsx": "export const Button = () => <b/>;" })).rejects.toThrow(/already exists|already a component/);
    await expect(planIn({ "README.md": "x" }, "button")).rejects.toThrow(/capital letter/);
  });

  it("tells when package.json can't be added to", async () => {
    const { plan } = await planIn({ "package.json": "{ not json", "README.md": "x" });
    expect(plan.texts["package.json"]).toBeUndefined();
    expect(plan.notes.join(" ")).toMatch(/add react to its dependencies yourself/);
  });

  it("does not export it twice", async () => {
    const files = { "src/index.ts": `export { Button } from "./components/Button";\n`, "README.md": "x" };
    const { plan } = await planIn(files);
    expect(plan.texts["src/index.ts"]).toBe(files["src/index.ts"]);
  });

  it("puts the line on its own line when the entry file doesn't end with one", async () => {
    const { plan } = await planIn({ "src/index.ts": `export const a = 1;`, "README.md": "x" });
    expect(plan.texts["src/index.ts"]).toBe(`export const a = 1;\nexport { Button } from "./components/Button";\n`);
  });
});

describe("the library's entry for it", () => {
  it("is a public, editable component read from what was generated", async () => {
    const files = { "README.md": "# ds" };
    const { plan } = await planIn(files);
    const entry = await libraryEntry(plan, { reader: memoryReader(files), ref: "main", paths: Object.keys(files) });
    expect(entry).toMatchObject({ id: "src/components/Button.tsx::Button", name: "Button", file: "src/components/Button.tsx", exported: "named", public: true });
    expect(entry.root).toBe("div");
    expect(entry.props).toEqual([]);
  });
  it("once it is in the repository, is what a scan finds too", async () => {
    const merged = { "README.md": "x", ...(await planIn({ "README.md": "x" })).plan.texts };
    expect(Object.keys(merged)).toContain("package.json");
    const analysis = await analysisOf(merged);
    expect(toLibrary(analysis.components).map((c) => c.id)).toEqual(["src/components/Button.tsx::Button"]);
    expect(analysis.styleFiles).toContain("src/components/Button.css");
  });
});
