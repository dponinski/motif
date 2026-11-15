import { finalizeTokens, newAccumulator, scanCss } from "../repo-scan/tokens";
import { cssName } from "../token-sync/doc";
import { normalizeColor } from "../token-sync/color";
import { aliasTarget } from "./alias";
import { tokenKey } from "./alias-colors";
import type { ColorToken } from "../../store/design-system";
import { normalizeShadow, parseLengthPx, parseShadow } from "../token-sync/values";
import type { Draft } from "./drafts";

// Tokens from text that was pasted: CSS custom properties (read the way a repository's are, with a `.dark` block as the dark theme),
// a W3C design tokens file, or plain lines: `primary #6366f1`, `space-4: 16px`, or just a list of colors.

export interface ThemeRef { id: string; name: string }

export interface Parsed {
  format: "empty" | "css" | "json" | "lines";
  drafts: Draft[];
  // What was left out, and why.
  notes: string[];
}

const RADIUS_NAME = /radius|rounded|radii|corner/i;

// What a piece of text is worth as a token: a color, a shadow, or a length.
export function valueKind(text: string): "color" | "shadow" | "length" | null {
  const t = text.trim();
  if (!t) return null;
  if (normalizeColor(t) !== null) return "color";
  if (/\s/.test(t) && parseShadow(t) !== null) return "shadow";
  if (parseLengthPx(t) !== null) return "length";
  if (/^-?\d*\.?\d+$/.test(t)) return "length";
  return null;
}

const lengthOf = (text: string): number | null => {
  const px = parseLengthPx(text);
  if (px !== null) return px;
  return /^-?\d*\.?\d+$/.test(text.trim()) ? parseFloat(text) : null;
};

function shadowDraft(name: string, text: string): Draft | null {
  const layers = parseShadow(text);
  const first = layers?.[0];
  if (!layers || !first) return null;
  return {
    kind: "shadow", name, x: first.x, y: first.y, blur: first.blur, spread: first.spread, color: first.color,
    inset: first.inset ? true : undefined, raw: layers.length > 1 ? (normalizeShadow(text) ?? undefined) : undefined,
  };
}

