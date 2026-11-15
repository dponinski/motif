import type { RepoToken } from "../repo-scan/types";
import { normalizeColor } from "../token-sync/color";
import type { SyncDoc } from "../token-sync/doc";
import { lengthPx, splitOpacity, swatchOf, unwrapArbitrary } from "./tokens";

// Tokens Motif has and the repository does not (yet), as the inspector and the preview need to see them, and whether a token made
// from a value on an element could be named by a class once it is synced. Whether it could depends on how the repository
// exposes its tokens to Tailwind: Sync writes a new color as a variable with an `@theme inline` alias only when the repository
// already does that, and a new radius or spacing into an `@theme` block only when there is one.

export type MakeKind = "color" | "radius" | "spacing";
// `prefix` is what the token's name starts with so that Tailwind has a class for it (`radius-card` is `rounded-card`).
export type MakePlan = { prefix: string } | { reason: string };
export type MakePlans = Record<MakeKind, MakePlan>;

// Colors are variables exposed to Tailwind one by one: `--color-primary: var(--primary)` in `@theme inline`.
export const usesColorAliases = (tokens: RepoToken[]): boolean =>
  tokens.some((t) => t.kind === "color" && t.tailwind === `color-${t.name}` && Object.values(t.locations).some((l) => l.container === "css-var"));

const inTheme = (tokens: RepoToken[], kind: RepoToken["kind"]) => tokens.some((t) => t.kind === kind && Object.values(t.locations).some((l) => l.container === "theme"));

export function makePlans(tokens: RepoToken[], tailwind: 3 | 4 | null): MakePlans {
  // Without Tailwind a token is a variable, and a stylesheet's controls name it with `var()`.
  if (tailwind === null) return { color: { prefix: "" }, radius: { prefix: "" }, spacing: { prefix: "" } };
  if (tailwind === 3) {
    const reason = "This repository's tokens are in a Tailwind 3 config, which Motif can't add to yet";
    return { color: { reason }, radius: { reason }, spacing: { reason } };
  }
  return {
    color: usesColorAliases(tokens) ? { prefix: "" } : { reason: "This repository doesn't give Tailwind its colors through @theme inline, so no class could name a new one" },
    radius: inTheme(tokens, "radius") ? { prefix: "radius-" } : { reason: "This repository has no @theme block of radii to add one to" },
    spacing: inTheme(tokens, "spacing") ? { prefix: "spacing-" } : { reason: "This repository has no @theme block of spacing to add one to" },
  };
}

const KINDS: ReadonlySet<string> = new Set(["color", "radius", "spacing"]);

export interface MotifOnly {
  // As the repository's own tokens are, so the inspector offers them like any other.
  tokens: RepoToken[];
  // What a Tailwind 4 preview needs to have a class for each (`@theme` lines), as a stylesheet of its own.
  themeCss: string;
}

// The tokens of `doc` (Motif's, by name) that `repoTokens` doesn't have, and that a class could name once synced.
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
    if ("reason" in plan || !name.startsWith(plan.prefix)) continue;
    const values = kind === "color" ? t.values : Object.fromEntries(Object.entries(t.values).map(([k, v]) => [k, `${v}px`]));
    tokens.push({ name, kind, values, locations: {}, tailwind: tailwind === null ? null : kind === "color" ? `color-${name}` : name, file: "Motif", line: 0 });
    if (tailwind === 4) {
      if (kind === "color") inline.push(`  --color-${name}: var(--${name});`);
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
