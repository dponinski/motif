import { nanoid } from "nanoid";
import type { ColorToken, RadiusToken, ShadowToken, SpacingToken, TokenSet } from "../../store/design-system";
import { normalizeColor } from "../token-sync/color";
import { colorGroup, cssName, type TokenSlices } from "../token-sync/doc";

// New design tokens the assistant suggests. They are added to Motif's token set, from where Sync tokens sends
// them to the repository as a pull request. Only what that sync carries is taken: colors, spacing, radius and
// shadows. Nothing here replaces or changes a token that exists.

export interface ProposedColor { name: string; value: string; dark: string | null; group: string | null }
export interface ProposedLength { name: string; value: number }
export interface ProposedShadow { name: string; x: number; y: number; blur: number; spread: number; color: string; group: string | null }

export interface TokenProposal {
  colors: ProposedColor[];
  spacing: ProposedLength[];
  radii: ProposedLength[];
  shadows: ProposedShadow[];
}

export const MAX_TOKENS = 60;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const label = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

export interface ParsedTokens {
  proposal: TokenProposal;
  count: number;
  rejected: string[];
}

export function parseTokenProposal(raw: unknown): ParsedTokens | null {
  if (!isObject(raw) || raw.action !== "tokens" || !isObject(raw.tokens)) return null;
  const t = raw.tokens;
  const proposal: TokenProposal = { colors: [], spacing: [], radii: [], shadows: [] };
  const rejected: string[] = [];
  let count = 0;
  const room = () => count < MAX_TOKENS || (rejected.includes(`Only the first ${MAX_TOKENS} tokens are taken`) ? false : (rejected.push(`Only the first ${MAX_TOKENS} tokens are taken`), false));
  const list = (key: string): unknown[] => (Array.isArray(t[key]) ? (t[key] as unknown[]) : []);

  for (const item of list("colors")) {
    if (!room()) break;
    const name = isObject(item) ? label(item.name, 60) : null;
    const value = isObject(item) && typeof item.value === "string" ? normalizeColor(item.value) : null;
    if (!isObject(item) || !name || !value) { rejected.push(`A color without a name or a color value (${isObject(item) ? String(item.name).slice(0, 30) : "?"})`); continue; }
    const dark = typeof item.dark === "string" ? normalizeColor(item.dark) : null;
    proposal.colors.push({ name, value, dark, group: label(item.group, 30) });
    count++;
  }
  for (const [key, into] of [["spacing", proposal.spacing], ["radii", proposal.radii]] as const) {
    for (const item of list(key)) {
      if (!room()) break;
      const name = isObject(item) ? label(item.name, 60) : null;
      const value = isObject(item) ? num(item.value, 0, key === "radii" ? 9999 : 1000) : null;
      if (!name || value === null) { rejected.push(`A ${key === "radii" ? "radius" : "spacing"} token without a name or a size in px (${isObject(item) ? String(item.name).slice(0, 30) : "?"})`); continue; }
      into.push({ name, value });
      count++;
    }
  }
  for (const item of list("shadows")) {
    if (!room()) break;
    const name = isObject(item) ? label(item.name, 60) : null;
    const color = isObject(item) && typeof item.color === "string" ? normalizeColor(item.color) : null;
    const [x, y, blur, spread] = isObject(item) ? [num(item.x, -200, 200), num(item.y, -200, 200), num(item.blur, 0, 400), num(item.spread ?? 0, -200, 200)] : [null, null, null, null];
    if (!isObject(item) || !name || !color || x === null || y === null || blur === null || spread === null) { rejected.push(`A shadow without a name, offsets or a color (${isObject(item) ? String(item.name).slice(0, 30) : "?"})`); continue; }
    proposal.shadows.push({ name, x, y, blur, spread, color: typeof item.color === "string" ? item.color.trim() : color, group: label(item.group, 30) });
    count++;
  }
  return { proposal, count, rejected };
}

export interface TokenTarget {
  setId: string;
  // The Motif theme that is the repository's dark theme, when the set has one.
  darkThemeId: string | null;
}

export function targetFor(sets: TokenSet[], linked: { setId: string; themes: Record<string, string> } | null): TokenTarget | null {
  const set = sets.find((s) => s.id === (linked?.setId ?? sets[0]?.id));
  if (!set) return null;
  const dark = linked?.themes.dark ?? set.themes.find((th) => /dark/i.test(th.name))?.id ?? null;
  return { setId: set.id, darkThemeId: dark && set.themes.some((th) => th.id === dark) ? dark : null };
}

export interface AddedTokens {
  next: TokenSlices;
  added: number;
  skipped: { name: string; reason: string }[];
}

const keyOf = (t: { name: string; repoName?: string }) => t.repoName ?? cssName(t.name);

// The set with the proposed tokens added to it. A name the set already has, or that comes twice, is left out.
export function addProposedTokens(state: TokenSlices & { sets: TokenSet[] }, proposal: TokenProposal, target: TokenTarget): AddedTokens {
  const set = state.sets.find((s) => s.id === target.setId)!;
  const skipped: AddedTokens["skipped"] = [];
  let added = 0;
  const taken = (list: { setId: string; name: string; repoName?: string }[]) => new Set(list.filter((t) => t.setId === target.setId).map(keyOf));

  const take = <T extends { name: string }>(items: T[], have: Set<string>, make: (item: T, name: string) => unknown): unknown[] => {
    const out: unknown[] = [];
    for (const item of items) {
      const name = cssName(item.name);
      if (have.has(name)) { skipped.push({ name, reason: "already a token" }); continue; }
      have.add(name);
      out.push(make(item, name));
      added++;
    }
    return out;
  };

  const colors = take(proposal.colors, taken(state.colors), (c, name): ColorToken => {
    const themeValues = Object.fromEntries(set.themes.map((th) => [th.id, th.id === target.darkThemeId && c.dark ? c.dark : c.value]));
    const names = [...state.colors.filter((x) => x.setId === target.setId).map((x) => x.name), ...proposal.colors.map((x) => cssName(x.name))];
    return { id: nanoid(6), name, value: themeValues[set.activeThemeId] ?? c.value, group: c.group ? cssName(c.group) : colorGroup(name, names), setId: target.setId, themeValues };
  }) as ColorToken[];
  const spacing = take(proposal.spacing, taken(state.spacing), (s, name): SpacingToken => ({ id: nanoid(6), name, value: s.value, setId: target.setId })) as SpacingToken[];
  const radii = take(proposal.radii, taken(state.radii), (r, name): RadiusToken => ({ id: nanoid(6), name, value: r.value, setId: target.setId })) as RadiusToken[];
  const shadows = take(proposal.shadows, taken(state.shadows), (s, name): ShadowToken => ({ id: nanoid(6), name, x: s.x, y: s.y, blur: s.blur, spread: s.spread, color: s.color, group: s.group ? cssName(s.group) : "default", setId: target.setId })) as ShadowToken[];

  return {
    next: {
      colors: [...state.colors, ...colors],
      spacing: [...state.spacing, ...spacing],
      radii: [...state.radii, ...radii],
      shadows: [...state.shadows, ...shadows],
    },
    added,
    skipped,
  };
}
