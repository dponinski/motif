import { describe, expect, it } from "vitest";
import type { ModuleGraph } from "./graph";
import { buildSrcdoc, csp, esmUrl, newNonce, runtimeUrlFor } from "./srcdoc";

const graph = (extra: Partial<ModuleGraph> = {}): ModuleGraph => ({
  entry: "src/A.tsx",
  modules: { "src/A.tsx": { code: "exports.A = 1;", imports: {} } },
  css: [{ path: "src/app.css", text: '@import "tailwindcss";\n.a { color: red; }' }],
  deps: { react: "^19.3.1", "react-dom": "^19.3.1", clsx: "^2.1.1", "@radix-ui/react-dialog": "^1.1.2" },
  bare: ["clsx", "@radix-ui/react-dialog/sub"],
  unsupported: [], warnings: [],
  ...extra,
});

const build = (g = graph(), tailwindVersion: 3 | 4 | null = 4) =>
  buildSrcdoc({ graph: g, tailwindVersion, runtimeUrl: runtimeUrlFor("http://localhost:3000"), nonce: "N0NCE" });

const embedded = (html: string) => JSON.parse(/<script type="application\/json" id="motif-data">([\s\S]*?)<\/script>/.exec(html)![1]);

describe("esmUrl", () => {
  const deps = { react: "^19.3.1", "react-dom": "19.0.0", clsx: "^2.1.1", "@radix-ui/react-dialog": "~1.1.0", odd: ">=1.0.0 <2" };

  it("loads React alone, and everything else against that one React", () => {
    expect(esmUrl("react", deps)).toBe("https://esm.sh/react@^19.3.1");
    expect(esmUrl("react/jsx-runtime", deps)).toBe("https://esm.sh/react@^19.3.1/jsx-runtime");
    expect(esmUrl("react-dom/client", deps)).toBe("https://esm.sh/react-dom@19.0.0/client?external=react");
    expect(esmUrl("clsx", deps)).toBe("https://esm.sh/clsx@^2.1.1?external=react,react-dom");
  });

  it("handles scopes, subpaths, odd ranges and unknown packages", () => {
    expect(esmUrl("@radix-ui/react-dialog", deps)).toBe("https://esm.sh/@radix-ui/react-dialog@~1.1.0?external=react,react-dom");
    expect(esmUrl("@radix-ui/react-dialog/sub", deps)).toBe("https://esm.sh/@radix-ui/react-dialog@~1.1.0/sub?external=react,react-dom");
    expect(esmUrl("odd", deps)).toBe("https://esm.sh/odd@%3E%3D1.0.0%3C2?external=react,react-dom");
    expect(esmUrl("mystery", deps)).toBe("https://esm.sh/mystery@latest?external=react,react-dom");
  });
});

describe("buildSrcdoc", () => {
  it("restricts what the sandbox can load and do", () => {
    const html = build();
    const policy = /Content-Security-Policy" content="([^"]*)"/.exec(html)![1];
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("script-src 'nonce-N0NCE' 'unsafe-eval' 'wasm-unsafe-eval' https://esm.sh https://cdn.jsdelivr.net http://localhost:3000");
    expect(policy).not.toContain("'unsafe-inline' https://esm.sh");
    expect(csp("file:///x/runtime.js", "n")).toContain(" file:");
  });

  it("pins one React through an import map and lists every package for the runtime", () => {
    const html = build();
    const map = JSON.parse(/<script type="importmap" nonce="N0NCE">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(map.imports).toEqual({
      react: "https://esm.sh/react@^19.3.1",
      "react/jsx-runtime": "https://esm.sh/react@^19.3.1/jsx-runtime",
      "react-dom": "https://esm.sh/react-dom@^19.3.1?external=react",
      "react-dom/client": "https://esm.sh/react-dom@^19.3.1/client?external=react",
    });
    const data = embedded(html);
    expect(Object.keys(data.externals).sort()).toEqual(["@radix-ui/react-dialog/sub", "clsx", "react", "react-dom", "react-dom/client", "react/jsx-runtime"]);
    expect(data.entry).toBe("src/A.tsx");
  });

  it("uses Tailwind's browser build for v4 only, with the repository's CSS", () => {
    const v4 = build();
    expect(v4).toContain('<script nonce="N0NCE" src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>');
    expect(v4).toContain('<style type="text/tailwindcss">@import "tailwindcss";');
    const none = build(graph(), null);
    expect(none).not.toContain("tailwindcss/browser");
    expect(none).toContain("<style>@import");
    expect(() => build(graph(), 3)).toThrow("Tailwind v3 repositories can't be previewed yet");
  });

  it("loads the runtime and leaves a place for token overrides", () => {
    const html = build();
    expect(html).toContain('<script nonce="N0NCE" src="http://localhost:3000/motif-preview-runtime.js"></script>');
    expect(html).toContain('<style id="motif-overrides"></style>');
  });

  it("cannot be broken out of by what a repository contains", () => {
    const evil = "</script><script>window.parent.postMessage('x','*')</script><!--  ";
    const html = build(graph({
      modules: { "src/A.tsx": { code: `exports.s = ${JSON.stringify(evil)};`, imports: {} } },
      css: [{ path: "a.css", text: `.a::after { content: "</style><img src=x onerror=alert(1)>"; }` }],
    }));
    // Only the four scripts Motif wrote: the import map, Tailwind, the data block, and the runtime.
    expect(html.match(/<script/g)).toHaveLength(4);
    expect(html.match(/<\/script>/g)).toHaveLength(4);
    // The two style elements Motif wrote, and the repository's attempt to close one early is defused.
    expect(html.match(/<\/style>/g)).toHaveLength(2);
    expect(html).toContain("<\\/style><img src=x");
    expect(html).not.toContain("</style><img");
    expect(embedded(html).modules["src/A.tsx"].code).toBe(`exports.s = ${JSON.stringify(evil)};`);
  });

  it("makes a fresh nonce each time", () => {
    const [a, b] = [newNonce(), newNonce()];
    expect(a).toMatch(/^[a-zA-Z0-9]{12,}$/);
    expect(a).not.toBe(b);
  });
});
