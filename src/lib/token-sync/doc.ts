import { nanoid } from "nanoid";
import type { ColorToken, RadiusToken, ShadowToken, SpacingToken } from "../../store/design-system";
import type { RepoToken } from "../repo-scan/types";
import { normalizeColor } from "./color";
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
    for (const theme of themesRead) {
      const normalized = normalize(kind, token.values[theme]);
      if (normalized === null) { unreadable = true; break; }
      values[theme] = normalized;
    }
    if (unreadable) {
      out.skipped.push({ name: token.name, reason: UNREADABLE[kind] });
      continue;
    }
    if (kind !== "color" && available.length > 1) out.notes.push(`${token.name}: only the ${themesRead[0]} value is synced`);

    out.doc[token.name] = { kind, values };
    out.raw[token.name] = Object.fromEntries(themesRead.map((t) => [t, token.values[t]]));
    const source = Object.values(token.locations).find((l) => l.container === "config" || l.container === "json");
    if (source) out.readonly[token.name] = source.container === "config" ? "Defined in a Tailwind config file, which can't be edited yet" : "Defined in a token JSON file, which can't be edited yet";
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
      if (v !== undefined) values[theme] = normalizeColor(v) ?? v;
    }
    doc[keyOf(c)] = { kind: "color", values };
  }
  for (const r of state.radii) if (r.setId === link.setId) doc[keyOf(r)] = { kind: "radius", values: { [link.baseTheme]: lengthKey(r.value) } };
  for (const s of state.spacing) if (s.setId === link.setId) doc[keyOf(s)] = { kind: "spacing", values: { [link.baseTheme]: lengthKey(s.value) } };
  for (const s of state.shadows) if (s.setId === link.setId) doc[keyOf(s)] = { kind: "shadow", values: { [link.baseTheme]: shadowValue(s) } };
  return doc;
}

// ── Applying a document to Motif ──────────────────────────────────────────────

// "primary" and "primary-foreground" share a group; everything else is "base".
export function colorGroup(name: string, all: string[]): string {
  const stem = name.replace(/-foreground$/, "");
  return all.includes(stem) && all.includes(`${stem}-foreground`) ? stem : "base";
}

const firstValue = (t: SyncToken, baseTheme: string) => t.values[baseTheme] ?? Object.values(t.values)[0];

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
    for (const [theme, id] of themeIds) {
      const next = token.values[theme] ?? fallback;
      // Keep the text Motif already has when it means the same color.
      themeValues[id] = previous[id] !== undefined && normalizeColor(previous[id]) === next ? previous[id] : next;
    }
    return { themeValues, value: themeValues[activeThemeId] ?? Object.values(themeValues)[0] };
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
