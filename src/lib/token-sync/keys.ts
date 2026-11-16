import type { RepoAnalysis, RepoToken } from "../repo-scan/types";
import type { SyncKind } from "./doc";

// The name a Motif token has in the repository (its variable, or its entry in a Tailwind config) when it was made in Motif. A repository
// only gives a class to a token whose name starts with what its kind needs (`--radius-card` is `rounded-card`), so a token made as
// `card` is `radius-card` there: the Tokens screen keeps the name it was typed with, and the class it gets is the same whatever its name.
// A token that came from the repository keeps the name it has (`repoName`).

export type KeyPrefixes = Partial<Record<SyncKind, string>>;

// Colors that are variables exposed to Tailwind one by one: `--color-primary: var(--primary)` in `@theme inline`.
export const usesColorAliases = (tokens: RepoToken[]): boolean =>
  tokens.some((t) => t.kind === "color" && t.tailwind === `color-${t.name}` && Object.values(t.locations).some((l) => l.container === "css-var"));

export const inTheme = (tokens: RepoToken[], kind: RepoToken["kind"]): boolean =>
  tokens.some((t) => t.kind === kind && Object.values(t.locations).some((l) => l.container === "theme"));

// What a new token's name starts with in this repository, by kind. Nothing without Tailwind: a token is a variable and is used as one.
export function keyPrefixes(analysis: Pick<RepoAnalysis, "tokens" | "stack">): KeyPrefixes {
  const version = analysis.stack.tailwindVersion;
  if (version === null) return {};
  // Colors declared right in `@theme` (`--color-brand: #123`) are named that way; every other shape gives a color its own name.
  const direct = version === 4 && !usesColorAliases(analysis.tokens) && inTheme(analysis.tokens, "color");
  return { color: direct ? "color-" : "", radius: "radius-", spacing: "spacing-", shadow: "shadow-" };
}

// The slug a token name becomes as a CSS variable.
const slug = (name: string) => {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[0-9]/.test(s) ? `t-${s}` : s || "token";
};

export const withPrefix = (name: string, prefix: string | undefined): string => (!prefix || name.startsWith(prefix) ? name : `${prefix}${name}`);

export function repoKey(kind: SyncKind, token: { name: string; repoName?: string }, prefixes: KeyPrefixes | undefined): string {
  return token.repoName ?? withPrefix(slug(token.name), prefixes?.[kind]);
}
