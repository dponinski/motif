import { nanoid } from "nanoid";
import type { ColorToken, RadiusToken, ShadowToken, SpacingToken } from "../../store/design-system";
import type { RepoToken } from "../repo-scan/types";
import { normalizeColor } from "./color";
import { deriveGroup } from "../tokens/organize";
import { aliasTarget, varRef } from "../tokens/alias";
import { normalizeShadow, parseLengthPx, parseShadow, shadowKey } from "./values";

// What is compared between Motif and a repository: tokens by repository name, each with one
// normalized value per theme. Normalizing is what lets `oklch(...)` in the repo and `#4f46e5`
// in Motif count as the same color.

export type SyncKind = "color" | "radius" | "spacing" | "shadow";

export interface SyncToken {
  kind: SyncKind;
  values: Record<string, string>;
}

export type SyncDoc = Record<string, SyncToken>;

export const lengthKey = (px: number) => String(parseFloat(px.toFixed(4)));

const KIND: Partial<Record<RepoToken["kind"], SyncKind>> = { color: "color", radius: "radius", spacing: "spacing", shadow: "shadow" };

function normalize(kind: SyncKind, text: string): string | null {
  if (kind === "color") return normalizeColor(text);
  if (kind === "shadow") return normalizeShadow(text);
  const px = parseLengthPx(text);
  return px === null ? null : lengthKey(px);
}

// Why a token that is another token can't be kept as one: Motif keeps these between colors, and the one it points at has to be a
// color of the repository's that doesn't point back.
function aliasProblem(byName: Map<string, RepoToken>, name: string, target: string): string | null {
  const seen = new Set([name]);
  for (let at: string | undefined = target, depth = 0; at !== undefined; depth++) {
    const t = byName.get(at);
    if (!t || t.kind !== "color") return `refers to ${at}, which isn't a color of the repository's that Motif can read`;
    if (seen.has(at) || depth > 8) return `refers to ${at}, which leads back to this token`;
    seen.add(at);
    const next = Object.values(t.values).map(aliasTarget).find((x) => x !== null);
    at = next ?? undefined;
  }
  return null;
}

const UNREADABLE: Record<SyncKind, string> = {
  color: "Motif can't read this color (it may use var() or color-mix())",
  radius: "Motif can only read px and rem lengths",
  spacing: "Motif can only read px and rem lengths",
  shadow: "Motif can't read this shadow",
};

export interface RepoSnapshot {
  doc: SyncDoc;
  // The text each value was written as, to write edits in the same notation.
  raw: Record<string, Record<string, string>>;
  // Tokens whose source can't be edited in place yet, with why.
  readonly: Record<string, string>;
  skipped: { name: string; reason: string }[];
  notes: string[];
  baseTheme: string;
}

export function readRepoTokens(tokens: RepoToken[], themes: string[]): RepoSnapshot {
  const baseTheme = themes[0] ?? "default";
  const out: RepoSnapshot = { doc: {}, raw: {}, readonly: {}, skipped: [], notes: [], baseTheme };
  const byName = new Map(tokens.map((t) => [t.name, t]));

  for (const token of tokens) {
    const kind = KIND[token.kind];
    if (!kind) {
      out.skipped.push({ name: token.name, reason: token.kind === "font" ? "Motif has no font family tokens yet" : "Only colors, radius, spacing and shadows are synced" });
      continue;
    }
    const available = Object.keys(token.values);
    const themesRead = kind === "color" ? available : [baseTheme in token.values ? baseTheme : available[0]];
    const values: Record<string, string> = {};
    let unreadable = false;
    let why = UNREADABLE[kind];
    for (const theme of themesRead) {
      const target = aliasTarget(token.values[theme]);
      if (target !== null) {
        // A color that is another color is kept as that: what is compared and written is `var(--target)`.
        const problem = kind === "color" ? aliasProblem(byName, token.name, target) : "refers to another token; Motif keeps aliases between colors only";
        if (problem) { unreadable = true; why = problem; break; }
        values[theme] = varRef(target);
        continue;
      }
      // Bare channels are the color of the function a config wraps them in.
      const normalized = normalize(kind, token.channels ? `${token.channels}(${token.values[theme]})` : token.values[theme]);
      if (normalized === null) { unreadable = true; break; }
      values[theme] = normalized;
    }
    if (unreadable) {
      out.skipped.push({ name: token.name, reason: why });
      continue;
    }
    if (kind !== "color" && available.length > 1) out.notes.push(`${token.name}: only the ${themesRead[0]} value is synced`);

    out.doc[token.name] = { kind, values };
    out.raw[token.name] = Object.fromEntries(themesRead.map((t) => [t, token.values[t]]));
    // A value written out in a Tailwind config is changed in place; one that is computed there, or in a token JSON file, isn't.
    const source = Object.values(token.locations).find((l) => (l.container === "config" && !l.path) || l.container === "json");
    if (source) out.readonly[token.name] = source.container === "config" ? "Its value in the Tailwind config is computed, not written out, so Motif can't change it" : "Defined in a token JSON file, which can't be edited yet";
  }
  return out;
}

