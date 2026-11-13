import type { RepoToken } from "../repo-scan/types";
import { parseColor, rgbToOklab, toHex, type Rgba } from "../token-sync/color";
import { normalizeShadow, parseLengthPx } from "../token-sync/values";
import { PALETTE_COLOR, SCALE, type ClassGroup, type TokenNames, type TokenRole } from "./classes";

// The repository's design tokens as the inspector needs them: which ones a control can offer, what each is worth
// in each theme, and for a value that is not a token, the token it could be instead.
//
// Only tokens the repository exposes to Tailwind are offered (`--color-primary` in `@theme`, or a `colors` entry
// of a Tailwind 3 config), because those are the ones a class can name: `bg-primary`, `rounded-card`.

export interface TokenChoice {
  // What goes after the utility's prefix: "primary" for bg-primary, "card" for shadow-card.
  value: string;
  // The token as the repository names it (the CSS variable, without the dashes).
  name: string;
  // Its value in each theme, with references to other tokens followed.
  values: Record<string, string>;
  file: string;
  line: number;
}

export interface TokenIndex {
  // The repository's themes, the base one first.
  themes: string[];
  byRole: Record<TokenRole, TokenChoice[]>;
  // Roles whose Tailwind defaults the repository has switched off (`--radius-*: initial`).
  reset: ReadonlySet<TokenRole>;
  // One step of the spacing scale in px: `p-4` is four of them.
  spacingStep: number;
  tailwind: 3 | 4 | null;
  names: TokenNames;
}

const ROLES: [RegExp, TokenRole][] = [
  [/^color-(.+)$/, "color"],
  [/^spacing-(.+)$/, "spacing"],
  [/^radius-(.+)$/, "radius"],
  [/^shadow-(.+)$/, "shadow"],
  [/^text-(.+)$/, "text"],
  [/^font-(?!weight-|size-|style-|variant-)(.+)$/, "font"],
];

const emptyRoles = (): Record<TokenRole, TokenChoice[]> => ({ color: [], spacing: [], radius: [], shadow: [], text: [], font: [] });

export const EMPTY_INDEX: TokenIndex = {
  themes: [],
  byRole: emptyRoles(),
  reset: new Set(),
  spacingStep: 4,
  tailwind: null,
  names: { color: new Set(), text: new Set(), shadow: new Set(), font: new Set() },
};

