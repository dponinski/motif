import type { RepoAnalysis, RepoToken } from "../repo-scan/types";
import { readRepoTokens } from "../token-sync/doc";
import { newTokensPath, themeLabel } from "../token-sync/flow";
import { tokensDirFor } from "./export";
import { deriveGroup } from "../tokens/organize";
import { aliasTarget } from "../tokens/alias";
import { ALL_THEMES, TOKENS_VERSION, type Composition, type StoredTokenData, type Token, type Unit } from "../tokens/model";
import { parseShadow } from "../token-sync/values";
import { cssToColor } from "./color";
import { COMPOSITION_NAMESPACE, leafOf, pathOf, repoNameOfPlace, slug, THEME_NAMESPACES } from "./names";
import type { DtcgFiles, Skipped } from "./types";
import { writeDtcg } from "./write";

// A repository whose tokens are variables in its stylesheets, read as design tokens files without touching the repository: each variable
// Motif can keep becomes a token (a color, a length, a shadow) with the name the variable has, the files are what writing those tokens
// gives, and everything else stays where it is. Pull works on these files as it does on a repository's own, so the first Push is what
// makes them real (lib/dtcg/convert-edit.ts).
//
// Where a variable goes decides what it is called in the files and what is generated for it:
//   - a variable of a rule (`--primary` in `:root` or `.dark`) is a token of the top level of the files, written back as `--primary`;
//   - a variable of `@theme` named by a Tailwind namespace (`--color-brand`, `--radius-lg`) is that token in that group (`color.brand`).
// Anything declared another way (inside `@media` or `@layer`, in a rule that isn't the base or a theme's, a calc(), a font) is left alone.

export interface Conversion {
  // The design tokens files the variables come to (the repository doesn't have them yet).
  files: DtcgFiles;
  model: StoredTokenData;
  // The variables that became tokens (`--primary` is `primary`), and the selector each theme's values are under.
  converted: string[];
  // Where each one is declared: in a rule (`--primary` in `:root`) or in `@theme`.
  containers: Record<string, "rule" | "theme">;
  selectors: Record<string, string>;
  // What stays in the stylesheets, and why.
  left: Skipped[];
}

export interface ConvertInput {
  tokens: RepoToken[];
  // The repository's theme keys; the first is the base.
  themes: string[];
  tailwind: boolean;
  name: string;
  dir: string;
  output: string;
}

const BASE_SELECTORS = new Set([":root", "html", ":root, :host", ":host, :root"]);
const WRITABLE: RepoToken["kind"][] = ["color", "radius", "spacing", "shadow"];

const unitOf = (text: string): { n: number; unit: Unit } | null => {
  const m = text.trim().toLowerCase().match(/^([-+]?(?:\d+\.?\d*|\.\d+))(px|rem)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] ? { n, unit: m[2] as Unit } : n === 0 ? { n, unit: "px" } : null;
};

// Where a variable of `@theme` goes: its namespace and the rest of the name (`color-brand` is `color` and `brand`).
function themePlace(name: string): string[] | null {
  const ns = [...THEME_NAMESPACES].filter((n) => name.startsWith(`${n}-`)).sort((a, b) => b.length - a.length)[0];
  const rest = ns ? name.slice(ns.length + 1) : "";
  return ns && rest && slug(rest) === rest ? [ns, rest] : null;
}

