import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memoryReader, memorySource, scanRepository } from "../repo-scan";
import { buildGraph, type GraphModule } from "./graph";

// The preview runtime is a plain script for the browser that also exports its module registry for tests.
const { createRegistry, toCjs } = createRequire(import.meta.url)("../../../public/motif-preview-runtime.js") as {
  createRegistry: (data: { modules: Record<string, GraphModule> }, externals: Record<string, unknown>) => { require: (path: string) => Record<string, unknown> };
  toCjs: (ns: object) => Record<string, unknown>;
};

const mod = (code: string, imports: Record<string, string | null> = {}): GraphModule => ({ code, imports });

describe("the module registry", () => {
  it("runs modules, gives each its own require, and shares exports", () => {
    const registry = createRegistry({
      modules: {
        "a.js": mod(`const b = require("./b"); exports.value = b.double(21);`, { "./b": "b.js" }),
        "b.js": mod(`exports.double = (n) => n * 2;`),
      },
    }, {});
    expect(registry.require("a.js").value).toBe(42);
  });

  it("lets modules in an import cycle see what is exported so far", () => {
    const registry = createRegistry({
      modules: {
        "a.js": mod(`exports.early = 1; const b = require("./b"); exports.fromB = b.seenA;`, { "./b": "b.js" }),
        "b.js": mod(`const a = require("./a"); exports.seenA = a.early;`, { "./a": "a.js" }),
      },
    }, {});
    expect(registry.require("a.js").fromB).toBe(1);
  });

  it("returns packages from the externals, nothing for stylesheets, and says what is missing", () => {
    const registry = createRegistry({
      modules: {
        "a.js": mod(`exports.pkg = require("left-pad"); exports.css = require("./x.css");`, { "./x.css": null }),
        "b.js": mod(`require("not-loaded");`),
        "c.js": mod(`require("./gone");`, { "./gone": "gone.js" }),
      },
    }, { "left-pad": { pad: true } });
    expect(registry.require("a.js")).toEqual({ pkg: { pad: true }, css: {} });
    expect(() => registry.require("b.js")).toThrow('The package "not-loaded" was not loaded');
    expect(() => registry.require("c.js")).toThrow("Module not found: gone.js");
  });

  it("provides process.env and import.meta, which compiled code relies on", () => {
    const registry = createRegistry({
      modules: { "a.js": mod(`exports.env = process.env.NODE_ENV; exports.dev = __importMeta.env.DEV;`) },
    }, {});
    expect(registry.require("a.js")).toEqual({ env: "production", dev: false });
  });

  it("presents an ES module namespace the way compiled imports expect", () => {
    const cjs = toCjs({ default: "d", named: "n" });
    expect(cjs).toMatchObject({ default: "d", named: "n", __esModule: true });
  });
});

describe("a real component from the repository, run through the whole pipeline", () => {
  it("compiles, links and renders Button with its real class names", async () => {
    const files = loadFixture("motif-test-system");
    const analysis = await scanRepository(memorySource(files), { repo: "a/b", ref: "main" }, { tokensOnly: true });
    const graph = await buildGraph({
      reader: memoryReader(files), repo: "a/b", ref: "main", entry: "src/components/Button.tsx", paths: Object.keys(files),
      tailwindEntry: analysis.tailwindEntry, tailwindVersion: 4, styleFiles: analysis.styleFiles,
    });

    // Stand-ins for the packages the CDN would serve; clsx and tailwind-merge are the real ones.
    const element = (type: unknown, props: Record<string, unknown>) => ({ type, props });
    const cva = (base: string, config: { variants?: Record<string, Record<string, string>>; defaultVariants?: Record<string, string> } = {}) =>
      (props: Record<string, string> = {}) =>
        [base, ...Object.entries(config.variants ?? {}).map(([name, options]) => options[props[name] ?? config.defaultVariants?.[name] ?? ""])].filter(Boolean).join(" ");
    const require_ = createRequire(import.meta.url);
    const registry = createRegistry(graph, {
      react: { forwardRef: (fn: unknown) => fn, createElement: element },
      "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
      "class-variance-authority": { __esModule: true, cva },
      clsx: toCjs({ ...require_("clsx"), default: require_("clsx") }),
      "tailwind-merge": toCjs(require_("tailwind-merge")),
    });

    const { Button } = registry.require("src/components/Button.tsx") as { Button: (props: Record<string, unknown>, ref: null) => { type: string; props: Record<string, unknown> } };
    const danger = Button({ variant: "danger", size: "sm", children: "Delete" }, null);
    expect(danger.type).toBe("button");
    expect(danger.props.className).toContain("bg-danger text-danger-foreground");
    expect(danger.props.className).toContain("h-8 px-3");
    // tailwind-merge resolves the conflict in favour of the later class, as it does in the repository.
    const merged = (Button({ variant: "primary", className: "bg-danger" }, null).props.className as string).split(" ");
    expect(merged).toContain("bg-danger");
    expect(merged).not.toContain("bg-primary");
    expect(merged).toContain("hover:bg-primary/90");
  });
});