const VAR = /var\(\s*--([\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g;

// `overrides` are values that replace the repository's, by token name and theme: what Motif has changed and not
// yet sent, so the inspector shows the same colors as the preview.
export function buildTokenIndex(
  tokens: RepoToken[],
  themes: string[],
  tailwind: 3 | 4 | null,
  overrides: Record<string, Record<string, string>> = {}
): TokenIndex {
  const base = themes[0] ?? "default";
  const byName = new Map(tokens.map((t) => [t.name, t]));
  const raw = (t: RepoToken, theme: string): string | undefined =>
    overrides[t.name]?.[theme] ?? t.values[theme] ?? overrides[t.name]?.[base] ?? t.values[base] ?? Object.values(t.values)[0];
  const resolve = (text: string, theme: string, depth = 0): string =>
    text.replace(VAR, (whole, name: string, fallback: string | undefined) => {
      const target = byName.get(name);
      const value = target && depth < 8 ? raw(target, theme) : undefined;
      return value === undefined ? fallback?.trim() ?? whole : resolve(value, theme, depth + 1);
    });

  const byRole = emptyRoles();
  const reset = new Set<TokenRole>();
  let spacingStep = 4;
  const all = themes.length ? themes : [base];

  for (const token of tokens) {
    if (!token.tailwind) continue;
    if (token.tailwind === "spacing") {
      spacingStep = lengthPx(resolve(raw(token, base) ?? "", base)) ?? spacingStep;
      continue;
    }
    const found = ROLES.map(([re, role]) => [token.tailwind!.match(re)?.[1], role] as const).find(([value]) => value);
    if (!found) continue;
    const [value, role] = found as [string, TokenRole];
    if (value === "*") {
      if ((raw(token, base) ?? "").trim() === "initial") reset.add(role);
      continue;
    }
    // `--text-lg--line-height` goes with `--text-lg`; it is not a size of its own.
    if (value.includes("--") || byRole[role].some((c) => c.value === value)) continue;
    byRole[role].push({
      value,
      name: token.name,
      values: Object.fromEntries(all.map((theme) => [theme, resolve(raw(token, theme) ?? "", theme)])),
      file: token.file,
      line: token.line,
    });
  }

  const names = (role: TokenRole) => new Set(byRole[role].map((c) => c.value));
  return { themes: all, byRole, reset, spacingStep, tailwind, names: { color: names("color"), text: names("text"), shadow: names("shadow"), font: names("font") } };
}

// ── Values ────────────────────────────────────────────────────────────────────

// The theme the controls and the assistant read token values in: dark when the stage shows it and the repository has one.
export const activeTheme = (index: TokenIndex, dark: boolean): string => (dark && index.themes.includes("dark") ? "dark" : index.themes[0] ?? "default");

const valueIn = (choice: TokenChoice, theme: string) => choice.values[theme] ?? Object.values(choice.values)[0] ?? "";

// px for a length, including the simple sums design systems write: `calc(0.625rem - 4px)`, `calc(infinity * 1px)`.
export function lengthPx(text: string): number | null {
  const t = text.trim().toLowerCase();
  const direct = parseLengthPx(t);
  if (direct !== null) return direct;
  const calc = t.match(/^calc\((.+)\)$/)?.[1];
  if (!calc) return null;
  const parts = calc.trim().split(/\s+([+\-*/])\s+/);
  if (parts.length < 3 || parts.length % 2 === 0) return null;
  const operand = (p: string): { n: number; length: boolean } | null => {
    if (p === "infinity") return { n: Infinity, length: false };
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(p)) return { n: parseFloat(p), length: false };
    const px = parseLengthPx(p);
    return px === null ? null : { n: px, length: true };
  };
  let acc = operand(parts[0]);
  for (let i = 1; acc && i < parts.length; i += 2) {
    const next = operand(parts[i + 1]);
    const op = parts[i];
    if (!next) return null;
    if (op === "+" || op === "-") {
      if (!acc.length || !next.length) return null;
      acc = { n: op === "+" ? acc.n + next.n : acc.n - next.n, length: true };
    } else if (op === "*") {
      if (acc.length && next.length) return null;
      acc = { n: acc.n * next.n, length: acc.length || next.length };
    } else {
      if (next.length || next.n === 0) return null;
      acc = { n: acc.n / next.n, length: acc.length };
    }
  }
  if (!acc || !acc.length) return null;
  // A radius of "as round as it gets".
  return Number.isFinite(acc.n) ? acc.n : 9999;
}

const px = (n: number) => `${parseFloat(n.toFixed(2))}px`;

// The sizes Tailwind ships with, for the values a repository leaves as they are.
const RADIUS_V4: Record<string, number> = { none: 0, xs: 2, sm: 4, DEFAULT: 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, "4xl": 32, full: 9999 };
const RADIUS_V3: Record<string, number> = { none: 0, sm: 2, DEFAULT: 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, full: 9999 };
const TEXT_PX: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128 };

const defaultPx = (role: TokenRole, value: string, index: TokenIndex): number | null => {
  if (role === "radius") return (index.tailwind === 3 ? RADIUS_V3 : RADIUS_V4)[value] ?? null;
  if (role === "text") return TEXT_PX[value] ?? null;
  if (role === "spacing") {
    if (value === "px") return 1;
    return /^\d+(\.\d+)?$/.test(value) ? parseFloat(value) * index.spacingStep : null;
  }
  return null;
};

export interface Choice {
  value: string;
  // What it is worth, to show beside the name: "8px", "#4f46e5".
  hint: string | null;
  // A color to show, as hex. Only ever a color that was read and written again here, never the repository's text.
  swatch: string | null;
  // One of the repository's tokens, as opposed to a value Tailwind ships with.
  token: boolean;
}

export const swatchOf = (text: string): string | null => {
  const color = parseColor(text);
  return color ? toHex(color) : null;
};

function describe(role: TokenRole, text: string): { hint: string | null; swatch: string | null } {
  if (role === "color") {
    const swatch = swatchOf(text);
    return { hint: swatch ?? (text.length > 28 ? `${text.slice(0, 27)}…` : text || null), swatch };
  }
  if (role === "spacing" || role === "radius" || role === "text") {
    const n = lengthPx(text);
    return { hint: n === null ? text || null : n >= 9999 ? "full" : px(n), swatch: null };
  }
  if (role === "font") return { hint: text.split(",")[0]?.replace(/["']/g, "").trim() || null, swatch: null };
  return { hint: null, swatch: null };
}

// What a control offers: the repository's tokens first, then what Tailwind ships with and the repository has not
// replaced. `options` are the group's own (the scale); a color group has none.
export function choicesFor(group: ClassGroup, index: TokenIndex, theme: string): { tokens: Choice[]; scale: Choice[] } {
  const role = group.role;
  if (!role) return { tokens: [], scale: (group.options ?? []).map((value) => ({ value, hint: null, swatch: null, token: false })) };
  const tokens = index.byRole[role].map((c) => ({ value: c.value, ...describe(role, valueIn(c, theme)), token: true }));
  const taken = new Set(tokens.map((t) => t.value));
  const defaults = index.reset.has(role) && role !== "spacing" ? [] : group.options ?? [];
  const scale = defaults
    .filter((value) => !taken.has(value))
    .map((value) => {
      const n = defaultPx(role, value, index);
      return { value, hint: n === null ? null : n >= 9999 ? "full" : px(n), swatch: null, token: false };
    });
  return { tokens, scale };
}

// ── What a value is ───────────────────────────────────────────────────────────

// token: one of the repository's. scale: a step Tailwind ships with, or a word like `auto` or `transparent`.
// palette: a color Tailwind ships with (`red-500`). raw: a value written out (`[#4f46e5]`, `[18px]`).
export type ValueStatus = "token" | "scale" | "palette" | "raw";

const KEYWORDS = /^(transparent|current|inherit|white|black)(\/|$)/;
const isArbitrary = (value: string) => /^[[(]/.test(value);

// A color class can carry an opacity after a slash (`primary/90`, `[#000]/50`). A slash inside brackets is part of
// the color (`[rgb(0_0_0_/_0.5)]`), so the split is at the last slash outside them.
export function splitOpacity(value: string): { color: string; opacity: string | null } {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth = Math.max(0, depth - 1);
    else if (c === "/" && depth === 0) cut = i;
  }
  return cut === -1 ? { color: value, opacity: null } : { color: value.slice(0, cut), opacity: value.slice(cut + 1) };
}

export function statusOf(role: TokenRole, value: string, index: TokenIndex): ValueStatus {
  const base = role === "color" ? splitOpacity(value).color : value;
  if (index.byRole[role].some((c) => c.value === base)) return "token";
  if (isArbitrary(value)) return "raw";
  if (role === "color") return KEYWORDS.test(value) ? "scale" : PALETTE_COLOR.test(value) ? "palette" : "scale";
  return "scale";
}

// Whether the inspector should point a value out: it is written out where the system has something to say
// instead. A length always has (the scale); a color or a shadow only in a repository that has tokens for them,
// which is also when a Tailwind palette color is out of place.
export const isFlagged = (role: TokenRole, value: string, index: TokenIndex): boolean => {
  const status = statusOf(role, value, index);
  if (status === "palette") return index.byRole.color.length > 0;
  if (status !== "raw") return false;
  return role === "spacing" || role === "radius" || role === "text" || index.byRole[role].length > 0;
};

// ── The token a raw value could be ────────────────────────────────────────────

export interface Suggestion {
  // The value to write in its place.
  value: string;
  // The same thing exactly, or only the nearest there is.
  exact: boolean;
  hint: string | null;
  swatch: string | null;
  token: boolean;
}

// What is inside `[...]`, without a type hint (`[length:1rem]`, `[color:#fff]`), and anything after it (`/50`).
function unwrapArbitrary(value: string): { inner: string; rest: string } | null {
  const m = value.match(/^\[(.*)\](.*)$/);
  if (!m) return null;
  return { inner: m[1].replace(/^[a-z-]+:(?!\/)/, "").replace(/_/g, " ").trim(), rest: m[2] };
}

const sameColor = (a: Rgba, b: Rgba) => Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1;
const distance = (a: Rgba, b: Rgba) => {
  const [x, y] = [rgbToOklab(a), rgbToOklab(b)];
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
};

// How far apart two colors can be and still be offered as "closest": a little more than the eye can tell.
const NEAR_COLOR = 0.06;

function suggestColor(value: string, index: TokenIndex): Suggestion | null {
  const parts = unwrapArbitrary(value);
  const color = parts && parseColor(parts.inner);
  if (!parts || !color) return null;
  const base = index.themes[0] ?? "default";
  let best: { choice: TokenChoice; token: Rgba; d: number } | null = null;
  for (const choice of index.byRole.color) {
    const token = parseColor(valueIn(choice, base));
    // A see-through token is not what an opaque color should become.
    if (!token || token.a < 1) continue;
    const d = sameColor(color, token) ? 0 : distance(color, token);
    if (!best || d < best.d) best = { choice, token, d };
  }
  if (!best || best.d > NEAR_COLOR) return null;
  // The opacity written into the color, or after it, is kept as the class's own: `primary/50`.
  const opacity = parts.rest || (color.a < 1 ? `/${Math.round(color.a * 100)}` : "");
  return { value: `${best.choice.value}${opacity}`, exact: best.d === 0, hint: toHex(best.token), swatch: toHex(best.token), token: true };
}

function nearestLength(role: "radius" | "text", target: number, group: ClassGroup, index: TokenIndex, tolerance: number): Suggestion | null {
  const base = index.themes[0] ?? "default";
  const { tokens, scale } = choicesFor(group, index, base);
  let best: { choice: Choice; d: number } | null = null;
  // Tokens come first, so a token wins a tie with a Tailwind default.
  for (const choice of [...tokens, ...scale]) {
    const n = choice.token
      ? lengthPx(valueIn(index.byRole[role].find((c) => c.value === choice.value)!, base))
      : defaultPx(role, choice.value, index);
    if (n === null) continue;
    const d = Math.abs(n - target);
    if (!best || d < best.d - 1e-9) best = { choice, d };
  }
  if (!best || best.d > tolerance) return null;
  return { value: best.choice.value, exact: best.d < 0.01, hint: best.choice.hint, swatch: null, token: best.choice.token };
}

function suggestSpacing(target: number, index: TokenIndex): Suggestion | null {
  const base = index.themes[0] ?? "default";
  const named = index.byRole.spacing.find((c) => { const n = lengthPx(valueIn(c, base)); return n !== null && Math.abs(n - target) < 0.01; });
  if (named) return { value: named.value, exact: true, hint: px(target), swatch: null, token: true };
  if (target < 0 || index.spacingStep <= 0) return null;
  const steps = target / index.spacingStep;
  // Tailwind 4 takes any multiple of a quarter step; Tailwind 3 only has the steps of its scale.
  if (index.tailwind !== 3) {
    const quarter = Math.round(steps * 4) / 4;
    const exact = Math.abs(quarter - steps) < 1e-6;
    if (!exact && Math.abs(quarter * index.spacingStep - target) > 2) return null;
    return { value: quarter === 0.25 && index.spacingStep === 4 ? "px" : String(quarter), exact, hint: px(quarter * index.spacingStep), swatch: null, token: false };
  }
  let best: { value: string; d: number; n: number } | null = null;
  for (const value of SCALE) {
    const n = value === "px" ? 1 : parseFloat(value) * index.spacingStep;
    const d = Math.abs(n - target);
    if (!best || d < best.d) best = { value, d, n };
  }
  if (!best || best.d > 2) return null;
  return { value: best.value, exact: best.d < 0.01, hint: px(best.n), swatch: null, token: false };
}

// For a value that is written out, the token (or step of the scale) that says the same, or nearly. Null when
// there is nothing close enough to offer, or the value is not one that can be compared.
export function suggest(group: ClassGroup, value: string, index: TokenIndex): Suggestion | null {
  const role = group.role;
  if (!role || statusOf(role, value, index) !== "raw") return null;
  if (role === "color") return suggestColor(value, index);
  const parts = unwrapArbitrary(value);
  if (!parts || parts.rest) return null;
  if (role === "shadow") {
    const base = index.themes[0] ?? "default";
    const wanted = normalizeShadow(parts.inner);
    const match = wanted === null ? undefined : index.byRole.shadow.find((c) => normalizeShadow(valueIn(c, base)) === wanted);
    return match ? { value: match.value, exact: true, hint: null, swatch: null, token: true } : null;
  }
  if (role === "font") return null;
  const target = lengthPx(parts.inner);
  if (target === null) return null;
  if (role === "spacing") return suggestSpacing(target, index);
  return nearestLength(role, target, group, index, role === "radius" ? 2 : 1);
}
