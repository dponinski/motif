import type { RepoAnalysis, RepoToken } from "../repo-scan/types";
import { keyPrefixes } from "../token-sync/keys";
import { normalizeColor } from "../token-sync/color";
import type { SyncDoc } from "../token-sync/doc";
import { lengthPx, splitOpacity, swatchOf, unwrapArbitrary } from "./tokens";

// Tokens Motif has and the repository does not (yet), as the inspector and the preview need to see them: a token is usable the moment it
// is made, and goes out with the other changes. What a class is called depends on how the repository names its tokens (see
// lib/token-sync/keys.ts): `--radius-card` is `rounded-card`, a color kept as channels is its config entry, and so on.

export type MakeKind = "color" | "radius" | "spacing" | "shadow";
// `prefix` is what the token's name starts with so that Tailwind has a class for it (`radius-card` is `rounded-card`).
export type MakePlan = { prefix: string } | { reason: string };
export type MakePlans = Record<MakeKind, MakePlan>;

export { usesColorAliases } from "../token-sync/keys";

export function makePlans(tokens: RepoToken[], tailwind: 3 | 4 | null): MakePlans {
  // Without Tailwind a token is a variable, and a stylesheet's controls name it with `var()`.
  if (tailwind === null) return { color: { prefix: "" }, radius: { prefix: "" }, spacing: { prefix: "" }, shadow: { prefix: "" } };
  if (tailwind === 3) {
    // A new token is an entry in the config's `theme.extend` (and for a color the repository keeps as channels, a variable too), so
    // there has to be a config with tokens in it to follow.
    const hasConfig = tokens.some((t) => t.mapping?.path || Object.values(t.locations).some((l) => l.container === "config" && l.path));
    if (!hasConfig) {
      const reason = "This repository has no Tailwind config with tokens that Motif can add to";
      return { color: { reason }, radius: { reason }, spacing: { reason }, shadow: { reason } };
    }
  }
  // Tailwind 4 has a place for every kind (`@theme`, made when the repository has none), so nothing is refused.
  const prefixes = keyPrefixes({ tokens, stack: { tailwindVersion: tailwind } as RepoAnalysis["stack"] });
  return { color: { prefix: prefixes.color ?? "" }, radius: { prefix: prefixes.radius ?? "" }, spacing: { prefix: prefixes.spacing ?? "" }, shadow: { prefix: prefixes.shadow ?? "" } };
}

const KINDS: ReadonlySet<string> = new Set(["color", "radius", "spacing", "shadow"]);

export interface MotifOnly {
  // As the repository's own tokens are, so the inspector offers them like any other.
  tokens: RepoToken[];
  // What a Tailwind 4 preview needs to have a class for each (`@theme` lines), as a stylesheet of its own.
  themeCss: string;
}

// The tokens of `doc` (Motif's, by their name in the repository) that `repoTokens` doesn't have, and that a class can name.
export function motifOnlyTokens(doc: SyncDoc, repoTokens: RepoToken[], tailwind: 3 | 4 | null): MotifOnly {
  const plans = makePlans(repoTokens, tailwind);
  const have = new Set(repoTokens.map((t) => t.name));
  const tokens: RepoToken[] = [];
  const inline: string[] = [];
  const theme: string[] = [];
  for (const [name, t] of Object.entries(doc)) {
    if (have.has(name) || !KINDS.has(t.kind)) continue;
    const kind = t.kind as MakeKind;
    const plan = plans[kind];
    if ("reason" in plan) continue;
    const values = kind === "color" || kind === "shadow" ? t.values : Object.fromEntries(Object.entries(t.values).map(([k, v]) => [k, `${v}px`]));
    // A color declared right in `@theme` is named for its variable (`color-brand`); in every other shape its class is `color-` and its name.
    const direct = kind === "color" && plan.prefix === "color-";
    tokens.push({ name, kind, values, locations: {}, tailwind: tailwind === null ? null : kind === "color" && !direct ? `color-${name}` : name, file: "Motif", line: 0 });
    if (tailwind === 4) {
      if (kind === "color" && !direct) inline.push(`  --color-${name}: var(--${name});`);
      else theme.push(`  --${name}: ${Object.values(values)[0]};`);
    }
  }
  const css = [inline.length ? `@theme inline {\n${inline.join("\n")}\n}` : "", theme.length ? `@theme {\n${theme.join("\n")}\n}` : ""].filter(Boolean).join("\n");
  return { tokens, themeCss: css };
}

// The class value a new token is written as: its name without the prefix a class doesn't carry (`radius-card` is `card`), or in a
// stylesheet the variable's name.
export const classValueOf = (name: string, plan: { prefix: string }): string => (name.startsWith(plan.prefix) ? name.slice(plan.prefix.length) : name);

// What a written-out value on an element is, as a token's value: a color as hex (and the opacity its class carries), a length in px.
// Null for what can't become one (a Tailwind palette color, whose value Motif doesn't know, or a value that isn't plain).
export function rawValue(kind: MakeKind, value: string): { kind: MakeKind; value: string; px?: number; opacity: string | null } | null {
  const { color, opacity } = kind === "color" ? splitOpacity(value) : { color: value, opacity: null };
  const inner = unwrapArbitrary(color);
  const text = inner ? (inner.rest ? null : inner.inner) : /^(#|rgb|hsl|oklch|oklab|lab|lch)/i.test(color) || /^-?\d*\.?\d+(px|rem)$/.test(color) ? color : null;
  if (text === null) return null;
  if (kind === "color") {
    const hex = swatchOf(text);
    return hex && normalizeColor(hex) ? { kind, value: hex, opacity } : null;
  }
  const px = lengthPx(text);
  return px === null || !(px >= 0) || px >= 9999 ? null : { kind, value: `${parseFloat(px.toFixed(3))}px`, px: parseFloat(px.toFixed(3)), opacity: null };
}

// A free name for a token a value is saved as: `custom`, `custom-2`, … (without the prefix, which is added).
export function freeName(taken: (name: string) => boolean, stem = "custom"): string {
  if (!taken(stem)) return stem;
  for (let n = 2; ; n++) if (!taken(`${stem}-${n}`)) return `${stem}-${n}`;
}
