// What a Tailwind 3 preview needs besides the repository's own files. Tailwind 3 has no browser build of its own, so Motif serves one
// (public/motif-tailwind3.js, made by scripts/build-tailwind3.mjs): the engine, and the packages a config `require`s.

export const TAILWIND3_PATH = "/motif-tailwind3.js";

// The specifiers the engine's bundle provides to a config, so the page doesn't load them from the CDN.
export const TAILWIND3_MODULES: ReadonlySet<string> = new Set([
  "tailwindcss",
  "tailwindcss/plugin",
  "tailwindcss/colors",
  "tailwindcss/defaultTheme",
  "tailwindcss/resolveConfig",
  "tailwindcss-animate",
  "@tailwindcss/typography",
  "@tailwindcss/forms",
  "@tailwindcss/aspect-ratio",
  "@tailwindcss/container-queries",
]);

export const isTailwind3Module = (spec: string): boolean => TAILWIND3_MODULES.has(spec);

// The config of a Tailwind 3 repository: the one nearest the root.
export function findTailwindConfig(paths: string[]): string | null {
  const configs = paths.filter((p) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(p));
  return configs.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0] ?? null;
}

export const tailwind3Url = (runtimeUrl: string): string => runtimeUrl.replace(/\/[^/]*$/, TAILWIND3_PATH);