// A value as a draft of a kind, given the name it has (which says radius from spacing when the value can't).
function draftOf(name: string, text: string, themes: ThemeRef[], themeValues?: Record<string, string>): Draft | { reason: string } {
  switch (valueKind(text)) {
    case "color": return { kind: "color", name, values: themeValues ?? Object.fromEntries(themes.slice(0, 1).map((t) => [t.id, text.trim()])) };
    case "shadow": return shadowDraft(name, text) ?? { reason: "isn't a shadow Motif can read" };
    case "length": { const n = lengthOf(text)!; return { kind: RADIUS_NAME.test(name) ? "radius" : "spacing", name, value: n }; }
    default: return { reason: /^var\(/i.test(text.trim()) ? "refers to another token (var()), which Motif keeps between colors only" : "isn't a color, a length or a shadow Motif can read" };
  }
}

const dedupe = (drafts: Draft[]): Draft[] => {
  const seen = new Map<string, Draft>();
  for (const d of drafts) seen.set(`${d.kind}:${d.name}`, d);
  return [...seen.values()];
};

// ── CSS ───────────────────────────────────────────────────────────────────────

// The colors the set has, by the key a token is known by in the repository: what each is in each theme (by id).
export type Known = Record<string, Record<string, string>>;
export const knownOf = (colors: ColorToken[], setId: string): Known => Object.fromEntries(colors.filter((c) => c.setId === setId).map((c) => [tokenKey(c), c.themeValues]));

async function fromCss(text: string, themes: ThemeRef[], known: Known): Promise<Parsed> {
  // Declarations with no rule around them are taken as `:root`'s.
  const css = text.includes("{") ? text : `:root {\n${text}\n}`;
  const acc = newAccumulator();
  const warnings: string[] = [];
  await scanCss([{ path: "pasted.css", text: css }], acc, warnings);
  const { tokens } = finalizeTokens(acc);
  const notes = [...warnings];
  const drafts: Draft[] = [];
  const lost = new Set<string>();

  // The theme of the pasted text that each of this set's themes takes its values from.
  const themeFor = (key: string): ThemeRef | null => {
    const byName = themes.find((t) => t.name.toLowerCase() === key.toLowerCase());
    if (byName) return byName;
    return ["default", "light", "base"].includes(key) ? themes[0] ?? null : null;
  };

  const byName = new Map(tokens.map((t) => [t.name, t]));
  // What a token the text refers to is, in a theme of the text: the text's own, then the set's.
  const resolve = (name: string, key: string, theme: ThemeRef, depth = 0): string | null => {
    const own = byName.get(name);
    if (own && own.kind !== "font") {
      const v = own.values[key] ?? own.values.default ?? Object.values(own.values)[0];
      if (v === undefined || depth > 8) return null;
      const next = aliasTarget(v);
      return next === null ? (normalizeColor(v) === null ? null : v.trim()) : resolve(next, key, theme, depth + 1);
    }
    return known[name]?.[theme.id] ?? null;
  };

  for (const token of tokens) {
    const first = Object.values(token.values)[0] ?? "";
    // A color that is a color the set has already is a color, though the text doesn't say what the other one is.
    const aliasOfKnown = token.kind === "other" && Object.values(token.values).every((v) => { const t = aliasTarget(v); return t !== null && (byName.get(t)?.kind === "color" || t in known); });
    if (!aliasOfKnown && (token.kind === "font" || token.kind === "other")) {
      notes.push(`${token.name}: ${aliasTarget(first) !== null ? `refers to ${aliasTarget(first)}, which isn't a color in the text or this set` : token.kind === "font" ? "Motif has no font tokens yet" : "isn't a color, a length or a shadow"}`);
      continue;
    }
    if (token.kind === "color" || aliasOfKnown) {
      const values: Record<string, string> = {};
      const aliases: Record<string, string> = {};
      let unreadable = false;
      let why = "Motif can't read this color (it may use color-mix())";
      for (const [key, v] of Object.entries(token.values)) {
        const target = aliasTarget(v);
        const theme = themeFor(key);
        if (target !== null) {
          const resolved = theme ? resolve(target, key, theme) : null;
          if (theme && resolved === null) { unreadable = true; why = `refers to ${target}, which isn't a color in the text or this set`; break; }
          if (theme) { values[theme.id] = resolved!; aliases[theme.id] = target; } else lost.add(key);
          continue;
        }
        if (normalizeColor(v) === null) { unreadable = true; break; }
        if (theme) values[theme.id] = v.trim(); else lost.add(key);
      }
      if (unreadable) { notes.push(`${token.name}: ${why}`); continue; }
      if (Object.keys(values).length === 0 && themes[0]) values[themes[0].id] = first.trim();
      drafts.push({ kind: "color", name: token.name, values, ...(Object.keys(aliases).length ? { aliases } : {}) });
      continue;
    }
    if (token.kind === "radius" || token.kind === "spacing") {
      const n = lengthOf(first);
      if (n === null) { notes.push(`${token.name}: Motif can only read px and rem lengths`); continue; }
      drafts.push({ kind: token.kind, name: token.name, value: n });
      continue;
    }
    const shadow = shadowDraft(token.name, first);
    if (shadow) drafts.push(shadow); else notes.push(`${token.name}: Motif can't read this shadow`);
  }
  for (const key of lost) notes.push(`Theme "${key}" isn't one of this set's themes, so its values were left out (add a theme called ${key} to the set to bring them in)`);
  return { format: "css", drafts: dedupe(drafts), notes };
}

// ── W3C design tokens ─────────────────────────────────────────────────────────

const CATEGORY = /^(colors?|spacing|space|radius|radii|border-?radius|shadows?|dimension|sizes?)$/i;

function fromJson(root: unknown, themes: ThemeRef[]): Parsed {
  const drafts: Draft[] = [];
  const notes: string[] = [];
  const walk = (node: unknown, path: string[], inherited: string | undefined) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const o = node as Record<string, unknown>;
    const type = (o.$type ?? o.type ?? inherited) as string | undefined;
    const hasValue = "$value" in o || ("value" in o && typeof o.value !== "object");
    if (hasValue) {
      const value = (o.$value ?? o.value) as unknown;
      const parts = CATEGORY.test(path[0] ?? "") && path.length > 1 ? path.slice(1) : path;
      const name = cssName(parts.join("-"));
      if (type === "color" || (typeof value === "string" && normalizeColor(value) !== null && type !== "dimension")) {
        if (typeof value === "string" && normalizeColor(value) !== null) drafts.push({ kind: "color", name, values: Object.fromEntries(themes.slice(0, 1).map((t) => [t.id, value])) });
        else notes.push(`${name}: this color isn't written as text Motif can read`);
      } else if (type === "dimension" || type === "spacing" || type === "borderRadius" || (typeof value === "string" && lengthOf(value) !== null)) {
        const raw = String(value).trim();
        // 50% is how a fully round corner is written; Motif keeps it as a very large radius.
        const n = raw === "50%" ? 9999 : typeof value === "number" ? value : lengthOf(raw);
        if (n === null) notes.push(`${name}: Motif can only read px and rem lengths`);
        else drafts.push({ kind: RADIUS_NAME.test(path.join("-")) || type === "borderRadius" ? "radius" : "spacing", name, value: n });
      } else if (type === "shadow") {
        const text = typeof value === "string" ? value : value && typeof value === "object" && !Array.isArray(value)
          ? `${(value as Record<string, unknown>).x ?? 0}px ${(value as Record<string, unknown>).y ?? 0}px ${(value as Record<string, unknown>).blur ?? 0}px ${(value as Record<string, unknown>).spread ?? 0}px ${(value as Record<string, unknown>).color ?? "#00000040"}`
          : "";
        const draft = text ? shadowDraft(name, text) : null;
        if (draft) drafts.push(draft); else notes.push(`${name}: Motif can't read this shadow`);
      } else {
        notes.push(`${name}: ${type ? `"${type}" tokens aren't kept in Motif yet` : "no type, and it isn't a color or a length"}`);
      }
      return;
    }
    for (const [key, child] of Object.entries(o)) if (!key.startsWith("$")) walk(child, [...path, key], type);
  };
  walk(root, [], undefined);
  return { format: "json", drafts: dedupe(drafts), notes };
}

// ── Lines ─────────────────────────────────────────────────────────────────────

// Pieces of a line, keeping a function with its arguments together (`rgb(1 2 3)`).
const PIECES = /[a-z-]+\([^)]*\)|[^\s,;]+/gi;

function fromLines(text: string, themes: ThemeRef[], prefix: string): Parsed {
  const drafts: Draft[] = [];
  const notes: string[] = [];
  let colors = 0, lengths = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/[;,]+\s*$/, "").trim();
    if (!line) return;
    const where = `Line ${i + 1}`;

    // `name: value`, `name = value`, `--name: value`.
    const named = /^(--)?([^\s:=][^:=]*?)\s*[:=]\s*(.+)$/.exec(line);
    if (named) {
      const d = draftOf(cssName(named[2]), named[3].trim(), themes);
      if ("reason" in d) notes.push(`${where}: "${named[3].trim()}" ${d.reason}`); else drafts.push(d);
      return;
    }
    // `name value`: the first word is the name when what follows is a value.
    const space = /^([\w.-]+)\s+(.+)$/.exec(line);
    if (space && valueKind(space[2]) && !valueKind(space[1])) {
      const d = draftOf(cssName(space[1]), space[2].trim(), themes);
      if ("reason" in d) notes.push(`${where}: "${space[2].trim()}" ${d.reason}`); else drafts.push(d);
      return;
    }
    // Values with no names: one, or several on the line.
    const pieces = line.match(PIECES) ?? [];
    const whole = valueKind(line);
    const values = whole ? [line] : pieces;
    if (values.length === 0 || !values.every((v) => valueKind(v))) { notes.push(`${where}: "${line}" isn't a name and a value, or a value`); return; }
    for (const v of values) {
      const kind = valueKind(v)!;
      const auto = kind === "color" ? prefix : kind === "shadow" ? "shadow" : "space";
      const n = kind === "color" ? ++colors : kind === "shadow" ? drafts.filter((d) => d.kind === "shadow").length + 1 : ++lengths;
      const d = draftOf(`${auto}-${n}`, v.trim(), themes);
      if ("reason" in d) notes.push(`${where}: "${v}" ${d.reason}`); else drafts.push({ ...d, auto: { prefix: auto } });
    }
  });
  return { format: "lines", drafts: dedupe(drafts), notes };
}

// ── Which it is ───────────────────────────────────────────────────────────────

export async function parsePaste(text: string, themes: ThemeRef[], options: { prefix?: string; known?: Known } = {}): Promise<Parsed> {
  const t = text.trim();
  if (!t) return { format: "empty", drafts: [], notes: [] };
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return fromJson(JSON.parse(t), themes); } catch { /* it is not JSON: it may be CSS */ }
  }
  // CSS when there are rules, or when every line is a custom property; a mix of forms is read line by line.
  const lines = t.split(/\r?\n/).map((l) => l.replace(/\/\*.*?\*\//g, "").trim()).filter((l) => l && !l.startsWith("//"));
  if (t.includes("{") || (lines.length > 0 && lines.every((l) => /^--[\w-]+\s*:/.test(l)))) return fromCss(t, themes, options.known ?? {});
  return fromLines(t, themes, cssName(options.prefix || "color"));
}
