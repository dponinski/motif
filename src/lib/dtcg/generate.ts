import { colorToCss, isColorValue } from "./color";
import { walk, type Flat } from "./flat";
import { THEME_NAMESPACES } from "./names";
import type { DtcgConfig, DtcgFiles } from "./types";

// The stylesheet the design tokens files come to: what the scaffolded Style Dictionary config writes (and what Motif writes, so a repository
// works without a build step, and the pull request shows the real result). A token is a variable named by its path; a reference is
// `var()` of the variable it names, so a theme that changes a token changes everything that refers to it.
//
// style-dictionary.config.mjs (lib/dtcg/scaffold.ts) does the same with the same rules: keep the two together. A test runs the real
// package over the same files and compares.

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const HEADER = "/**\n * Generated from the design tokens files by `npm run tokens:build`. Do not edit directly.\n */\n";

// The parts of a text style that go after its size, as the suffix of the size's variable (`--text-heading--line-height`).
const SUFFIX: Record<string, string> = { lineHeight: "line-height", letterSpacing: "letter-spacing", fontWeight: "font-weight", fontFamily: "font-family" };

const refText = (v: string) => v.replace(/^\{([^{}]+)\}$/, (_, p: string) => `var(--${p.split(".").join("-")})`);

function valueText(v: unknown): string {
  if (typeof v === "string") return refText(v);
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  if (isObject(v)) {
    if (isColorValue(v)) return colorToCss(v) ?? "";
    if ("value" in v && "unit" in v) return `${v.value}${v.unit}`;
  }
  return String(v);
}

// The variables a token is: a name and a value each.
export function variablesOf(path: string[], type: string | undefined, value: unknown, ext: Obj): [string, string][] {
  const name = `--${path.join("-")}`;
  if (type === "typography" && isObject(value)) {
    const out: [string, string][] = [];
    if ("fontSize" in value) out.push([name, valueText(value.fontSize)]);
    for (const [prop, suffix] of Object.entries(SUFFIX)) if (prop in value) out.push([`${name}--${suffix}`, valueText(value[prop])]);
    return out;
  }
  if (type === "shadow" && isObject(value)) {
    if (typeof ext.raw === "string") return [[name, ext.raw]];
    const part = (key: string) => (key in value ? valueText(value[key]) : "0");
    const parts = [value.inset === true ? "inset" : null, part("offsetX"), part("offsetY"), part("blur"), part("spread"), "color" in value ? valueText(value.color) : null];
    return [[name, parts.filter((p) => p !== null).join(" ")]];
  }
  return [[name, valueText(value)]];
}

// The trees of files put together: a group is merged into the group of the same name, anything else is replaced.
function merge(into: Obj, from: Obj): Obj {
  for (const [key, val] of Object.entries(from)) {
    const have = into[key];
    into[key] = isObject(have) && isObject(val) && !("$value" in have) && !("$value" in val) ? merge(have, val) : val;
  }
  return into;
}

function flatten(trees: Obj[]): Flat[] {
  const out: Flat[] = [];
  const all: Flat[] = [];
  walk(trees.reduce((merged, t) => merge(merged, t), {}), [], undefined, "", all);
  // A composition of your own is the tokens it is made of.
  for (const f of all) out.push(...(f.children ?? [f]));
  return out;
}

const block = (selector: string, lines: [string, string][]) => `${selector} {\n${lines.map(([n, v]) => `  ${n}: ${v};`).join("\n")}\n}`;

// The files in the order they are put together (the sets in the order of the config), for the base values or a theme's.
export function filesOf(config: DtcgConfig, dir: string, theme: string | null): string[] {
  const suffix = theme ? `.${theme}` : "";
  return config.files === "single" ? [`${dir}/tokens${suffix}.json`] : config.sets.map((s) => `${dir}/${s.key}${suffix}.json`);
}

export function generateCss(files: DtcgFiles): string {
  const configPath = Object.keys(files).find((f) => f.endsWith("/tokens.config.json") || f === "tokens.config.json");
  if (!configPath) throw new Error("There is no tokens.config.json");
  const config = JSON.parse(files[configPath]) as DtcgConfig;
  const dir = configPath.includes("/") ? configPath.slice(0, configPath.lastIndexOf("/")) : ".";
  const load = (theme: string | null) => filesOf(config, dir, theme).filter((f) => f in files).map((f) => JSON.parse(files[f]) as Obj);

  const base = flatten(load(null));
  const inTheme: [string, string][] = [];
  const inRoot: [string, string][] = [];
  for (const f of base) {
    for (const v of variablesOf(f.path, f.type, f.value, f.ext)) (config.tailwind && f.path.length > 1 && THEME_NAMESPACES.has(f.path[0]) ? inTheme : inRoot).push(v);
  }

  const blocks: string[] = [];
  if (config.tailwind) {
    if (inTheme.length) blocks.push(block("@theme", inTheme));
    if (inRoot.length) blocks.push(block(":root", inRoot));
  } else if (inTheme.length || inRoot.length) {
    blocks.push(block(":root", [...inTheme, ...inRoot]));
  }

  // The tokens a theme changes, with the type of the token they change.
  const typeAt = new Map(base.map((f) => [f.path.join("."), f]));
  for (const [key, selector] of Object.entries(config.selectors ?? {})) {
    const lines: [string, string][] = [];
    for (const f of flatten(load(key))) {
      const was = typeAt.get(f.path.join("."));
      for (const v of variablesOf(f.path, f.type ?? was?.type, f.value, was?.ext ?? f.ext)) lines.push(v);
    }
    if (lines.length) blocks.push(block(selector, lines));
  }

  return `${HEADER}${blocks.length ? `\n${blocks.join("\n\n")}\n` : ""}`;
}

