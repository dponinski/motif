import { cssName } from "../token-sync/doc";
import type { ColorToken, TokenSet } from "../../store/design-system";

// Colors that are other colors, on the Motif side. A color keeps `themeAlias` (theme -> the key of the token it is) and, in
// `themeValues`, the color that comes to; the functions here keep the two telling the truth.

export const tokenKey = (c: Pick<ColorToken, "name" | "repoName">) => c.repoName ?? cssName(c.name);

const MAX_DEPTH = 8;

function find(colors: ColorToken[], setId: string, key: string): ColorToken | undefined {
  return colors.find((c) => c.setId === setId && tokenKey(c) === key);
}

// The color a token is in a theme: its own, or the one of the token it is (and so on). Null when a chain loops or is too long.
export function colorIn(colors: ColorToken[], token: ColorToken, themeId: string, depth = 0): string | null {
  const target = token.themeAlias?.[themeId];
  if (!target) return token.themeValues[themeId] ?? token.value;
  if (depth >= MAX_DEPTH) return null;
  const next = find(colors, token.setId, target);
  return next && next.id !== token.id ? colorIn(colors, next, themeId, depth + 1) : null;
}

// Every color with the colors of its aliases brought up to date (after a value changed). A color whose alias leads nowhere keeps
// the color it last had.
export function refreshAliases(colors: ColorToken[], sets: TokenSet[]): ColorToken[] {
  if (!colors.some((c) => c.themeAlias)) return colors;
  let changed = false;
  const out = colors.map((c) => {
    if (!c.themeAlias) return c;
    const themeValues = { ...c.themeValues };
    for (const themeId of Object.keys(c.themeAlias)) {
      const v = colorIn(colors, c, themeId);
      if (v !== null) themeValues[themeId] = v;
    }
    const active = sets.find((s) => s.id === c.setId)?.activeThemeId;
    const value = (active && themeValues[active]) || c.value;
    if (value === c.value && Object.keys(themeValues).every((k) => themeValues[k] === c.themeValues[k])) return c;
    changed = true;
    return { ...c, themeValues, value };
  });
  return changed ? out : colors;
}

// Would making `token` the token `target` in a theme loop back to itself?
export function wouldLoop(colors: ColorToken[], token: ColorToken, themeId: string, target: string): boolean {
  const mine = tokenKey(token);
  let at: string | undefined = target;
  for (let depth = 0; at !== undefined && depth <= MAX_DEPTH; depth++) {
    if (at === mine) return true;
    at = find(colors, token.setId, at)?.themeAlias?.[themeId];
  }
  return at !== undefined;
}

// The colors of the same set that are this token, in any theme.
export function dependentsOf(colors: ColorToken[], token: ColorToken): ColorToken[] {
  const key = tokenKey(token);
  return colors.filter((c) => c.id !== token.id && c.setId === token.setId && c.themeAlias && Object.values(c.themeAlias).includes(key));
}

// Colors that were another token and no longer have it (it was deleted, or moved away): each keeps the color it came to.
export function detachMissing(colors: ColorToken[]): ColorToken[] {
  return colors.map((c) => {
    if (!c.themeAlias) return c;
    const kept = Object.fromEntries(Object.entries(c.themeAlias).filter(([, key]) => find(colors, c.setId, key)));
    if (Object.keys(kept).length === Object.keys(c.themeAlias).length) return c;
    return { ...c, themeAlias: Object.keys(kept).length ? kept : undefined };
  });
}

// Colors that were the token `from` are now the token `to` (it was renamed).
export function renameAlias(colors: ColorToken[], setId: string, from: string, to: string): ColorToken[] {
  return colors.map((c) => {
    if (c.setId !== setId || !c.themeAlias || !Object.values(c.themeAlias).includes(from)) return c;
    return { ...c, themeAlias: Object.fromEntries(Object.entries(c.themeAlias).map(([k, v]) => [k, v === from ? to : v])) };
  });
}