// ── Motif side ────────────────────────────────────────────────────────────────

export interface LinkShape {
  setId: string;
  // Repository theme key -> Motif theme id.
  themes: Record<string, string>;
  baseTheme: string;
}

export interface TokenSlices {
  colors: ColorToken[];
  spacing: SpacingToken[];
  radii: RadiusToken[];
  shadows: ShadowToken[];
}

// A name that is valid as a CSS custom property, which is also how it will be found again in the repository.
export const cssName = (name: string) => {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[0-9]/.test(slug) ? `t-${slug}` : slug || "token";
};

const keyOf = (t: { name: string; repoName?: string }) => t.repoName ?? cssName(t.name);

function shadowValue(t: ShadowToken): string {
  const rest = (t.raw ? parseShadow(t.raw) : null)?.slice(1).map(shadowKey) ?? [];
  return [shadowKey({ ...t, inset: t.inset }), ...rest].join(", ");
}

export function readMotifTokens(state: TokenSlices, link: LinkShape): SyncDoc {
  const doc: SyncDoc = {};
  for (const c of state.colors) {
    if (c.setId !== link.setId) continue;
    const values: Record<string, string> = {};
    for (const [theme, id] of Object.entries(link.themes)) {
      const v = c.themeValues[id];
      const alias = c.themeAlias?.[id];
      if (alias) values[theme] = varRef(alias);
      else if (v !== undefined) values[theme] = normalizeColor(v) ?? v;
    }
    doc[keyOf(c)] = { kind: "color", values };
  }
  for (const r of state.radii) if (r.setId === link.setId) doc[keyOf(r)] = { kind: "radius", values: { [link.baseTheme]: lengthKey(r.value) } };
  for (const s of state.spacing) if (s.setId === link.setId) doc[keyOf(s)] = { kind: "spacing", values: { [link.baseTheme]: lengthKey(s.value) } };
  for (const s of state.shadows) if (s.setId === link.setId) doc[keyOf(s)] = { kind: "shadow", values: { [link.baseTheme]: shadowValue(s) } };
  return doc;
}

// ── Applying a document to Motif ──────────────────────────────────────────────

// A ramp (`gray-50` … `gray-950`) is a group, and so are "primary" and "primary-foreground"; everything else is "base".
export function colorGroup(name: string, all: string[]): string {
  return deriveGroup(name, all);
}

const firstValue = (t: SyncToken, baseTheme: string) => t.values[baseTheme] ?? Object.values(t.values)[0];

// What a color token is in a theme, following the tokens it is (`var(--gray-12)` is what gray-12 is). Null when it leads nowhere.
export function resolveInDoc(doc: SyncDoc, name: string, theme: string, baseTheme: string, depth = 0): string | null {
  const t = doc[name];
  if (!t || t.kind !== "color" || depth > 8) return null;
  const value = t.values[theme] ?? firstValue(t, baseTheme);
  if (value === undefined) return null;
  const next = aliasTarget(value);
  return next === null ? value : resolveInDoc(doc, next, theme, baseTheme, depth + 1);
}

// The same document with every color that is another token given as the color it comes to, for what shows colors and has no use for
// the link between them (the swatches in the inspector).
export function resolveDoc(doc: SyncDoc, baseTheme: string): SyncDoc {
  const out: SyncDoc = {};
  for (const [name, t] of Object.entries(doc)) {
    if (t.kind !== "color") { out[name] = t; continue; }
    out[name] = { ...t, values: Object.fromEntries(Object.entries(t.values).map(([theme, v]) => [theme, aliasTarget(v) === null ? v : (resolveInDoc(doc, name, theme, baseTheme) ?? v)])) };
  }
  return out;
}

