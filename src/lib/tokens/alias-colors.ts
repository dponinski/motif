import { cssName } from "../token-sync/doc";
import type { ColorToken, TokenSet } from "../../store/design-system";

// Colors that are other colors, on the Motif side. A color keeps `themeAlias` (theme -> the token it is) and, in `themeValues`, the color
// that comes to; the functions here keep the two telling the truth.
//
// The token an alias names is written as its key when it is in the color's own set (`gray-50`), and as `<set id>/<key>` when it is in
// another (a semantic set whose colors are colors of a primitive one). A color in another set is the color of the theme of that set
// that has the same name as the theme it is in, and else of the theme that set has open.

export const tokenKey = (c: Pick<ColorToken, "name" | "repoName">) => c.repoName ?? cssName(c.name);

const MAX_DEPTH = 8;
const SEP = "/";

// How an alias to the token `to` is written, for a color in the set `fromSetId`.
export const targetKey = (to: Pick<ColorToken, "name" | "repoName" | "setId">, fromSetId: string): string => (to.setId === fromSetId ? tokenKey(to) : `${to.setId}${SEP}${tokenKey(to)}`);

// An alias written for another set's color: which set, and which key.
export function splitTarget(target: string, fromSetId: string): { setId: string; key: string } {
  const at = target.indexOf(SEP);
  return at < 0 ? { setId: fromSetId, key: target } : { setId: target.slice(0, at), key: target.slice(at + 1) };
}

// The token an alias of `from` names.
export function targetOf(colors: ColorToken[], from: Pick<ColorToken, "setId">, target: string): ColorToken | undefined {
  const { setId, key } = splitTarget(target, from.setId);
  return colors.find((c) => c.setId === setId && tokenKey(c) === key);
}

// The theme of the set `toSetId` that a color in the theme `themeId` of the set `fromSetId` is: the one with the same name, else the one
// that set has open, else its first. Within a set it is the theme itself.
export function themeIn(sets: TokenSet[] | undefined, fromSetId: string, themeId: string, toSetId: string): string {
  if (fromSetId === toSetId) return themeId;
  const to = sets?.find((s) => s.id === toSetId);
  if (!to) return themeId;
  const name = sets?.find((s) => s.id === fromSetId)?.themes.find((t) => t.id === themeId)?.name.toLowerCase();
  return to.themes.find((t) => t.name.toLowerCase() === name)?.id ?? (to.themes.some((t) => t.id === to.activeThemeId) ? to.activeThemeId : to.themes[0]?.id ?? themeId);
}

