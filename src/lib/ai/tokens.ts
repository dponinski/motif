import { nanoid } from "nanoid";
import type { ColorToken, NumberToken, RadiusToken, ShadowToken, SpacingToken, StringToken, TokenSet } from "../../store/design-system";
import type { Composition, Slot, TokenType } from "../tokens/model";
import { presetSlots } from "../tokens/compose";
import { isUnit, NUMBER_USES, STRING_USES } from "../tokens/uses";
import { normalizeColor } from "../token-sync/color";
import { colorGroup, cssName, type TokenSlices } from "../token-sync/doc";

// New design tokens the assistant suggests. They are added to Motif's token set, from where Sync tokens sends
// them to the repository as a pull request (colors, spacing, radius and shadows; numbers, strings and compositions
// stay in Motif until the sync carries them). Nothing here replaces or changes a token that exists.

export interface ProposedColor { name: string; value: string; dark: string | null; group: string | null }
export interface ProposedLength { name: string; value: number }
export interface ProposedShadow { name: string; x: number; y: number; blur: number; spread: number; color: string; group: string | null }

export interface ProposedNumber { name: string; value: number; unit: NumberToken["unit"]; use: string | null }
export interface ProposedString { name: string; value: string; use: string | null }
// A part of a composition: a value, or the name of a token (which the part then follows).
export interface ProposedSlot { name: string; type: TokenType; value: string | null; unit: Slot["unit"] | null; token: string | null }
export interface ProposedComposition { name: string; kind: Composition["kind"]; slots: ProposedSlot[]; inset: boolean }