export function applyDoc(state: TokenSlices, link: LinkShape, doc: SyncDoc, activeThemeId: string): TokenSlices {
  const entries = Object.entries(doc);
  const names = entries.filter(([, t]) => t.kind === "color").map(([n]) => n);
  const themeIds = Object.entries(link.themes);

  const sync = <T extends { name: string; repoName?: string; setId: string }>(
    existing: T[],
    kind: SyncKind,
    update: (current: T, token: SyncToken) => T,
    create: (name: string, token: SyncToken) => T
  ): T[] => {
    const seen = new Set<string>();
    const next: T[] = [];
    for (const item of existing) {
      if (item.setId !== link.setId) { next.push(item); continue; }
      const key = keyOf(item);
      const token = doc[key];
      if (token?.kind === kind) { next.push(update(item, token)); seen.add(key); }
    }
    for (const [name, token] of entries) if (token.kind === kind && !seen.has(name)) next.push(create(name, token));
    return next;
  };

  const colorValues = (token: SyncToken, previous: Record<string, string> = {}) => {
    const fallback = firstValue(token, link.baseTheme);
    const themeValues: Record<string, string> = { ...previous };
    const themeAlias: Record<string, string> = {};
    for (const [theme, id] of themeIds) {
      const raw = token.values[theme] ?? fallback;
      // A color that is another token shows as the color that one is, and remembers which it is.
      const target = aliasTarget(raw);
      const next = target === null ? raw : (resolveInDoc(doc, target, theme, link.baseTheme) ?? previous[id] ?? "#000000");
      if (target !== null) themeAlias[id] = target;
      // Keep the text Motif already has when it means the same color.
      themeValues[id] = previous[id] !== undefined && normalizeColor(previous[id]) === next ? previous[id] : next;
    }
    return { themeValues, themeAlias: Object.keys(themeAlias).length ? themeAlias : undefined, value: themeValues[activeThemeId] ?? Object.values(themeValues)[0] };
  };

  const colors = sync<ColorToken>(
    state.colors, "color",
    (c, t) => ({ ...c, repoName: keyOf(c), ...colorValues(t, c.themeValues) }),
    (name, t) => ({ id: nanoid(6), name, repoName: name, group: colorGroup(name, names), setId: link.setId, ...colorValues(t) })
  );

  const px = (t: SyncToken) => parseFloat(firstValue(t, link.baseTheme));
  const radii = sync<RadiusToken>(
    state.radii, "radius",
    (r, t) => ({ ...r, repoName: keyOf(r), value: px(t) }),
    (name, t) => ({ id: nanoid(6), name, repoName: name, value: px(t), setId: link.setId })
  );
  const spacing = sync<SpacingToken>(
    state.spacing, "spacing",
    (s, t) => ({ ...s, repoName: keyOf(s), value: px(t) }),
    (name, t) => ({ id: nanoid(6), name, repoName: name, value: px(t), setId: link.setId })
  );

  const shadowFields = (t: SyncToken, previousColor?: string) => {
    const layers = parseShadow(firstValue(t, link.baseTheme)) ?? [];
    const first = layers[0];
    return {
      x: first?.x ?? 0, y: first?.y ?? 0, blur: first?.blur ?? 0, spread: first?.spread ?? 0,
      color: previousColor !== undefined && normalizeColor(previousColor) === first?.color ? previousColor : (first?.color ?? "#00000000"),
      group: first?.inset ? "inner" : "default",
      inset: first?.inset ? true : undefined,
      raw: layers.length > 1 ? firstValue(t, link.baseTheme) : undefined,
    };
  };
  const shadows = sync<ShadowToken>(
    state.shadows, "shadow",
    (s, t) => ({ ...s, repoName: keyOf(s), ...shadowFields(t, s.color) }),
    (name, t) => ({ id: nanoid(6), name, repoName: name, setId: link.setId, ...shadowFields(t) })
  );

  return { colors, spacing, radii, shadows };
}
