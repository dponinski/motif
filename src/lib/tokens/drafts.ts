import { nanoid } from "nanoid";
import { normalizeColor } from "../token-sync/color";
import type { ColorToken, RadiusToken, ShadowToken, SpacingToken, TokenData, TypographyToken } from "../../store/design-system";
import { deriveGroup } from "./organize";
import { detachMissing, refreshAliases } from "./alias-colors";

// Tokens that are about to be added, before they are. Pasted text, a scale and the like make drafts; the screen shows what adding
// them would do (new tokens, changes to existing ones, ones that are there already) and `applyPlan` does it.

interface Base {
  name: string;
  // Left out, the group comes from the name (a ramp is a group).
  group?: string;
  // Named by number (`color-1`, `color-2`): if the name is taken, the next free number is used and nothing is changed.
  auto?: { prefix: string };
}

export type Draft =
  // `aliases`: themes (by id) in which the color is another token (its key), `values` having what that comes to.
  | (Base & { kind: "color"; values: Record<string, string>; aliases?: Record<string, string> })
  | (Base & { kind: "spacing"; value: number })
  | (Base & { kind: "radius"; value: number })
  | (Base & { kind: "shadow"; x: number; y: number; blur: number; spread: number; color: string; inset?: boolean; raw?: string })
  | (Base & { kind: "typography"; fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number });

export type Status = "new" | "update" | "same";
export type Action = "add" | "update" | "skip";

export interface PlanItem {
  draft: Draft;
  status: Status;
  action: Action;
  // The token that is changed, when there is one.
  targetId?: string;
  // The name it is added under (an automatic name moves to a free one).
  name: string;
}

type Existing = ColorToken | SpacingToken | RadiusToken | ShadowToken | TypographyToken;

const listOf = (state: TokenData, kind: Draft["kind"]): Existing[] =>
  (kind === "color" ? state.colors : kind === "spacing" ? state.spacing : kind === "radius" ? state.radii : kind === "shadow" ? state.shadows : state.typography) as Existing[];

const nameOf = (t: Existing) => (t as { repoName?: string }).repoName ?? t.name;

function sameValue(draft: Draft, t: Existing, themeIds: string[]): boolean {
  switch (draft.kind) {
    case "color": {
      const c = t as ColorToken;
      return Object.entries(draft.values).every(([theme, v]) => {
        if (!themeIds.includes(theme)) return true;
        const current = c.themeValues[theme] ?? c.value;
        return normalizeColor(current) === normalizeColor(v) && normalizeColor(v) !== null && c.themeAlias?.[theme] === draft.aliases?.[theme];
      });
    }
    case "spacing":
    case "radius": return (t as SpacingToken).value === draft.value;
    case "shadow": { const s = t as ShadowToken; return s.x === draft.x && s.y === draft.y && s.blur === draft.blur && s.spread === draft.spread && normalizeColor(s.color) === normalizeColor(draft.color) && !!s.inset === !!draft.inset; }
    case "typography": { const y = t as TypographyToken; return y.fontFamily === draft.fontFamily && y.fontSize === draft.fontSize && y.fontWeight === draft.fontWeight && y.lineHeight === draft.lineHeight; }
  }
}

// What adding the drafts to a set would do: a token that isn't there is new, one that is there with another value is an update, one
// that is there as it is has nothing to do. Drafts named by number never meet a name that is taken.
export function planDrafts(drafts: Draft[], state: TokenData, setId: string): PlanItem[] {
  const themeIds = state.sets.find((s) => s.id === setId)?.themes.map((t) => t.id) ?? [];
  const taken = new Map<Draft["kind"], Set<string>>();
  const takenOf = (kind: Draft["kind"]) => {
    if (!taken.has(kind)) taken.set(kind, new Set(listOf(state, kind).filter((t) => t.setId === setId).map((t) => t.name)));
    return taken.get(kind)!;
  };
  return drafts.map((draft) => {
    const names = takenOf(draft.kind);
    if (draft.auto) {
      let name = draft.name;
      for (let k = 1; names.has(name); k++) name = `${draft.auto.prefix}-${k}`;
      names.add(name);
      return { draft, status: "new", action: "add", name };
    }
    const existing = listOf(state, draft.kind).find((t) => t.setId === setId && (t.name === draft.name || nameOf(t) === draft.name));
    if (!existing) { names.add(draft.name); return { draft, status: "new", action: "add", name: draft.name }; }
    const same = sameValue(draft, existing, themeIds);
    return { draft, status: same ? "same" : "update", action: same ? "skip" : "update", targetId: existing.id, name: existing.name };
  });
}

