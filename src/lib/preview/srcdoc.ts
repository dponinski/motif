import type { ModuleGraph } from "./graph";
import type { RenderMessage } from "./protocol";
import { packageName } from "./graph";
import { isTailwind3Module, tailwind3Url } from "./tailwind3";

const ESM = "https://esm.sh";
const TAILWIND_BROWSER = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser";

export const RUNTIME_PATH = "/motif-preview-runtime.js";

// Specifiers the compiled code needs whatever the component imports.
const ALWAYS = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"];

const clean = (version: string) => encodeURIComponent(version.replace(/\s+/g, "")).replace(/%5E/g, "^").replace(/%7E/g, "~");

// Where a package is loaded from. React and ReactDOM come from one version, and everything else asks for
// React as a bare import so the import map points it at that same copy.
export function esmUrl(spec: string, deps: Record<string, string>): string {
  const name = packageName(spec);
  const sub = spec.slice(name.length);
  const version = clean(deps[name] ?? "latest");
  if (name === "react") return `${ESM}/react@${version}${sub}`;
  if (name === "react-dom") return `${ESM}/react-dom@${version}${sub}?external=react`;
  return `${ESM}/${name}@${version}${sub}?external=react,react-dom`;
}

// Content from a repository ends up inside script and style elements, so nothing in it may close them.
const json = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const style = (css: string) => css.replace(/<\/style/gi, "<\\/style");
const attr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export interface SrcdocInput {
  graph: ModuleGraph;
  tailwindVersion: 3 | 4 | null;
  // Where the runtime script is served from, e.g. "http://localhost:3000/motif-preview-runtime.js".
  runtimeUrl: string;
  nonce: string;
  // The runtime's own code, for a page that has to run without Motif being there (an exported docs site): it is
  // put in the page instead of being loaded from `runtimeUrl`.
  runtimeSource?: string;
  // A Tailwind 3 page that doesn't build its own stylesheet: the stylesheet is already built (see `tailwind3Css` in the runtime), so it
  // carries no engine and needs nothing from Motif's server. For a page that has to run without Motif (documentation, an exported site).
  tailwind3Css?: string;
  // What to show when the page loads, for a page with no parent to ask it (a preview in an exported docs site).
  initial?: RenderMessage;
}

export const runtimeUrlFor = (origin: string) => `${origin}${RUNTIME_PATH}`;

export function csp(runtimeUrl: string | null, nonce: string): string {
  // `file:` has no host to allow, so a local page lists the scheme. A page with its runtime inline needs no host.
  const url = runtimeUrl ? new URL(runtimeUrl) : null;
  const self = url ? (url.protocol === "file:" ? "file:" : url.origin) : "";
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' ${ESM} https://cdn.jsdelivr.net${self ? ` ${self}` : ""}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    "img-src https: data: blob:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function buildSrcdoc({ graph, tailwindVersion, runtimeUrl, nonce, runtimeSource, initial, tailwind3Css }: SrcdocInput): string {
  // The Tailwind 3 engine is a file Motif serves, so a page that has to run without Motif (an exported docs site) is given its stylesheet
  // already built.
  const built = tailwindVersion === 3 && tailwind3Css !== undefined;
  if (tailwindVersion === 3 && runtimeSource !== undefined && !built) throw new Error("A Tailwind v3 page that runs without Motif needs its stylesheet built first");

  // What the Tailwind 3 bundle provides to a config is not loaded from the CDN.
  const specs = [...new Set([...ALWAYS, ...graph.bare])].filter((spec) => !(tailwindVersion === 3 && isTailwind3Module(spec)));
  const externals = Object.fromEntries(specs.map((spec) => [spec, esmUrl(spec, graph.deps)]));
  const importMap = { imports: Object.fromEntries(ALWAYS.map((spec) => [spec, externals[spec]])) };

  const css = graph.css.map((c) => c.text).join("\n\n");
  // Tailwind compiles every stylesheet together, so they stay one element; otherwise each is its own, so an edit to one
  // stylesheet can replace just that one while the page is open.
  // Tailwind 3 has the page build it: the engine reads the stylesheet and the config and writes `motif-tw3` as the page changes.
  const styles = tailwindVersion === 4
    ? `<style type="text/tailwindcss">${style(css)}</style>`
    : built
    ? `<style id="motif-tw3">${style(tailwind3Css!)}</style>`
    : tailwindVersion === 3
    ? `<style id="motif-tw3"></style>`
    : graph.css.map((c) => `<style data-motif-css="${attr(c.path)}">${style(c.text)}</style>`).join("\n");
  const tailwind3 = tailwindVersion === 3 && !built ? { css: graph.css, config: graph.tailwindConfig } : null;
  // The config only builds the stylesheet, so a page with its stylesheet built doesn't carry it.
  const modules = built && graph.tailwindConfig ? Object.fromEntries(Object.entries(graph.modules).filter(([path]) => path !== graph.tailwindConfig)) : graph.modules;
  const data = { entry: graph.entry, modules, externals, tailwind3, initial: initial ?? null };
  const runtime = runtimeSource !== undefined
    ? `<script nonce="${nonce}">${runtimeSource.replace(/<\/script/gi, "<\\/script")}</script>`
    : `<script nonce="${nonce}" src="${attr(runtimeUrl)}"></script>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(csp(runtimeSource !== undefined ? null : runtimeUrl, nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="importmap" nonce="${nonce}">${json(importMap)}</script>
${tailwindVersion === 4 ? `<script nonce="${nonce}" src="${TAILWIND_BROWSER}@4"></script>` : ""}
${tailwindVersion === 3 && !built ? `<script nonce="${nonce}" src="${attr(tailwind3Url(runtimeUrl))}"></script>` : ""}
${styles}
<style id="motif-overrides"></style>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="motif-data">${json(data)}</script>
${runtime}
</body>
</html>`;
}

export const newNonce = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "");
};
