import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixtures";
import { memorySource, scanRepository, type RepoAnalysis } from "./index";

const scan = (files: Record<string, string>) => scanRepository(memorySource(files), { repo: "acme/ds", ref: "main" });
const component = (a: RepoAnalysis, name: string) => {
  const found = a.components.find((c) => c.name === name);
  if (!found) throw new Error(`no component ${name}`);
  return found;
};
const token = (a: RepoAnalysis, name: string) => {
  const found = a.tokens.find((t) => t.name === name);
  if (!found) throw new Error(`no token ${name}`);
  return found;
};

describe("motif-test-system (React 19, Vite, Tailwind v4, cva)", async () => {
  const a = await scan(loadFixture("motif-test-system"));

  it("detects the stack and how it was decided", () => {
    expect(a.stack).toMatchObject({
      framework: { name: "react", version: "19.3.1" },
      supported: true,
      typescript: true,
      bundler: "Vite",
      tailwindVersion: 4,
      variantHelper: "cva",
      packages: ["motif"],
      entryFiles: ["src/index.ts"],
      styling: { primary: "tailwind" },
    });
    expect(a.stack.styling.evidence).toEqual(["tailwindcss ^4.3.5 in package.json", "12 of 12 component files use utility classes"]);
    expect(a.warnings).toEqual([]);
  });

  it("reads 17 colors with light and dark values, plus fonts, radii and shadows", () => {
    const byKind = (kind: string) => a.tokens.filter((t) => t.kind === kind);
    expect(a.themes).toEqual(["light", "dark"]);
    expect(byKind("color")).toHaveLength(17);
    expect(byKind("font").map((t) => t.name)).toEqual(["font-sans", "font-mono"]);
    expect(byKind("radius").map((t) => t.name)).toEqual(["radius-sm", "radius-md", "radius-lg", "radius-xl"]);
    expect(byKind("shadow").map((t) => t.name)).toEqual(["shadow-card", "shadow-overlay"]);
    expect(a.tokens).toHaveLength(25);
    for (const t of byKind("color")) expect(Object.keys(t.values)).toEqual(["light", "dark"]);
  });

  it("keeps values, Tailwind names and where each token is defined", () => {
    expect(token(a, "primary")).toMatchObject({
      values: { light: "oklch(0.52 0.21 270)", dark: "oklch(0.65 0.18 270)" },
      tailwind: "color-primary",
      file: "src/styles/motif.css",
      line: 20,
    });
    expect(token(a, "radius-md")).toMatchObject({ values: { light: "0.5rem" }, tailwind: "radius-md" });
    expect(token(a, "font-sans").values.light).toBe('"Inter", ui-sans-serif, system-ui, sans-serif');
  });

  it("finds all 22 components, every one public, and skips the demo app", () => {
    expect(a.components.map((c) => c.name).sort()).toEqual([
      "Alert", "Avatar", "Badge", "Button", "Card", "CardContent", "CardDescription", "CardFooter", "CardHeader", "CardTitle",
      "Checkbox", "Field", "Input", "Label", "Modal", "Select", "Switch", "Tabs", "TabsContent", "TabsList", "TabsTrigger", "Textarea",
    ]);
    expect(a.components.every((c) => c.public === true)).toBe(true);
    expect(new Set(a.components.map((c) => c.file)).size).toBe(12);
  });

  it("reads Button's variants, defaults and own props", () => {
    const button = component(a, "Button");
    expect(button.root).toBe("button");
    expect(button.nativeProps).toBe("ButtonHTMLAttributes<HTMLButtonElement>");
    expect(button.variants).toEqual([
      { name: "variant", options: ["primary", "secondary", "outline", "ghost", "danger"], default: "primary", source: "cva" },
      { name: "size", options: ["sm", "md", "lg", "icon"], default: "md", source: "cva" },
    ]);
    expect(button.props.find((p) => p.name === "loading")).toMatchObject({ type: "boolean", required: false });
  });

  it("reads variants declared as a lookup object, and defaults from destructuring", () => {
    expect(component(a, "Avatar").variants).toEqual([{ name: "size", options: ["sm", "md", "lg"], default: "md", source: "lookup" }]);
    expect(component(a, "Switch").props.find((p) => p.name === "defaultChecked")).toMatchObject({ default: "false" });
    expect(component(a, "Alert").variants[0]).toMatchObject({ options: ["info", "success", "warning", "danger"], default: "info" });
    expect(component(a, "Badge").variants[0]).toMatchObject({ default: "neutral" });
  });

  it("keeps doc comments and required flags", () => {
    const children = component(a, "Field").props.find((p) => p.name === "children");
    expect(children).toMatchObject({ required: true, description: "A single form control (Input, Textarea, Select). It receives id, aria-describedby and invalid." });
    expect(component(a, "Modal").props.filter((p) => p.required).map((p) => p.name)).toEqual(["open", "onClose", "title"]);
  });

  it("follows props through Omit and extends", () => {
    expect(component(a, "Checkbox").nativeProps).toBe("InputHTMLAttributes<HTMLInputElement>");
    expect(component(a, "Alert").props.map((p) => p.name)).toEqual(["title", "variant"]);
    expect(component(a, "CardTitle").nativeProps).toBe("HTMLAttributes<HTMLHeadingElement>");
  });

  it("reports the hooks each component uses", () => {
    expect(component(a, "Switch").hooks).toEqual(["useState"]);
    expect(component(a, "Tabs").hooks).toEqual(["useId", "useState"]);
    expect(component(a, "Modal").hooks).toEqual(["useEffect", "useId", "useRef"]);
    expect(component(a, "Avatar").hooks).toEqual(["useState"]);
    expect(component(a, "Button").hooks).toEqual([]);
  });

  it("rates how editable each component is, and why", () => {
    const level = (name: string) => component(a, name).support.level;
    for (const name of ["Button", "Badge", "Alert", "Avatar", "Card", "CardHeader", "Checkbox", "Select", "Modal", "Label", "TabsList", "TabsContent", "Tabs"]) {
      expect(level(name)).toBe("editable");
    }
    expect(component(a, "Input").support).toEqual({ level: "partial", reasons: ["Uses the shared class constant `fieldBase`"] });
    expect(component(a, "Textarea").support.level).toBe("partial");
    expect(component(a, "Switch").support).toEqual({ level: "partial", reasons: ["Some classes depend on a condition"] });
    expect(["Field", "TabsTrigger"].map(level)).toEqual(["partial", "partial"]);
    expect(a.components.filter((c) => c.support.level === "view-only")).toEqual([]);
  });
});

