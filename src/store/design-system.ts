import { create } from "zustand";
import { nanoid } from "nanoid";
import { normalizeColor } from "@/lib/token-sync/color";
import { deriveGroup, uniqueName } from "@/lib/tokens/organize";
import { detachMissing, refreshAliases, renameAlias, tokenKey, wouldLoop } from "@/lib/tokens/alias-colors";

// ── Theme & Set types ─────────────────────────────────────────────────────────

export interface TokenTheme {
  id: string;
  name: string;
}

export interface TokenSet {
  id: string;
  name: string;
  themes: TokenTheme[];
  activeThemeId: string;
}

// ── Token types ───────────────────────────────────────────────────────────────

// The aliases of a color without the one of a theme (nothing left is nothing).
function withoutKey(aliases: Record<string, string> | undefined, themeId: string): Record<string, string> | undefined {
  if (!aliases || !(themeId in aliases)) return aliases;
  const { [themeId]: _, ...rest } = aliases;
  return Object.keys(rest).length ? rest : undefined;
}

export interface ColorToken {
  id: string;
  name: string;
  value: string; // resolved from active theme
  group: string;
  setId: string;
  themeValues: Record<string, string>; // themeId -> hex/rgba
  // Themes in which this color is another token (`var(--gray-12)` in the repository): themeId -> the key of the token it is. The
  // value in `themeValues` is then what that token is, kept up to date, so what shows a color needs nothing to know about aliases.
  themeAlias?: Record<string, string>;
  // Name of the repository token this one is synced with, when it came from (or went to) a repo.
  repoName?: string;
}

export interface TypographyToken {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing?: number;
  // Motif's own way of arranging tokens; never sent to a repository.
  group?: string;
  setId: string;
}

export interface SpacingToken {
  id: string;
  name: string;
  value: number;
  group?: string;
  setId: string;
  repoName?: string;
}

export interface RadiusToken {
  id: string;
  name: string;
  value: number;
  group?: string;
  setId: string;
  repoName?: string;
}

export interface ShadowToken {
  id: string;
  name: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  group: string;
  setId: string;
  repoName?: string;
  inset?: boolean;
  // The whole value of a multi-layer shadow as canonical text; the fields above hold its first layer.
  raw?: string;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultProps: Record<string, unknown>;
}

export type TokenKind = "color" | "typography" | "spacing" | "radius" | "shadow";

// What a token is in a group when nothing says.
export const DEFAULT_GROUP = "base";

// ── Store interface ───────────────────────────────────────────────────────────

interface DesignSystemStore {
  sets: TokenSet[];
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
  radii: RadiusToken[];
  shadows: ShadowToken[];
  components: ComponentDefinition[];

  // Set management
  createSet: (name: string) => string;
  renameSet: (setId: string, name: string) => void;
  deleteSet: (setId: string) => void;

  // Theme management
  addThemeToSet: (setId: string, name: string) => string;
  deleteThemeFromSet: (setId: string, themeId: string) => void;
  renameTheme: (setId: string, themeId: string, name: string) => void;
  setActiveTheme: (setId: string, themeId: string) => void;

  // Color CRUD
  addColor: (token: Omit<ColorToken, "id" | "themeValues" | "value"> & { value?: string }) => void;
  updateColor: (id: string, updates: Partial<ColorToken>) => void;
  updateColorThemeValue: (tokenId: string, themeId: string, value: string) => void;
  deleteColor: (id: string) => void;

  // Other token CRUD
  addTypography: (token: Omit<TypographyToken, "id">) => void;
  updateTypography: (id: string, updates: Partial<TypographyToken>) => void;
  deleteTypography: (id: string) => void;

  addSpacing: (token: Omit<SpacingToken, "id">) => void;
  updateSpacing: (id: string, updates: Partial<SpacingToken>) => void;
  deleteSpacing: (id: string) => void;

  addRadius: (token: Omit<RadiusToken, "id">) => void;
  updateRadius: (id: string, updates: Partial<RadiusToken>) => void;
  deleteRadius: (id: string) => void;