export function convertTokens(input: ConvertInput): Conversion | null {
  const themes = input.themes.length ? input.themes : ["default"];
  const base = themes[0];
  const snapshot = readRepoTokens(input.tokens, themes);
  const left: Skipped[] = snapshot.skipped.map((s) => ({ name: s.name, reason: s.reason }));
  const byName = new Map(input.tokens.map((t) => [t.name, t]));

  // The selector each theme's variables are in (the one most of them are in), and that the base ones are in.
  const counts = new Map<string, Map<string, number>>();
  for (const t of input.tokens) {
    for (const [theme, loc] of Object.entries(t.locations)) {
      if (loc.container !== "css-var" || loc.selector === undefined) continue;
      const per = counts.get(theme) ?? counts.set(theme, new Map()).get(theme)!;
      per.set(loc.selector, (per.get(loc.selector) ?? 0) + 1);
    }
  }
  const selectorOf = (theme: string): string | undefined => [...(counts.get(theme) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Which variables can be tokens, and where each goes.
  const places = new Map<string, string[]>();
  const why = (t: RepoToken, reason: string) => left.push({ name: t.name, reason });
  for (const t of input.tokens) {
    if (!WRITABLE.includes(t.kind) || !(t.name in snapshot.doc)) continue;
    const locs = Object.entries(t.locations);
    const inRules = locs.every(([, l]) => l.container === "css-var");
    const inTheme = locs.every(([, l]) => l.container === "theme");
    if (!inRules && !inTheme) { why(t, "It is in a Tailwind config or a token file, not in a stylesheet"); continue; }
    const wrapped = locs.find(([, l]) => l.within);
    if (wrapped) { why(t, `It is declared inside @${wrapped[1].within}, which the generated stylesheet can't reproduce`); continue; }
    if (inRules) {
      const baseSelector = t.locations[base]?.selector;
      if (baseSelector === undefined || !BASE_SELECTORS.has(baseSelector)) { why(t, baseSelector === undefined ? "It has no value in the base theme" : `It is declared in \`${baseSelector}\`, not in :root`); continue; }
      const off = locs.find(([theme, l]) => theme !== base && l.selector !== selectorOf(theme));
      if (off) { why(t, `Its ${off[0]} value is declared in \`${off[1].selector}\`, not in \`${selectorOf(off[0])}\` where the others are`); continue; }
      if (t.kind !== "color" && locs.length > 1) { why(t, "It has a value per theme; Motif keeps lengths and shadows the same in every theme"); continue; }
      if (slug(t.name) !== t.name) { why(t, "Its name isn't one a design tokens file can keep"); continue; }
      if (t.kind === "shadow") { why(t, "A shadow in a rule isn't kept as a token yet; only one in @theme is"); continue; }
      places.set(t.name, [t.name]);
    } else {
      const place = themePlace(t.name);
      const ns = place?.[0];
      const fits = ns === "color" ? t.kind === "color" : ns === "radius" ? t.kind === "radius" : ns === "spacing" ? t.kind === "spacing" : ns === "shadow" ? t.kind === "shadow" : false;
      if (!place || !fits) { why(t, "It is in @theme, but not as a color, radius, spacing or shadow of a Tailwind namespace"); continue; }
      places.set(t.name, place);
    }
  }

  // Values Motif can write: a color it can read, a length in px or rem, a shadow; a color can also be another variable that becomes a token.
  const readable = (t: RepoToken, theme: string, value: string): boolean => {
    if (t.kind === "color") return aliasTarget(value) !== null || cssToColor(t.channels ? `${t.channels}(${value})` : value) !== null;
    if (t.kind === "shadow") return parseShadow(value) !== null;
    return unitOf(value) !== null;
  };
  for (let again = true; again;) {
    again = false;
    for (const name of [...places.keys()]) {
      const t = byName.get(name)!;
      let reason: string | null = null;
      for (const [theme, value] of Object.entries(t.values)) {
        const target = aliasTarget(value);
        if (target !== null) { if (t.kind !== "color" || !places.has(target)) { reason = `It refers to --${target}, which stays in the stylesheet`; break; } }
        else if (t.channels || !readable(t, theme, value)) { reason = t.kind === "color" ? "Motif can't read this color" : t.kind === "shadow" ? "Motif can't read this shadow" : "Motif can only read px and rem lengths"; break; }
      }
      if (reason === null && !(base in t.values)) reason = "It has no value in the base theme";
      if (reason !== null) { places.delete(name); why(t, reason); again = true; }
    }
  }

  // A name that is a token and also a group (`--radius` and `--radius-lg` both) can't be both: the group wins.
  const paths = [...places.values()].map((p) => p.join("."));
  for (const [name, place] of [...places]) {
    if (place.length === 1 && paths.some((p) => p.startsWith(`${place[0]}.`))) { places.delete(name); why(byName.get(name)!, `Its name is also the group of other tokens (${place[0]}.…)`); }
  }
  if (places.size === 0) return null;

  // ── The model ──────────────────────────────────────────────────────────────
  const setId = "set-converted";
  const themeIds = Object.fromEntries(themes.map((key) => [key, `theme-${key}`]));
  const colorNames = [...places.keys()].filter((n) => byName.get(n)!.kind === "color");
  const idOf = (name: string) => `t-${name}`;
  const tokens: Token[] = [];
  const compositions: Composition[] = [];

  for (const [name, place] of places) {
    const t = byName.get(name)!;
    // The name Motif shows is the last part of a token that is in a group, the variable's name otherwise.
    const shown = place.length > 1 ? place[place.length - 1] : name;
    const where = { id: idOf(name), name: shown, setId };
    const natural = (type: Token["type"], use: string) => pathOf(type, use, shown).join(".") === place.join(".");

    if (t.kind === "color") {
      const values: Record<string, string> = {};
      const ref: Record<string, string> = {};
      // A theme the variable has no value in has the base one, as the stylesheet cascades it.
      for (const theme of themes) {
        const value = t.values[theme] ?? t.values[base];
        const target = aliasTarget(value);
        if (target !== null) {
          ref[themeIds[theme]] = idOf(target);
          // What it comes to (the color Motif shows): the target's value in this theme, else its base value.
          const to = byName.get(target)!;
          values[themeIds[theme]] = to.values[theme] ?? to.values[base] ?? "";
        } else values[themeIds[theme]] = value;
      }
      tokens.push({
        ...where, group: deriveGroup(shown, colorNames.map((n) => (places.get(n)!.length > 1 ? places.get(n)![1] : n))), type: "color", values, value: values[themeIds[base]], use: "color",
        ...(Object.keys(ref).length ? { ref } : {}), ...(natural("color", "color") ? {} : { repoName: repoNameOfPlace(place) }),
      });
    } else if (t.kind === "shadow") {
      const layers = parseShadow(t.values[base])!;
      const first = layers[0];
      const slot = (n: string, v: number) => ({ name: n, type: "number" as const, value: String(v), unit: "px" as Unit });
      compositions.push({
        ...where, group: first.inset ? "inner" : "default", kind: "shadow",
        slots: [slot("x", first.x), slot("y", first.y), slot("blur", first.blur), slot("spread", first.spread), { name: "color", type: "color", value: first.color }],
        ...(first.inset ? { inset: true } : {}), ...(layers.length > 1 ? { raw: t.values[base] } : {}),
        ...([COMPOSITION_NAMESPACE.shadow, leafOf(shown, COMPOSITION_NAMESPACE.shadow)].join(".") === place.join(".") ? {} : { repoName: repoNameOfPlace(place) }),
      });
    } else {
      const use = t.kind === "radius" ? "radius" : "spacing";
      const length = unitOf(t.values[base])!;
      tokens.push({
        ...where, type: "number", unit: length.unit, use, values: { [ALL_THEMES]: String(length.n) },
        ...(natural("number", use) ? {} : { repoName: repoNameOfPlace(place) }),
      });
    }
  }

  const selectors: Record<string, string> = {};
  for (const key of themes.slice(1)) selectors[key] = selectorOf(key) ?? `.${key}`;
  const data: StoredTokenData = {
    tokensVersion: TOKENS_VERSION,
    sets: [{ id: setId, name: input.name, repoKey: "tokens", themes: themes.map((key) => ({ id: themeIds[key], name: themeLabel(key), ...(slug(themeLabel(key)) !== key ? { repoKey: key } : {}) })), activeThemeId: themeIds[base] }],
    tokens,
    compositions,
    components: [],
  };
  const written = writeDtcg(data, { files: "single", dir: input.dir, output: input.output, tailwind: input.tailwind, selectors });
  // Whatever the writer couldn't write stays where it is.
  const dropped = new Set(written.skipped.map((s) => s.name));
  for (const s of written.skipped) left.push(s);
  const shownName = (n: string) => { const p = places.get(n)!; return p.length > 1 ? p[p.length - 1] : n; };
  const converted = [...places.keys()].filter((n) => !dropped.has(shownName(n)));
  const containers = Object.fromEntries(converted.map((n) => [n, places.get(n)!.length > 1 ? "theme" as const : "rule" as const]));
  return { files: written.files, model: data, converted, containers, selectors, left };
}

// A repository's tokens as design tokens files, in the place a push would put them: what pull works on until the files are really there.
// Nothing for a Tailwind 3 repository (its tokens are in a config as much as in stylesheets; converting them comes later).
export function convertAnalysis(analysis: RepoAnalysis, name: string): (Conversion & { dir: string; output: string; tailwind: boolean }) | null {
  if (analysis.stack.tailwindVersion === 3) return null;
  const output = newTokensPath(analysis);
  const dir = tokensDirFor(output);
  const tailwind = analysis.stack.tailwindVersion === 4;
  const conv = convertTokens({ tokens: analysis.tokens, themes: analysis.themes, tailwind, name, dir, output });
  return conv && { ...conv, dir, output, tailwind };
}