const REACT_PKG = (extra: Record<string, string> = {}, more: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "ds", dependencies: { react: "^18.2.0", "react-dom": "^18.2.0", ...extra }, ...more });

describe("other repository setups", () => {
  it("reads a Tailwind v3 config", async () => {
    const a = await scan({
      "package.json": REACT_PKG({ tailwindcss: "^3.4.1" }),
      "tailwind.config.js": `
        const base = "#123456";
        module.exports = {
          theme: {
            extend: {
              colors: { brand: { DEFAULT: base, 500: "#0ea5e9" }, ink: "var(--ink)" },
              borderRadius: { xl: "12px" },
              fontFamily: { sans: ["Inter", "system-ui"] },
              boxShadow: { card: "0 1px 2px rgb(0 0 0 / 0.1)" },
              spacing: { 18: "4.5rem" },
            },
          },
        };`,
      "src/Tag.tsx": `export function Tag({ className }: { className?: string }) { return <span className={"px-2 " + (className ?? "")} />; }`,
    });
    expect(a.stack.tailwindVersion).toBe(3);
    expect(Object.fromEntries(a.tokens.map((t) => [t.name, [t.kind, t.values.default]]))).toEqual({
      "color-brand": ["color", "#123456"],
      "color-brand-500": ["color", "#0ea5e9"],
      "color-ink": ["color", "var(--ink)"],
      "radius-xl": ["radius", "12px"],
      "font-sans": ["font", "Inter, system-ui"],
      "shadow-card": ["shadow", "0 1px 2px rgb(0 0 0 / 0.1)"],
      "spacing-18": ["spacing", "4.5rem"],
    });
    expect(a.themes).toEqual(["default"]);
    expect(token(a, "color-brand").tailwind).toBe("color-brand");
  });

  it("reads themes from several selector styles and ignores component-scoped variables", async () => {
    const a = await scan({
      "package.json": REACT_PKG(),
      "src/theme.css": `
        :root { --bg: #ffffff; --accent: rgb(1 2 3); --radius: 4px; }
        :root:not(.dark) { --bg2: #fafafa; }
        [data-theme="dark"] { --bg: #000000; }
        @media (prefers-color-scheme: dark) { :root { --accent: rgb(9 9 9); } }
        .btn { --btn-pad: 8px; }
        .tw { --tw-ring-offset: 0; }`,
    });
    expect(a.themes).toEqual(["light", "dark"]);
    expect(token(a, "bg").values).toEqual({ light: "#ffffff", dark: "#000000" });
    expect(token(a, "accent")).toMatchObject({ kind: "color", values: { light: "rgb(1 2 3)", dark: "rgb(9 9 9)" } });
    expect(token(a, "radius").kind).toBe("radius");
    expect(token(a, "bg2").values).toEqual({ light: "#fafafa" });
    expect(a.tokens.map((t) => t.name)).not.toContain("btn-pad");
    expect(a.tokens.map((t) => t.name)).not.toContain("tw-ring-offset");
  });

  it("reads token JSON files", async () => {
    const a = await scan({
      "package.json": REACT_PKG(),
      "tokens/colors.json": JSON.stringify({ color: { brand: { $value: "#ff0000", $type: "color" }, bg: { value: "#fff" } }, radius: { sm: { value: "2px" } }, space: { 1: { $value: "4px" } } }),
    });
    expect(Object.fromEntries(a.tokens.map((t) => [t.name, t.kind]))).toEqual({ "color-brand": "color", "color-bg": "color", "radius-sm": "radius", "space-1": "spacing" });
  });

  it("recognises CSS modules and rates their components as view-only", async () => {
    const a = await scan({
      "package.json": REACT_PKG(),
      "src/Button.module.css": ".root { color: red; }",
      "src/Button.tsx": `import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root} />; }`,
    });
    expect(a.stack.styling.primary).toBe("css-modules");
    expect(component(a, "Button").support).toEqual({ level: "view-only", reasons: ["Styled with CSS modules, which Motif can't edit yet"] });
    expect(component(a, "Button").public).toBeNull();
  });

  it("recognises styled-components and lists styled components", async () => {
    const a = await scan({
      "package.json": REACT_PKG({ "styled-components": "^6.0.0" }),
      "src/Box.tsx": `
        import styled from "styled-components";
        export const Box = styled.div\`padding: 8px;\`;
        export const Wide = styled(Box)\`width: 100%;\`;
        export function Panel() { return <Box />; }`,
    });
    expect(a.stack.styling.primary).toBe("styled-components");
    expect(component(a, "Box")).toMatchObject({ root: "div", support: { level: "view-only" } });
    expect(component(a, "Wide").root).toBe("Box");
    expect(component(a, "Panel").name).toBe("Panel");
  });

  it("recognises plain CSS class names", async () => {
    const a = await scan({
      "package.json": REACT_PKG(),
      "src/app.css": ".btn { color: red; }",
      "src/Button.tsx": `export const Button = () => <button className="btn btn-primary">x</button>;`,
    });
    expect(a.stack.styling.primary).toBe("plain-css");
    expect(component(a, "Button").support.reasons).toEqual(["Class names refer to plain CSS styles, which Motif can't edit yet"]);
  });

  it("reports repositories that are not React", async () => {
    const a = await scan({ "package.json": JSON.stringify({ dependencies: { vue: "^3.4.0" } }), "src/App.vue": "<template></template>", "src/styles.css": ":root { --c: #fff; }" });
    expect(a.stack).toMatchObject({ framework: { name: "vue" }, supported: false });
    expect(a.components).toEqual([]);
    expect(a.warnings).toEqual(["Components are not read yet: vue repositories are not supported, only React"]);
    expect(a.tokens.map((t) => t.name)).toEqual(["c"]);
  });

  it("follows variants, props and re-exports across files", async () => {
    const a = await scan({
      "package.json": REACT_PKG({ tailwindcss: "^4.0.0", "class-variance-authority": "^0.7.0" }, { main: "dist/index.js" }),
      "src/index.ts": `export { default as Card } from "./Card";\nexport * from "./button";`,
      "src/button/index.ts": `export { Button } from "./Button";`,
      "src/button/variants.ts": `import { cva } from "class-variance-authority";\nexport const buttonVariants = cva("base", { variants: { tone: { calm: "a", loud: "b" } }, defaultVariants: { tone: "calm" } });`,
      "src/button/types.ts": `export interface ButtonOwnProps { /** Shown inside */ label: string }`,
      "src/button/Button.tsx": `
        import type { VariantProps } from "class-variance-authority";
        import { buttonVariants } from "./variants";
        import type { ButtonOwnProps } from "./types";
        type Props = ButtonOwnProps & VariantProps<typeof buttonVariants>;
        export const Button = ({ label, tone }: Props) => <button className={buttonVariants({ tone })}>{label}</button>;`,
      "src/Card.tsx": `export default function Card() { return <div className="p-4" />; }`,
      "src/Internal.tsx": `import { memo } from "react";\nexport const Internal = memo(function Internal() { return <i className="x" />; });`,
    });
    expect(a.stack.entryFiles).toEqual(["src/index.ts"]);
    const button = component(a, "Button");
    expect(button.public).toBe(true);
    expect(button.variants).toEqual([{ name: "tone", options: ["calm", "loud"], default: "calm", source: "cva" }]);
    expect(button.props.find((p) => p.name === "label")).toMatchObject({ required: true, description: "Shown inside" });
    expect(button.support.level).toBe("editable");
    expect(component(a, "Card")).toMatchObject({ exported: "default", public: true });
    expect(component(a, "Internal").public).toBe(false);
  });

  it("notes props it cannot resolve instead of guessing", async () => {
    const a = await scan({
      "package.json": REACT_PKG(),
      "src/Thing.tsx": `import type { Mystery } from "some-package";\nexport function Thing(props: Mystery) { return <div className="a" />; }\nexport function NoTypes(props) { return <div className="a" />; }`,
    });
    expect(component(a, "Thing").notes).toEqual(["Couldn't read props from `Mystery`"]);
    expect(component(a, "NoTypes").notes).toEqual(["No props type found, so props are not listed"]);
  });

  it("skips files it cannot parse, with a warning, and keeps going", async () => {
    const a = await scan({
      "package.json": REACT_PKG(),
      "src/Broken.tsx": `export function Broken() { return <div className="a" ; }`,
      "src/Fine.tsx": `export function Fine() { return <div className="a" />; }`,
      "src/bad.css": `:root { --a: #fff `,
    });
    expect(a.components.map((c) => c.name)).toEqual(["Fine"]);
    expect(a.warnings.some((w) => w.startsWith("Could not parse src/Broken.tsx"))).toBe(true);
  });

  it("ignores node_modules, build output, stories and tests", async () => {
    const a = await scan({
      "package.json": REACT_PKG(),
      "node_modules/lib/Thing.tsx": `export const Thing = () => <div />;`,
      "dist/Built.tsx": `export const Built = () => <div />;`,
      "src/Real.tsx": `export const Real = () => <div className="a" />;`,
      "src/Real.stories.tsx": `export const Story = () => <div />;`,
      "src/Real.test.tsx": `export const Test = () => <div />;`,
      "examples/Demo.tsx": `export const Demo = () => <div />;`,
    });
    expect(a.components.map((c) => c.name)).toEqual(["Real"]);
  });

  it("warns when GitHub truncated the file list", async () => {
    const source = { ...memorySource({ "package.json": REACT_PKG() }), listFiles: async () => ({ paths: ["package.json"], truncated: true }) };
    const a = await scanRepository(source, { repo: "a/b", ref: "main" });
    expect(a.warnings[0]).toMatch(/only part of this repository's file list/);
    expect(a.stats.truncated).toBe(true);
  });
});