// The color a token is in a theme: its own, or the one of the token it is (and so on). Null when a chain loops or is too long.
export function colorIn(colors: ColorToken[], token: ColorToken, themeId: string, sets?: TokenSet[], depth = 0): string | null {
  const target = token.themeAlias?.[themeId];
  if (!target) return token.themeValues[themeId] ?? token.value;
  if (depth >= MAX_DEPTH) return null;
  const next = targetOf(colors, token, target);
  if (!next || next.id === token.id) return null;
  return colorIn(colors, next, themeIn(sets, token.setId, themeId, next.setId), sets, depth + 1);
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
      const v = colorIn(colors, c, themeId, sets);
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
export function wouldLoop(colors: ColorToken[], token: ColorToken, themeId: string, target: string, sets?: TokenSet[]): boolean {
  let from: ColorToken = token;
  let theme = themeId;
  let at: string | undefined = target;
  for (let depth = 0; at !== undefined && depth <= MAX_DEPTH; depth++) {
    const next = targetOf(colors, from, at);
    if (!next) return false;
    if (next.id === token.id) return true;
    theme = themeIn(sets, from.setId, theme, next.setId);
    at = next.themeAlias?.[theme];
    from = next;
  }
  return at !== undefined;
}

// The colors, in any set, that are this token in any theme.
export function dependentsOf(colors: ColorToken[], token: ColorToken): ColorToken[] {
  return colors.filter((c) => c.id !== token.id && c.themeAlias && Object.values(c.themeAlias).some((t) => targetOf(colors, c, t)?.id === token.id));
}

// Colors that were another token and no longer have it (it was deleted, or moved away): each keeps the color it came to.
export function detachMissing(colors: ColorToken[]): ColorToken[] {
  return colors.map((c) => {
    if (!c.themeAlias) return c;
    const kept = Object.fromEntries(Object.entries(c.themeAlias).filter(([, key]) => targetOf(colors, c, key)));
    if (Object.keys(kept).length === Object.keys(c.themeAlias).length) return c;
    return { ...c, themeAlias: Object.keys(kept).length ? kept : undefined };
  });
}

// Colors that were the token `from` of the set `setId` are now the token `to` (it was renamed), in that set and in the others.
export function renameAlias(colors: ColorToken[], setId: string, from: string, to: string): ColorToken[] {
  const named = (c: ColorToken, v: string) => (c.setId === setId && v === from) || v === `${setId}${SEP}${from}`;
  return colors.map((c) => {
    if (!c.themeAlias || !Object.values(c.themeAlias).some((v) => named(c, v))) return c;
    return { ...c, themeAlias: Object.fromEntries(Object.entries(c.themeAlias).map(([k, v]) => [k, named(c, v) ? (v.includes(SEP) ? `${setId}${SEP}${to}` : to) : v])) };
  });
}

// Colors moved to another set. A color that moves keeps what it was in each theme the two sets share by name (and the open theme's color
// elsewhere), keeps being the tokens it was (which are now in another set, unless they move with it), and the colors that were it stay it,
// wherever each is: nothing that was an alias stops being one because it or its token moved. It is a token of Motif's own in its new set
// until that set is synced (it has no name in the repository). A color that would then lead back to itself keeps the color it came to.
export function moveColors(colors: ColorToken[], movedIds: string[], toSetId: string, sets: TokenSet[]): ColorToken[] {
  const to = sets.find((s) => s.id === toSetId);
  if (!to) return colors;
  const moving = new Set(movedIds);
  const moves = (c: ColorToken) => moving.has(c.id) && c.setId !== toSetId;

  // Each color as it is after the move, but for its aliases.
  const placed = colors.map((c): ColorToken => {
    if (!moves(c)) return c;
    const themeValues: Record<string, string> = {};
    for (const t of to.themes) themeValues[t.id] = c.themeValues[themeIn(sets, toSetId, t.id, c.setId)] ?? c.value;
    const { repoName: _, ...rest } = c;
    return { ...rest, setId: toSetId, themeValues, value: themeValues[to.activeThemeId] ?? Object.values(themeValues)[0] ?? c.value };
  });
  const now = new Map(placed.map((c) => [c.id, c]));

  const out = colors.map((was, i) => {
    const c = placed[i];
    if (!was.themeAlias) return c;
    const themeAlias: Record<string, string> = {};
    // A color that moves has the aliases of the themes it takes its values from; the others keep their own themes.
    for (const theme of moves(was) ? to.themes.map((t) => t.id) : Object.keys(was.themeAlias)) {
      const key = was.themeAlias[moves(was) ? themeIn(sets, toSetId, theme, was.setId) : theme];
      const target = key === undefined ? undefined : targetOf(colors, was, key);
      if (target) themeAlias[theme] = targetKey(now.get(target.id)!, c.setId);
    }
    return { ...c, themeAlias: Object.keys(themeAlias).length ? themeAlias : undefined };
  });

  const clear = out.map((c) => {
    if (!c.themeAlias) return c;
    const kept = Object.fromEntries(Object.entries(c.themeAlias).filter(([theme, key]) => !wouldLoop(out, c, theme, key, sets)));
    return { ...c, themeAlias: Object.keys(kept).length ? kept : undefined };
  });
  return refreshAliases(clear, sets);
}
