import { tokenize, type TokenRole } from "../edit/classes";
import { buildTokenIndex, splitOpacity } from "../edit/tokens";
import type { RepoToken, TokenUse } from "./types";

// Where the repository's tokens are used: in class names (`bg-primary`, `rounded-card`, `p-gutter`) and in `var(--token)`, in
// components and stylesheets. A token a class could name is looked up by the names the inspector offers it under.

export interface UsageSource {
  path: string;
  text: string;
  css: boolean;
}

const MAX_FILES = 12;

// The utilities that take a token of each kind, by what comes before its name (`bg` in `bg-primary`). Broader than the groups the
// inspector has controls for: a token used only as `accent-primary` is used, and must not be called unused.
const SIDES = "(?:-(?:x|y|t|r|b|l|s|e|tl|tr|bl|br|ss|se|es|ee))?";
export const PREFIX: Record<TokenRole, RegExp> = {
  color: new RegExp(`^(?:bg|text|border${SIDES}|outline|ring|ring-offset|inset-ring|divide|divide-[xy]|from|via|to|fill|stroke|accent|caret|decoration|placeholder|shadow|inset-shadow|drop-shadow|scrollbar|selection)$`),
  radius: new RegExp(`^rounded${SIDES}$`),
  shadow: /^(?:shadow|inset-shadow|drop-shadow|text-shadow)$/,
  text: /^text$/,
  font: /^font$/,
  spacing: /^(?:p[xytrblse]?|m[xytrblse]?|gap|gap-[xy]|space-[xy]|inset|inset-[xy]|top|right|bottom|left|start|end|w|h|size|min-w|max-w|min-h|max-h|basis|translate-[xy]|scroll-[mp][xytrbl]?|indent|leading)$/,
};
export const CLASS_ROLES = Object.keys(PREFIX) as TokenRole[];

// A place in a utility where a token's name stands: `bg-primary/90` has `primary` at 3.
export interface ClassHit {
  name: string;
  offset: number;
  length: number;
}

// The tokens a utility names, and where: `-mt-gutter`, `hover:bg-primary/90`, `rounded-t-card` all name one. `byValue` is what a class
// value stands for, by kind (`primary` the token `primary`, `md` the token `radius-md`). The utility is without its modifiers.
export function locateTokens(utility: string, byValue: Map<TokenRole, Map<string, string>>): ClassHit[] {
  const hits: ClassHit[] = [];
  const lead = utility.length - utility.replace(/^[-!]+/, "").length;
  const bare = utility.slice(lead).replace(/!$/, "");
  for (let i = bare.indexOf("-"); i !== -1; i = bare.indexOf("-", i + 1)) {
    const prefix = bare.slice(0, i);
    const value = bare.slice(i + 1);
    for (const role of CLASS_ROLES) {
      if (!PREFIX[role].test(prefix)) continue;
      const key = role === "color" ? splitOpacity(value).color : value;
      const name = byValue.get(role)?.get(key);
      if (name && !hits.some((h) => h.name === name && h.offset === lead + i + 1)) hits.push({ name, offset: lead + i + 1, length: key.length });
    }
  }
  return hits;
}

// Class names are found as words, wherever they stand (a string, a template, a stylesheet's @apply, a page of prose): code can't be
// told from text by quotes alone (an apostrophe in JSX text misaligns them), and a class that is skipped is one a rename leaves behind.
const WORD = /[^\s"'`{}(),;<>=|&?*+~^\\]+/g;

// Every class-like word of a text with the tokens it names, as the text of the word and where it starts.
export function eachClassWord(text: string, byValue: Map<TokenRole, Map<string, string>>, visit: (hit: ClassHit, utilityStart: number) => void): void {
  if (![...byValue.values()].some((m) => m.size > 0)) return;
  for (const m of text.matchAll(WORD)) {
    const word = m[0];
    if (!word.includes("-")) continue;
    const modifier = tokenize(word)[0]?.modifier ?? "";
    const start = m.index! + modifier.length;
    for (const hit of locateTokens(word.slice(modifier.length), byValue)) visit(hit, start);
  }
}

const VAR = /var\(\s*--([\w-]+)/g;
// `--color-primary: var(--primary)` gives a token to Tailwind. It is the token, not another use of it.
const DECL = /(--[\w-]+)\s*:\s*([^;{}]*)/g;

export function tokenUsage(input: { tokens: RepoToken[]; themes: string[]; tailwind: 3 | 4 | null; sources: UsageSource[] }): Record<string, TokenUse> {
  const { tokens, themes, tailwind, sources } = input;
  const index = buildTokenIndex(tokens, themes, tailwind, {}, tailwind === null);
  const byName = new Set(tokens.map((t) => t.name));
  // What a class value stands for, by role: `primary` is the token `primary`, `md` the token `radius-md`.
  const byValue = new Map(CLASS_ROLES.map((role) => [role, new Map(index.byRole[role].map((c) => [c.value, c.name]))]));
  const hits = new Map<string, Map<string, number>>();
  const hit = (token: string, path: string) => {
    const files = hits.get(token) ?? new Map<string, number>();
    files.set(path, (files.get(path) ?? 0) + 1);
    hits.set(token, files);
  };

  for (const { path, text, css } of sources) {
    if (tailwind !== null && !css) eachClassWord(text, byValue, (h) => hit(h.name, path));
    if (css) {
      // `@apply bg-primary text-sm;` puts utilities in a stylesheet.
      if (tailwind !== null) for (const a of text.matchAll(/@apply\s+([^;}]+)/g)) eachClassWord(a[1], byValue, (h) => hit(h.name, path));
      for (const d of text.matchAll(DECL)) {
        for (const v of d[2].matchAll(VAR)) {
          if (!byName.has(v[1]) || d[1] === `--${v[1]}` || /^--(color|radius|shadow|spacing|text|font)-/.test(d[1]) && d[1].endsWith(`-${v[1]}`)) continue;
          hit(v[1], path);
        }
      }
      // Outside declarations (a `var()` in a rule's own property).
      for (const m of text.replace(DECL, "").matchAll(VAR)) if (byName.has(m[1])) hit(m[1], path);
    } else {
      for (const m of text.matchAll(VAR)) if (byName.has(m[1])) hit(m[1], path);
    }
  }

  const out: Record<string, TokenUse> = {};
  for (const [token, files] of hits) {
    const sorted = [...files].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out[token] = { n: sorted.reduce((s, [, n]) => s + n, 0), files: sorted.slice(0, MAX_FILES).map(([p]) => p) };
  }
  return out;
}