export interface TokenProposal {
  colors: ProposedColor[];
  spacing: ProposedLength[];
  radii: ProposedLength[];
  shadows: ProposedShadow[];
  numbers: ProposedNumber[];
  strings: ProposedString[];
  compositions: ProposedComposition[];
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
  const proposal: TokenProposal = { colors: [], spacing: [], radii: [], shadows: [], numbers: [], strings: [], compositions: [] };
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
  for (const item of list("numbers")) {
    if (!room()) break;
    const name = isObject(item) ? label(item.name, 60) : null;
    const value = isObject(item) ? num(item.value, -100000, 100000) : null;
    if (!isObject(item) || !name || value === null) { rejected.push(`A number without a name or a value (${isObject(item) ? String(item.name).slice(0, 30) : "?"})`); continue; }
    const unit = typeof item.unit === "string" && isUnit(item.unit) ? item.unit : "";
    const use = typeof item.use === "string" && NUMBER_USES.some((u) => u.value && u.value === item.use) ? item.use : null;
    proposal.numbers.push({ name, value, unit, use });
    count++;
  }
  for (const item of list("strings")) {
    if (!room()) break;
    const name = isObject(item) ? label(item.name, 60) : null;
    const value = isObject(item) ? label(item.value, 300) : null;
    if (!isObject(item) || !name || !value) { rejected.push(`A string without a name or a value (${isObject(item) ? String(item.name).slice(0, 30) : "?"})`); continue; }
    const use = typeof item.use === "string" && STRING_USES.some((u) => u.value && u.value === item.use) ? item.use : null;
    proposal.strings.push({ name, value, use });
    count++;
  }
  for (const item of list("compositions")) {
    if (!room()) break;
    const name = isObject(item) ? label(item.name, 60) : null;
    const kind = isObject(item) && (item.kind === "typography" || item.kind === "shadow" || item.kind === "custom") ? item.kind : null;
    if (!isObject(item) || !name || !kind) { rejected.push(`A composition without a name or a kind of typography, shadow or custom (${isObject(item) ? String(item.name).slice(0, 30) : "?"})`); continue; }
    const slots: ProposedSlot[] = [];
    for (const raw of (Array.isArray(item.slots) ? item.slots : []).slice(0, 12)) {
      const slotName = isObject(raw) ? label(raw.name, 40) : null;
      if (!isObject(raw) || !slotName || slots.some((s) => s.name === slotName)) continue;
      const preset = presetSlots(kind).find((s) => s.name === slotName);
      const type = preset?.type ?? (raw.type === "color" || raw.type === "number" || raw.type === "string" ? raw.type : null);
      if (!type) { rejected.push(`${name}: the part ${slotName} has no type of color, number or string`); continue; }
      const value = typeof raw.value === "string" || typeof raw.value === "number" ? String(raw.value).slice(0, 300) : null;
      const token = label(raw.token, 60);
      if (value === null && !token) { rejected.push(`${name}: the part ${slotName} has neither a value nor a token`); continue; }
      if (type === "color" && value !== null && !token && normalizeColor(value) === null) { rejected.push(`${name}: the part ${slotName} isn't a color`); continue; }
      if (type === "number" && value !== null && !token && !Number.isFinite(parseFloat(value))) { rejected.push(`${name}: the part ${slotName} isn't a number`); continue; }
      slots.push({ name: slotName, type, value, unit: typeof raw.unit === "string" && isUnit(raw.unit) ? raw.unit : null, token });
    }
    if (kind === "custom" && slots.length === 0) { rejected.push(`${name}: a custom composition needs parts`); continue; }
    proposal.compositions.push({ name, kind, slots, inset: item.inset === true });
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
  next: TokenSlices & { numbers: NumberToken[]; strings: StringToken[]; compositions: Composition[] };
  added: number;
  skipped: { name: string; reason: string }[];
}

const keyOf = (t: { name: string; repoName?: string }) => t.repoName ?? cssName(t.name);

// The set with the proposed tokens added to it. A name the set already has, or that comes twice, is left out.
export function addProposedTokens(state: TokenSlices & { sets: TokenSet[]; numbers?: NumberToken[]; strings?: StringToken[]; compositions?: Composition[] }, proposal: TokenProposal, target: TokenTarget): AddedTokens {
  const haveNumbers = state.numbers ?? [];
  const haveStrings = state.strings ?? [];
  const haveCompositions = state.compositions ?? [];
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

  const numbers = take(proposal.numbers, taken(haveNumbers), (n, name): NumberToken => ({ id: nanoid(6), name, value: n.value, unit: n.unit, ...(n.use ? { use: n.use } : {}), setId: target.setId })) as NumberToken[];
  const strings = take(proposal.strings, taken(haveStrings), (t, name): StringToken => ({ id: nanoid(6), name, value: t.value, ...(t.use ? { use: t.use } : {}), setId: target.setId })) as StringToken[];

  // A part that is a token names it: a token of the set, in any of the lists, the new ones too. One that isn't there is the value it was given.
  const byName = (type: TokenType, tokenName: string): string | undefined => {
    const key = cssName(tokenName);
    const pick = (list: { id: string; name: string; repoName?: string; setId: string }[]) => (list.find((t) => t.setId === target.setId && keyOf(t) === key) ?? list.find((t) => keyOf(t) === key))?.id;
    if (type === "color") return pick([...state.colors, ...colors]);
    if (type === "string") return pick([...haveStrings, ...strings]);
    return pick([...haveNumbers, ...numbers, ...state.spacing, ...spacing, ...state.radii, ...radii]);
  };
  const compositions = take(proposal.compositions, taken(haveCompositions), (c, name): Composition => {
    const slotOf = (p: ProposedSlot): Slot | null => {
      const ref = p.token ? byName(p.type, p.token) : undefined;
      if (!ref && p.value === null) { skipped.push({ name: `${name}: ${p.name}`, reason: "no such token" }); return null; }
      return { name: p.name, type: p.type, ...(p.value !== null ? { value: p.value } : {}), ...(p.type === "number" ? { unit: p.unit ?? "" } : {}), ...(ref ? { ref } : {}) };
    };
    const given = c.slots.map(slotOf).filter((x): x is Slot => !!x);
    // A text style or a shadow has all its parts: the ones that weren't given have the defaults.
    const slots = c.kind === "custom" ? given : [...presetSlots(c.kind).map((preset) => given.find((g) => g.name === preset.name) ?? preset), ...given.filter((g) => !presetSlots(c.kind).some((preset) => preset.name === g.name))];
    return { id: nanoid(6), name, kind: c.kind, slots, setId: target.setId, ...(c.inset ? { inset: true } : {}) };
  }) as Composition[];

  return {
    next: {
      numbers: [...haveNumbers, ...numbers],
      strings: [...haveStrings, ...strings],
      compositions: [...haveCompositions, ...compositions],
      colors: [...state.colors, ...colors],
      spacing: [...state.spacing, ...spacing],
      radii: [...state.radii, ...radii],
      shadows: [...state.shadows, ...shadows],
    },
    added,
    skipped,
  };
}