// Does what the plan says, and gives the tokens as they are after.
export function applyPlan(state: TokenData, setId: string, plan: PlanItem[]): TokenData {
  const set = state.sets.find((s) => s.id === setId);
  if (!set) return state;
  const out: TokenData = { ...state, colors: [...state.colors], spacing: [...state.spacing], radii: [...state.radii], shadows: [...state.shadows], typography: [...state.typography] };
  const colorNames = [...state.colors.filter((c) => c.setId === setId).map((c) => c.name), ...plan.filter((p) => p.action === "add" && p.draft.kind === "color").map((p) => p.name)];

  for (const item of plan) {
    if (item.action === "skip") continue;
    const d = item.draft;
    if (item.action === "update") {
      const at = listOf(out, d.kind).findIndex((t) => t.id === item.targetId);
      if (at < 0) continue;
      const list = listOf(out, d.kind) as Existing[];
      const t = list[at];
      if (d.kind === "color") {
        const c = t as ColorToken;
        const themeValues = { ...c.themeValues };
        const aliases = { ...c.themeAlias };
        for (const [theme, v] of Object.entries(d.values)) {
          if (!set.themes.some((x) => x.id === theme)) continue;
          themeValues[theme] = v;
          if (d.aliases?.[theme]) aliases[theme] = d.aliases[theme]; else delete aliases[theme];
        }
        list[at] = { ...c, themeValues, themeAlias: Object.keys(aliases).length ? aliases : undefined, value: themeValues[set.activeThemeId] ?? c.value };
      } else if (d.kind === "spacing" || d.kind === "radius") list[at] = { ...(t as SpacingToken), value: d.value };
      else if (d.kind === "shadow") { const { x, y, blur, spread, color, inset, raw } = d; list[at] = { ...(t as ShadowToken), x, y, blur, spread, color, inset, raw }; }
      else { const { fontFamily, fontSize, fontWeight, lineHeight } = d; list[at] = { ...(t as TypographyToken), fontFamily, fontSize, fontWeight, lineHeight }; }
      continue;
    }
    // add
    const group = d.group ?? (d.kind === "color" ? deriveGroup(item.name, colorNames) : "base");
    if (d.kind === "color") {
      const first = Object.values(d.values)[0] ?? "#000000";
      const themeValues: Record<string, string> = {};
      for (const t of set.themes) themeValues[t.id] = d.values[t.id] ?? first;
      const aliases = Object.fromEntries(Object.entries(d.aliases ?? {}).filter(([theme]) => themeValues[theme] !== undefined));
      out.colors.push({ id: nanoid(6), name: item.name, value: themeValues[set.activeThemeId] ?? first, group, setId, themeValues, ...(Object.keys(aliases).length ? { themeAlias: aliases } : {}) });
    } else if (d.kind === "spacing") out.spacing.push({ id: nanoid(6), name: item.name, value: d.value, group, setId });
    else if (d.kind === "radius") out.radii.push({ id: nanoid(6), name: item.name, value: d.value, group, setId });
    else if (d.kind === "shadow") out.shadows.push({ id: nanoid(6), name: item.name, x: d.x, y: d.y, blur: d.blur, spread: d.spread, color: d.color, group, setId, inset: d.inset, raw: d.raw });
    else out.typography.push({ id: nanoid(6), name: item.name, fontFamily: d.fontFamily, fontSize: d.fontSize, fontWeight: d.fontWeight, lineHeight: d.lineHeight, group, setId });
  }
  out.colors = refreshAliases(detachMissing(out.colors), out.sets);
  return out;
}