  addShadow: (token: Omit<ShadowToken, "id">) => void;
  updateShadow: (id: string, updates: Partial<ShadowToken>) => void;
  deleteShadow: (id: string) => void;

  // Arranging tokens. Each takes the kind of token and the ids; the screen makes each one step of its undo.
  // A token the repository names can't be renamed here: the repository's name is what Sync matches it by.
  renameToken: (kind: TokenKind, id: string, name: string) => boolean;
  setTokenGroup: (kind: TokenKind, ids: string[], group: string) => void;
  moveTokensToSet: (kind: TokenKind, ids: string[], setId: string) => void;
  duplicateTokens: (kind: TokenKind, ids: string[]) => string[];
  deleteTokens: (kind: TokenKind, ids: string[]) => void;
  renameGroup: (kind: TokenKind, setId: string, from: string, to: string) => void;
  // Puts the tokens before another (or last) and, when a group is given, in it.
  moveTokensBefore: (kind: TokenKind, ids: string[], beforeId: string | null, group?: string) => void;
  // Re-derives the group of every color of a set from its names.
  regroupColors: (setId: string) => void;
  // A color's value in one theme, written as typed when it is a color Motif can read.
  setColorText: (id: string, themeId: string, text: string) => boolean;
  // Makes a color, in one theme, the token `target` (the key of another color of its set), or with null makes it the color it
  // is now. False when the other token isn't there or would lead back to this one.
  setColorAlias: (id: string, themeId: string, target: string | null) => boolean;
  // Puts the tokens back as they were (for undo and redo).
  replaceTokenData: (data: TokenData) => void;

  loadTokens: (data: {
    colors?: ColorToken[];
    typography?: TypographyToken[];
    spacing?: SpacingToken[];
    radii?: RadiusToken[];
    shadows?: ShadowToken[];
  }) => void;

