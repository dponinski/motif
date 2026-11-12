import type { RepoStack, StylingSystem } from "./types";

export interface PackageJson {
  name?: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface DetectInput {
  packages: { path: string; json: PackageJson }[];
  paths: string[];
  cssTexts: string[];
  // Component files using each styling system, counted while reading components.
  usage: Partial<Record<StylingSystem, number>>;
  libraryFiles: number;
  entryFiles: string[];
}

const major = (range: string | undefined) => {
  const m = range?.match(/\d+/);
  return m ? Number(m[0]) : null;
};

const FRAMEWORKS: [dep: string, name: string, supported: boolean][] = [
  ["next", "next", true],
  ["react", "react", true],
  ["vue", "vue", false],
  ["svelte", "svelte", false],
  ["@angular/core", "angular", false],
  ["solid-js", "solid", false],
  ["preact", "preact", false],
];

const BUNDLERS: [dep: string, name: string][] = [
  ["next", "Next.js"], ["vite", "Vite"], ["webpack", "webpack"], ["@rspack/core", "Rspack"],
  ["parcel", "Parcel"], ["tsup", "tsup"], ["rollup", "Rollup"], ["esbuild", "esbuild"],
];

const PREFERENCE: StylingSystem[] = ["tailwind", "css-modules", "styled-components", "emotion", "vanilla-extract", "sass", "plain-css"];

const LABEL: Record<StylingSystem, string> = {
  tailwind: "utility classes",
  "css-modules": "CSS modules",
  "styled-components": "styled-components",
  emotion: "Emotion",
  sass: "Sass",
  "vanilla-extract": "vanilla-extract",
  "plain-css": "plain CSS",
};

export function detectStack(input: DetectInput): RepoStack {
  const deps: Record<string, string> = {};
  for (const { json } of input.packages) {
    Object.assign(deps, json.peerDependencies, json.devDependencies, json.dependencies);
  }
  const has = (name: string) => name in deps;
  const hasFile = (re: RegExp) => input.paths.some((p) => re.test(p));

  const found = FRAMEWORKS.find(([dep]) => has(dep));
  const framework = found ? { name: found[1], version: deps[found[0]].replace(/^[^\d]*/, "") || null } : null;
  const bundler = BUNDLERS.find(([dep]) => has(dep))?.[1] ?? null;

  const tailwindConfig = hasFile(/(^|\/)tailwind\.config\.[cm]?[jt]s$/);
  const cssTailwind = input.cssTexts.some((t) => /@import\s+["']tailwindcss|@tailwind\s|@theme\b/.test(t));
  const hasTailwind = has("tailwindcss") || Object.keys(deps).some((d) => d.startsWith("@tailwindcss/")) || cssTailwind || tailwindConfig;
  const declared = major(deps.tailwindcss);
  const tailwindVersion: 3 | 4 | null = !hasTailwind
    ? null
    : declared === 4 || declared === 3
      ? declared
      : input.cssTexts.some((t) => /@import\s+["']tailwindcss|@theme\b/.test(t)) ? 4 : 3;

  const present = new Map<StylingSystem, string>();
  if (hasTailwind) present.set("tailwind", has("tailwindcss") ? `tailwindcss ${deps.tailwindcss} in package.json` : "Tailwind directives found in CSS");
  if (hasFile(/\.module\.(css|scss|sass|less)$/)) present.set("css-modules", "*.module.css files");
  if (has("styled-components")) present.set("styled-components", `styled-components ${deps["styled-components"]} in package.json`);
  if (has("@emotion/react") || has("@emotion/styled") || has("@emotion/css")) present.set("emotion", "Emotion in package.json");
  if (has("@vanilla-extract/css") || hasFile(/\.css\.ts$/)) present.set("vanilla-extract", "vanilla-extract");
  if (has("sass") || has("sass-embedded") || hasFile(/\.s[ac]ss$/)) present.set("sass", "Sass files or package");
  if (present.size === 0 && input.cssTexts.length > 0) present.set("plain-css", "stylesheets without a styling library");

  const evidence: string[] = [];
  for (const [system, why] of present) evidence.push(`${why}`);
  for (const system of PREFERENCE) {
    const n = input.usage[system];
    if (n) evidence.push(`${n} of ${input.libraryFiles} component files use ${LABEL[system]}`);
  }

  let primary: StylingSystem | null = null;
  let best = 0;
  for (const system of PREFERENCE) {
    const n = input.usage[system] ?? 0;
    if (n > best) { best = n; primary = system; }
  }
  if (!primary) primary = PREFERENCE.find((s) => present.has(s)) ?? null;

  const variantHelper = has("class-variance-authority") ? "cva" : has("tailwind-variants") ? "tailwind-variants" : null;

  return {
    framework,
    supported: found?.[2] ?? false,
    typescript: has("typescript") || hasFile(/(^|\/)tsconfig(\.[\w-]+)?\.json$/),
    bundler: framework?.name === "next" ? "Next.js" : bundler,
    styling: { primary, evidence },
    tailwindVersion,
    variantHelper,
    packages: input.packages.map((p) => p.json.name ?? p.path),
    entryFiles: input.entryFiles,
  };
}