  exportTokens: () => string;
  exportCSS: () => string;
  exportTailwind: () => string;
  importFromJSON: (json: string) => { imported: number; errors: string[] };
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_SET_ID = "set-global";
const DEFAULT_THEME_ID = "theme-default";

const DEFAULT_SETS: TokenSet[] = [
  {
    id: DEFAULT_SET_ID,
    name: "Global",
    themes: [{ id: DEFAULT_THEME_ID, name: "Default" }],
    activeThemeId: DEFAULT_THEME_ID,
  },
];

// What a project keeps of the token store. A new project starts with one empty set: its tokens come from the
// repository (Sync tokens) or are added by hand.
export interface TokenData {
  sets: TokenSet[];
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
  radii: RadiusToken[];
  shadows: ShadowToken[];
  components: ComponentDefinition[];
}

export function emptyTokenData(): TokenData {
  return {
    sets: DEFAULT_SETS.map((set) => ({ ...set, themes: [...set.themes] })),
    colors: [],
    typography: [],
    spacing: [],
    radii: [],
    shadows: [],
    components: [],
  };
}

export const snapshotTokens = (s: TokenData): TokenData => ({
  sets: s.sets,
  colors: s.colors,
  typography: s.typography,
  spacing: s.spacing,
  radii: s.radii,
  shadows: s.shadows,
  components: s.components,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toKebab(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").toLowerCase();
}


const SLICE = { color: "colors", typography: "typography", spacing: "spacing", radius: "radii", shadow: "shadows" } as const;

type Arranged = { id: string; name: string; setId: string; group?: string; repoName?: string };
const listOf = (s: TokenData, kind: TokenKind) => s[SLICE[kind]] as unknown as Arranged[];
const withList = (kind: TokenKind, list: Arranged[]) => ({ [SLICE[kind]]: list }) as unknown as Partial<TokenData>;

// A color moved to another set keeps what it was in each theme the two sets share by name, and the active theme's value elsewhere.
function remapThemes(c: ColorToken, from: TokenSet | undefined, to: TokenSet): Record<string, string> {
  const out: Record<string, string> = {};
  const fallback = (from && c.themeValues[from.activeThemeId]) ?? c.value;
  for (const t of to.themes) {
    const same = from?.themes.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    out[t.id] = (same && c.themeValues[same.id]) ?? fallback;
  }
  return out;
}

// ── Store ─────────────────────────────────────────────────────────────────────

// Held in memory for the project that is open; the project keeps it (see store/project-session.ts).
export const useDesignSystemStore = create<DesignSystemStore>()(
  (set, get) => ({
      ...emptyTokenData(),

      // ── Set management ──────────────────────────────────────────────────────

      createSet: (name) => {
        const setId = `set-${nanoid(6)}`;
        const themeId = `theme-${nanoid(6)}`;
        set((s) => ({
          sets: [
            ...s.sets,
            { id: setId, name, themes: [{ id: themeId, name: "Default" }], activeThemeId: themeId },
          ],
        }));
        return setId;
      },

      renameSet: (setId, name) =>
        set((s) => ({ sets: s.sets.map((st) => (st.id === setId ? { ...st, name } : st)) })),

      deleteSet: (setId) =>
        set((s) => ({
          sets: s.sets.filter((st) => st.id !== setId),
          colors: s.colors.filter((c) => c.setId !== setId),
          typography: s.typography.filter((t) => t.setId !== setId),
          spacing: s.spacing.filter((sp) => sp.setId !== setId),
          radii: s.radii.filter((r) => r.setId !== setId),
          shadows: s.shadows.filter((sh) => sh.setId !== setId),
        })),

      // ── Theme management ────────────────────────────────────────────────────

      addThemeToSet: (setId, name) => {
        const themeId = `theme-${nanoid(6)}`;
        set((s) => {
          const tokenSet = s.sets.find((st) => st.id === setId);
          const baseThemeId = tokenSet?.activeThemeId ?? tokenSet?.themes[0]?.id ?? "";
          return {
            sets: s.sets.map((st) =>
              st.id === setId
                ? { ...st, themes: [...st.themes, { id: themeId, name }] }
                : st
            ),
            // Clone current values into the new theme
            colors: s.colors.map((c) => {
              if (c.setId !== setId) return c;
              const baseValue = c.themeValues[baseThemeId] ?? c.value;
              const baseAlias = c.themeAlias?.[baseThemeId];
              return { ...c, themeValues: { ...c.themeValues, [themeId]: baseValue }, ...(baseAlias ? { themeAlias: { ...c.themeAlias, [themeId]: baseAlias } } : {}) };
            }),
          };
        });
        return themeId;
      },

      deleteThemeFromSet: (setId, themeId) =>
        set((s) => ({
          sets: s.sets.map((st) => {
            if (st.id !== setId) return st;
            const themes = st.themes.filter((t) => t.id !== themeId);
            const activeThemeId =
              st.activeThemeId === themeId ? (themes[0]?.id ?? "") : st.activeThemeId;
            return { ...st, themes, activeThemeId };
          }),
          colors: s.colors.map((c) => {
            if (c.setId !== setId) return c;
            const { [themeId]: _, ...rest } = c.themeValues;
            const { [themeId]: __, ...aliases } = c.themeAlias ?? {};
            return { ...c, themeValues: rest, themeAlias: Object.keys(aliases).length ? aliases : undefined };
          }),
        })),

      renameTheme: (setId, themeId, name) =>
        set((s) => ({
          sets: s.sets.map((st) =>
            st.id === setId
              ? { ...st, themes: st.themes.map((t) => (t.id === themeId ? { ...t, name } : t)) }
              : st
          ),
        })),

      setActiveTheme: (setId, themeId) =>
        set((s) => ({
          sets: s.sets.map((st) => (st.id === setId ? { ...st, activeThemeId: themeId } : st)),
          colors: s.colors.map((c) => {
            if (c.setId !== setId) return c;
            return { ...c, value: c.themeValues[themeId] ?? c.value };
          }),
        })),

      // ── Color CRUD ──────────────────────────────────────────────────────────

      addColor: ({ value = "#6366f1", setId: inSetId, ...rest }) => {
        const { sets } = get();
        const setId = inSetId ?? sets[0]?.id ?? DEFAULT_SET_ID;
        const tokenSet = sets.find((s) => s.id === setId);
        const themeValues: Record<string, string> = {};
        for (const t of tokenSet?.themes ?? []) {
          themeValues[t.id] = value;
        }
        set((s) => ({
          colors: [...s.colors, { ...rest, id: nanoid(6), value, setId, themeValues }],
        }));
      },

      updateColor: (id, updates) =>
        set((s) => ({
          colors: s.colors.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        })),

      updateColorThemeValue: (tokenId, themeId, value) =>
        set((s) => ({
          colors: refreshAliases(s.colors.map((c) => {
            if (c.id !== tokenId) return c;
            const themeValues = { ...c.themeValues, [themeId]: value };
            const tokenSet = s.sets.find((st) => st.id === c.setId);
            const resolved =
              tokenSet?.activeThemeId === themeId ? value : c.value;
            return { ...c, themeValues, value: resolved, themeAlias: withoutKey(c.themeAlias, themeId) };
          }), s.sets),
        })),

      deleteColor: (id) =>
        set((s) => ({ colors: detachMissing(s.colors.filter((c) => c.id !== id)) })),

      // ── Other token CRUD ────────────────────────────────────────────────────

      addTypography: (token) =>
        set((s) => ({
          typography: [
            ...s.typography,
            { ...token, id: nanoid(6), setId: token.setId ?? s.sets[0]?.id ?? DEFAULT_SET_ID },
          ],
        })),
      updateTypography: (id, updates) =>
        set((s) => ({
          typography: s.typography.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),
      deleteTypography: (id) =>
        set((s) => ({ typography: s.typography.filter((t) => t.id !== id) })),

      addSpacing: (token) =>
        set((s) => ({
          spacing: [
            ...s.spacing,
            { ...token, id: nanoid(6), setId: token.setId ?? s.sets[0]?.id ?? DEFAULT_SET_ID },
          ],
        })),
      updateSpacing: (id, updates) =>
        set((s) => ({
          spacing: s.spacing.map((sp) => (sp.id === id ? { ...sp, ...updates } : sp)),
        })),
      deleteSpacing: (id) =>
        set((s) => ({ spacing: s.spacing.filter((sp) => sp.id !== id) })),

      addRadius: (token) =>
        set((s) => ({
          radii: [
            ...s.radii,
            { ...token, id: nanoid(6), setId: token.setId ?? s.sets[0]?.id ?? DEFAULT_SET_ID },
          ],
        })),
      updateRadius: (id, updates) =>
        set((s) => ({
          radii: s.radii.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),
      deleteRadius: (id) =>
        set((s) => ({ radii: s.radii.filter((r) => r.id !== id) })),

      addShadow: (token) =>
        set((s) => ({
          shadows: [
            ...s.shadows,
            { ...token, id: nanoid(6), setId: token.setId ?? s.sets[0]?.id ?? DEFAULT_SET_ID },
          ],
        })),
      updateShadow: (id, updates) =>
        set((s) => ({
          shadows: s.shadows.map((sh) => (sh.id === id ? { ...sh, ...updates } : sh)),
        })),
      deleteShadow: (id) =>
        set((s) => ({ shadows: s.shadows.filter((sh) => sh.id !== id) })),

      // ── Arranging ────────────────────────────────────────────────────────

      renameToken: (kind, id, name) => {
        const clean = name.trim();
        const token = listOf(get(), kind).find((t) => t.id === id);
        if (!token || !clean || clean === token.name || token.repoName) return false;
        set((s) => {
          const next = withList(kind, listOf(s, kind).map((t) => (t.id === id ? { ...t, name: clean } : t))) as Partial<TokenData>;
          // Colors that are this one stay it under its new name.
          return (kind === "color" ? { ...next, colors: renameAlias(next.colors!, token.setId, tokenKey(token as ColorToken), tokenKey({ name: clean })) } : next) as never;
        });
        return true;
      },

      setTokenGroup: (kind, ids, group) =>
        set((s) => withList(kind, listOf(s, kind).map((t) => (ids.includes(t.id) ? { ...t, group } : t))) as never),

      moveTokensToSet: (kind, ids, setId) =>
        set((s) => {
          const target = s.sets.find((x) => x.id === setId);
          if (!target) return {};
          const next = listOf(s, kind).map((t) => {
            if (!ids.includes(t.id) || t.setId === setId) return t;
            const moved = { ...t, setId };
            // In the new set the token is a token of Motif's own until it is synced there.
            delete moved.repoName;
            if (kind === "color") {
              const c = moved as unknown as ColorToken;
              c.themeValues = remapThemes(t as unknown as ColorToken, s.sets.find((x) => x.id === t.setId), target);
              c.value = c.themeValues[target.activeThemeId] ?? Object.values(c.themeValues)[0] ?? c.value;
              // The tokens it was are in the set it left, so it takes their colors with it.
              delete c.themeAlias;
            }
            return moved;
          });
          const out = withList(kind, next) as Partial<TokenData>;
          return (kind === "color" ? { ...out, colors: detachMissing(out.colors!) } : out) as never;
        }),

      duplicateTokens: (kind, ids) => {
        const made: string[] = [];
        set((s) => {
          const out = [...listOf(s, kind)];
          for (const id of ids) {
            const at = out.findIndex((t) => t.id === id);
            if (at < 0) continue;
            const source = out[at];
            const taken = out.filter((t) => t.setId === source.setId).map((t) => t.name);
            const copy = { ...source, id: nanoid(6), name: uniqueName(source.name, taken) } as Arranged;
            // A copy is Motif's own: it isn't the repository's token.
            delete copy.repoName;
            if (kind === "color") {
              const c = copy as unknown as ColorToken;
              c.themeValues = { ...(source as unknown as ColorToken).themeValues };
              if (c.themeAlias) c.themeAlias = { ...c.themeAlias };
            }
            out.splice(at + 1, 0, copy);
            made.push(copy.id);
          }
          return withList(kind, out) as never;
        });
        return made;
      },

      deleteTokens: (kind, ids) =>
        set((s) => {
          const next = withList(kind, listOf(s, kind).filter((t) => !ids.includes(t.id))) as Partial<TokenData>;
          return (kind === "color" ? { ...next, colors: detachMissing(next.colors!) } : next) as never;
        }),

      renameGroup: (kind, setId, from, to) =>
        set((s) => withList(kind, listOf(s, kind).map((t) => (t.setId === setId && (t.group ?? DEFAULT_GROUP) === from ? { ...t, group: to } : t))) as never),

      moveTokensBefore: (kind, ids, beforeId, group) =>
        set((s) => {
          const list = listOf(s, kind);
          const moving = list.filter((t) => ids.includes(t.id)).map((t) => (group === undefined ? t : { ...t, group }));
          const rest = list.filter((t) => !ids.includes(t.id));
          const at = beforeId === null ? rest.length : rest.findIndex((t) => t.id === beforeId);
          rest.splice(at < 0 ? rest.length : at, 0, ...moving);
          return withList(kind, rest) as never;
        }),

      regroupColors: (setId) =>
        set((s) => {
          const names = s.colors.filter((c) => c.setId === setId).map((c) => c.repoName ?? c.name);
          return { colors: s.colors.map((c) => (c.setId === setId ? { ...c, group: deriveGroup(c.repoName ?? c.name, names) } : c)) };
        }),

      setColorText: (id, themeId, text) => {
        const typed = text.trim();
        if (!typed || normalizeColor(typed) === null) return false;
        set((s) => ({
          colors: refreshAliases(s.colors.map((c) => {
            if (c.id !== id) return c;
            const themeValues = { ...c.themeValues, [themeId]: typed };
            const tokenSet = s.sets.find((st) => st.id === c.setId);
            // A color typed over an alias is that color from then on.
            return { ...c, themeValues, value: tokenSet?.activeThemeId === themeId ? typed : c.value, themeAlias: withoutKey(c.themeAlias, themeId) };
          }), s.sets),
        }));
        return true;
      },

      setColorAlias: (id, themeId, target) => {
        const token = get().colors.find((c) => c.id === id);
        if (!token) return false;
        if (target !== null) {
          const other = get().colors.find((c) => c.setId === token.setId && tokenKey(c) === target);
          if (!other || other.id === token.id || wouldLoop(get().colors, token, themeId, target)) return false;
        }
        set((s) => ({
          colors: refreshAliases(s.colors.map((c) => {
            if (c.id !== id) return c;
            const themeAlias = target === null ? withoutKey(c.themeAlias, themeId) : { ...c.themeAlias, [themeId]: target };
            return { ...c, themeAlias };
          }), s.sets),
        }));
        return true;
      },

      replaceTokenData: (data) =>
        set({ sets: data.sets, colors: data.colors, typography: data.typography, spacing: data.spacing, radii: data.radii, shadows: data.shadows, components: data.components }),

      // ── Load / Export / Import ──────────────────────────────────────────────

      loadTokens: (data) =>
        set((s) => ({
          colors: data.colors ?? s.colors,
          typography: data.typography ?? s.typography,
          spacing: data.spacing ?? s.spacing,
          radii: data.radii ?? s.radii,
          shadows: data.shadows ?? s.shadows,
        })),

      exportTokens: () => {
        const { colors, typography, spacing, radii, shadows } = get();
        const tokens: Record<string, unknown> = {
          color: {},
          typography: {},
          spacing: {},
          borderRadius: {},
          shadow: {},
        };

        for (const c of colors) {
          const group = tokens.color as Record<string, Record<string, Record<string, string>>>;
          if (!group[c.group]) group[c.group] = {};
          // A color that is another token is written as a reference to it (`{color.gray.gray-50}`).
          const active = get().sets.find((st) => st.id === c.setId)?.activeThemeId ?? "";
          const target = c.themeAlias?.[active] ? colors.find((o) => o.setId === c.setId && tokenKey(o) === c.themeAlias![active]) : undefined;
          group[c.group][c.name] = { $value: target ? `{color.${target.group}.${target.name}}` : c.value, $type: "color" };
        }
        for (const t of typography) {
          (tokens.typography as Record<string, unknown>)[t.name] = {
            $type: "typography",
            $value: { fontFamily: t.fontFamily, fontSize: `${t.fontSize}px`, fontWeight: t.fontWeight, lineHeight: `${t.lineHeight}px` },
          };
        }
        for (const sp of spacing) {
          (tokens.spacing as Record<string, unknown>)[sp.name] = { $value: `${sp.value}px`, $type: "dimension" };
        }
        for (const r of radii) {
          (tokens.borderRadius as Record<string, unknown>)[r.name] = {
            $value: r.value === 9999 ? "50%" : `${r.value}px`, $type: "dimension",
          };
        }
        for (const sh of shadows) {
          (tokens.shadow as Record<string, unknown>)[sh.name] = {
            $type: "shadow",
            $value: { x: sh.x, y: sh.y, blur: sh.blur, spread: sh.spread, color: sh.color },
          };
        }
        return JSON.stringify(tokens, null, 2);
      },

      exportCSS: () => {
        const { colors, spacing, radii, shadows } = get();
        const lines: string[] = [":root {"];
        for (const c of colors) {
          const active = get().sets.find((st) => st.id === c.setId)?.activeThemeId ?? "";
          const target = c.themeAlias?.[active] ? colors.find((o) => o.setId === c.setId && tokenKey(o) === c.themeAlias![active]) : undefined;
          lines.push(`  --color-${toKebab(c.name)}: ${target ? `var(--color-${toKebab(target.name)})` : c.value};`);
        }
        for (const sp of spacing) lines.push(`  --spacing-${toKebab(sp.name.replace(/^space-/, ""))}: ${sp.value}px;`);
        for (const r of radii) lines.push(`  --radius-${toKebab(r.name.replace(/^radius-/, ""))}: ${r.value === 9999 ? "9999px" : `${r.value}px`};`);
        for (const sh of shadows) lines.push(`  --shadow-${toKebab(sh.name.replace(/^shadow-/, ""))}: ${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread}px ${sh.color};`);
        lines.push("}");
        return lines.join("\n");
      },

      exportTailwind: () => {
        const { colors, spacing, radii } = get();
        const twColors: Record<string, Record<string, string>> = {};
        for (const c of colors) {
          if (!twColors[c.group]) twColors[c.group] = {};
          twColors[c.group][c.name.split("-").pop() ?? c.name] = c.value;
        }
        const twSpacing: Record<string, string> = {};
        for (const sp of spacing) twSpacing[sp.name.replace(/^space-/, "")] = `${sp.value}px`;
        const twRadius: Record<string, string> = {};
        for (const r of radii) twRadius[r.name.replace(/^radius-/, "") || "DEFAULT"] = r.value === 9999 ? "9999px" : `${r.value}px`;
        return `/** @type {import('tailwindcss').Config} */\nmodule.exports = ${JSON.stringify({ theme: { extend: { colors: twColors, spacing: twSpacing, borderRadius: twRadius } } }, null, 2)};`;
      },

      importFromJSON: (json: string) => {
        const errors: string[] = [];
        let imported = 0;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(json); } catch { return { imported: 0, errors: ["Invalid JSON"] }; }

        const { sets } = get();
        const targetSetId = sets[0]?.id ?? DEFAULT_SET_ID;
        const targetSet = sets.find((s) => s.id === targetSetId);
        const newColors: ColorToken[] = [];
        const newSpacing: SpacingToken[] = [];
        const newRadii: RadiusToken[] = [];

        function walkColors(obj: Record<string, unknown>, group: string, prefix: string) {
          for (const [key, val] of Object.entries(obj)) {
            if (val && typeof val === "object") {
              const v = val as Record<string, unknown>;
              if (v.$type === "color" || (typeof v.$value === "string" && (v.$value as string).startsWith("#"))) {
                const colorVal = v.$value as string;
                const themeValues: Record<string, string> = {};
                for (const t of targetSet?.themes ?? []) themeValues[t.id] = colorVal;
                newColors.push({ id: nanoid(6), name: prefix ? `${prefix}-${key}` : key, value: colorVal, group, setId: targetSetId, themeValues });
                imported++;
              } else if (!("$value" in v)) {
                walkColors(v as Record<string, unknown>, group || key, prefix ? `${prefix}-${key}` : key);
              }
            }
          }
        }

        try {
          if (parsed.color && typeof parsed.color === "object") walkColors(parsed.color as Record<string, unknown>, "", "");
          if (parsed.colors && typeof parsed.colors === "object") walkColors(parsed.colors as Record<string, unknown>, "", "");
          if (parsed.spacing && typeof parsed.spacing === "object") {
            for (const [key, val] of Object.entries(parsed.spacing as Record<string, unknown>)) {
              if (val && typeof val === "object") {
                const n = parseFloat((val as Record<string, string>).$value ?? "");
                if (!isNaN(n)) { newSpacing.push({ id: nanoid(6), name: key, value: n, setId: targetSetId }); imported++; }
              }
            }
          }
          if (parsed.borderRadius && typeof parsed.borderRadius === "object") {
            for (const [key, val] of Object.entries(parsed.borderRadius as Record<string, unknown>)) {
              if (val && typeof val === "object") {
                const raw = (val as Record<string, string>).$value ?? "";
                const n = raw === "50%" ? 9999 : parseFloat(raw);
                if (!isNaN(n)) { newRadii.push({ id: nanoid(6), name: key, value: n, setId: targetSetId }); imported++; }
              }
            }
          }
        } catch (e) { errors.push(`Parse error: ${e}`); }

        if (newColors.length || newSpacing.length || newRadii.length) {
          set((s) => ({
            colors: newColors.length ? [...s.colors, ...newColors] : s.colors,
            spacing: newSpacing.length ? [...s.spacing, ...newSpacing] : s.spacing,
            radii: newRadii.length ? [...s.radii, ...newRadii] : s.radii,
          }));
        }
        return { imported, errors };
      },
  })
);
