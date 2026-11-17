import { create } from "zustand";
import { nanoid } from "nanoid";
import { normalizeColor } from "@/lib/token-sync/color";
import { deriveGroup, uniqueName } from "@/lib/tokens/organize";
import { darkOf } from "@/lib/tokens/theme-gen";
import { detachMissing, moveColors, refreshAliases, renameAlias, targetOf, tokenKey, wouldLoop } from "@/lib/tokens/alias-colors";
import type { Composition, Unit } from "@/lib/tokens/model";
import { previewStyle, releaseSlots, resolve, type ComposeData } from "@/lib/tokens/compose";

// ── Theme & Set types ─────────────────────────────────────────────────────────

export interface TokenTheme {
  id: string;
  name: string;
  // The key of the theme in the repository's tokens.config.json, when it isn't the one its name gives.
  repoKey?: string;
}

export interface TokenSet {
  id: string;
  name: string;
  // The key of the set in the repository's tokens.config.json, when it isn't the one its name gives.
  repoKey?: string;
  themes: TokenTheme[];
  activeThemeId: string;
  // What the collection is for ("Primitives", "Semantic colors that follow them"); Motif's own note, never sent to a repository.
  description?: string;
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

// A number that isn't a spacing or a radius in pixels (those are tokens of their own kind, which the repository's sync reads and writes): a
// font size in rem, a line height, a font weight, a ratio. Motif's own until the repository's sync knows them.
export interface NumberToken {
  id: string;
  name: string;
  value: number;
  unit: Unit;
  // Where it belongs: font-size, line-height, font-weight, letter-spacing, or nothing said.
  use?: string;
  group?: string;
  setId: string;
  repoName?: string;
}

export interface StringToken {
  id: string;
  name: string;
  value: string;
  // Where it belongs: font-family, or nothing said.
  use?: string;
  group?: string;
  setId: string;
  repoName?: string;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultProps: Record<string, unknown>;
}

export type TokenKind = "color" | "typography" | "spacing" | "radius" | "shadow" | "number" | "string" | "composition";

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
  numbers: NumberToken[];
  strings: StringToken[];
  // Tokens that go together as one, whose parts are values of their own or other tokens.
  compositions: Composition[];
  components: ComponentDefinition[];

  // Set management
  createSet: (name: string) => string;
  renameSet: (setId: string, name: string) => void;
  // What the set is for; empty takes the note away.
  setSetDescription: (setId: string, description: string) => void;
  // Moves a set one place earlier (-1) or later (1) in the list of sets.
  moveSet: (setId: string, direction: -1 | 1) => void;
  // Takes the set and its tokens away. Colors of other sets that were tokens of it keep the colors they came to; says how many aliases that was.
  deleteSet: (setId: string) => number;

  // Theme management
  // A new theme at the end. It starts as a copy of `from` (the open theme when not given); with `dark`, the colors that are colors of their
  // own (not other tokens) are made a dark version of that theme's. Returns its id.
  addThemeToSet: (setId: string, name: string, options?: { from?: string; dark?: boolean }) => string;
  // A new theme next to `themeId` with the same values (and tokens that are other tokens); returns its id.
  duplicateTheme: (setId: string, themeId: string) => string;
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

  // Numbers and strings that aren't a spacing or a radius. Each add returns the id of the token it made.
  addNumber: (token: Omit<NumberToken, "id">) => string;
  updateNumber: (id: string, updates: Partial<NumberToken>) => void;
  deleteNumber: (id: string) => void;
  addString: (token: Omit<StringToken, "id">) => string;
  updateString: (id: string, updates: Partial<StringToken>) => void;
  deleteString: (id: string) => void;

  // Compositions: each add returns the id of the composition it made. A slot that is another token follows it; the token being deleted leaves
  // the slot with the value it had.
  addComposition: (composition: Omit<Composition, "id">) => string;
  updateComposition: (id: string, updates: Partial<Composition>) => void;
  deleteComposition: (id: string) => void;

  addShadow: (token: Omit<ShadowToken, "id">) => void;
  updateShadow: (id: string, updates: Partial<ShadowToken>) => void;
  deleteShadow: (id: string) => void;

  // Arranging tokens. Each takes the kind of token and the ids; the screen makes each one step of its undo.
  // A token the repository names can't be renamed here: the repository's name is what Sync matches it by.
  renameToken: (kind: TokenKind, id: string, name: string) => boolean;
  // A token the repository names takes the name the repository will have for it (the files are changed by the rename that stages them),
  // and the colors that are it follow. False when it isn't one of the repository's, or another token of its set has that name.
  renameRepoToken: (kind: TokenKind, id: string, to: string) => boolean;
  // Renames a token that is in design tokens files: its name, and the place it is at when that isn't where its name puts it (`repoName`).
  // Colors that are it stay it.
  renameFileToken: (kind: TokenKind, id: string, name: string, repoName: string | undefined) => boolean;
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
  // Makes the colors, in the theme `to`, what they are in the theme `from` (a color that is another token there is that token here).
  copyThemeColors: (ids: string[], from: string, to: string) => void;
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
  numbers: NumberToken[];
  strings: StringToken[];
  compositions: Composition[];
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
    numbers: [],
    strings: [],
    compositions: [],
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
  numbers: s.numbers,
  strings: s.strings,
  compositions: s.compositions,
  components: s.components,
});

// The tokens a composition's slots can be.
const composeData = (s: TokenData): ComposeData => ({ colors: s.colors, numbers: s.numbers, strings: s.strings, spacing: s.spacing, radii: s.radii });

// The compositions as they should be when tokens go: their slots keep the values the tokens had.
const released = (s: TokenData, gone: string[]): Composition[] => releaseSlots(s.compositions, composeData(s), new Set(gone));

// ── Helpers ───────────────────────────────────────────────────────────────────

// "Dark copy", then "Dark copy 2", for a theme made from "Dark" (names are compared without regard to case).
export function copyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const base = `${name} copy`;
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

function toKebab(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").toLowerCase();
}


const SLICE = { color: "colors", typography: "typography", spacing: "spacing", radius: "radii", shadow: "shadows", number: "numbers", string: "strings", composition: "compositions" } as const;

type Arranged = { id: string; name: string; setId: string; group?: string; repoName?: string };
const listOf = (s: TokenData, kind: TokenKind) => s[SLICE[kind]] as unknown as Arranged[];
const withList = (kind: TokenKind, list: Arranged[]) => ({ [SLICE[kind]]: list }) as unknown as Partial<TokenData>;

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

      setSetDescription: (setId, description) =>
        set((s) => ({
          sets: s.sets.map((st) => {
            if (st.id !== setId) return st;
            const { description: _, ...rest } = st;
            const text = description.trim();
            return text ? { ...rest, description: text } : rest;
          }),
        })),

      moveSet: (setId, direction) =>
        set((s) => {
          const at = s.sets.findIndex((st) => st.id === setId);
          const to = at + direction;
          if (at < 0 || to < 0 || to >= s.sets.length) return s;
          const sets = [...s.sets];
          [sets[at], sets[to]] = [sets[to], sets[at]];
          return { sets };
        }),

      deleteSet: (setId) => {
        const aliasesIn = (colors: ColorToken[]) => colors.reduce((n, c) => n + Object.keys(c.themeAlias ?? {}).length, 0);
        const before = aliasesIn(get().colors.filter((c) => c.setId !== setId));
        let detached = 0;
        set((s) => {
          const colors = detachMissing(s.colors.filter((c) => c.setId !== setId));
          detached = before - aliasesIn(colors);
          const gone = [...s.colors, ...s.numbers, ...s.strings, ...s.spacing, ...s.radii].filter((t) => t.setId === setId).map((t) => t.id);
          return {
            compositions: released(s, gone).filter((c) => c.setId !== setId),
            sets: s.sets.filter((st) => st.id !== setId),
            colors,
            typography: s.typography.filter((t) => t.setId !== setId),
            spacing: s.spacing.filter((sp) => sp.setId !== setId),
            radii: s.radii.filter((r) => r.setId !== setId),
            shadows: s.shadows.filter((sh) => sh.setId !== setId),
            numbers: s.numbers.filter((n) => n.setId !== setId),
            strings: s.strings.filter((t) => t.setId !== setId),
          };
        });
        return detached;
      },

      // ── Theme management ────────────────────────────────────────────────────

      addThemeToSet: (setId, name, options) => {
        const themeId = `theme-${nanoid(6)}`;
        set((s) => {
          const tokenSet = s.sets.find((st) => st.id === setId);
          const wanted = options?.from;
          const baseThemeId = (wanted && tokenSet?.themes.some((t) => t.id === wanted) ? wanted : undefined) ?? tokenSet?.activeThemeId ?? tokenSet?.themes[0]?.id ?? "";
          const sets = s.sets.map((st) => (st.id === setId ? { ...st, themes: [...st.themes, { id: themeId, name }] } : st));
          return {
            sets,
            // Clone the values of the theme it starts from into the new theme
            colors: refreshAliases(s.colors.map((c) => {
              if (c.setId !== setId) return c;
              const baseValue = c.themeValues[baseThemeId] ?? c.value;
              const baseAlias = c.themeAlias?.[baseThemeId];
              const value = options?.dark && !baseAlias ? (darkOf(baseValue) ?? baseValue) : baseValue;
              return { ...c, themeValues: { ...c.themeValues, [themeId]: value }, ...(baseAlias ? { themeAlias: { ...c.themeAlias, [themeId]: baseAlias } } : {}) };
            }), sets),
          };
        });
        return themeId;
      },

      duplicateTheme: (setId, themeId) => {
        const id = `theme-${nanoid(6)}`;
        set((s) => {
          const tokenSet = s.sets.find((st) => st.id === setId);
          const source = tokenSet?.themes.find((t) => t.id === themeId);
          if (!tokenSet || !source) return s;
          const at = tokenSet.themes.findIndex((t) => t.id === themeId);
          const name = copyName(source.name, tokenSet.themes.map((t) => t.name));
          return {
            sets: s.sets.map((st) => (st.id === setId ? { ...st, themes: [...st.themes.slice(0, at + 1), { id, name }, ...st.themes.slice(at + 1)] } : st)),
            colors: s.colors.map((c) => {
              if (c.setId !== setId) return c;
              const alias = c.themeAlias?.[themeId];
              return { ...c, themeValues: { ...c.themeValues, [id]: c.themeValues[themeId] ?? c.value }, ...(alias ? { themeAlias: { ...c.themeAlias, [id]: alias } } : {}) };
            }),
          };
        });
        return id;
      },

      deleteThemeFromSet: (setId, themeId) =>
        set((s) => {
          const sets = s.sets.map((st) => {
            if (st.id !== setId) return st;
            const themes = st.themes.filter((t) => t.id !== themeId);
            const activeThemeId =
              st.activeThemeId === themeId ? (themes[0]?.id ?? "") : st.activeThemeId;
            return { ...st, themes, activeThemeId };
          });
          return {
            sets,
            // Colors of other sets that followed this theme by its name now follow the theme their set has open, so they are brought up to date.
            colors: refreshAliases(s.colors.map((c) => {
              if (c.setId !== setId) return c;
              const { [themeId]: _, ...rest } = c.themeValues;
              const { [themeId]: __, ...aliases } = c.themeAlias ?? {};
              return { ...c, themeValues: rest, themeAlias: Object.keys(aliases).length ? aliases : undefined };
            }), sets),
          };
        }),

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
        set((s) => ({ colors: detachMissing(s.colors.filter((c) => c.id !== id)), compositions: released(s, [id]) })),

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

      addNumber: (token) => {
        const id = nanoid(6);
        set((s) => ({ numbers: [...s.numbers, { ...token, id, setId: token.setId ?? s.sets[0]?.id ?? DEFAULT_SET_ID }] }));
        return id;
      },
      updateNumber: (id, updates) =>
        set((s) => ({ numbers: s.numbers.map((n) => (n.id === id ? { ...n, ...updates } : n)) })),
      deleteNumber: (id) =>
        set((s) => ({ numbers: s.numbers.filter((n) => n.id !== id), compositions: released(s, [id]) })),

      addString: (token) => {
        const id = nanoid(6);
        set((s) => ({ strings: [...s.strings, { ...token, id, setId: token.setId ?? s.sets[0]?.id ?? DEFAULT_SET_ID }] }));
        return id;
      },
      updateString: (id, updates) =>
        set((s) => ({ strings: s.strings.map((t) => (t.id === id ? { ...t, ...updates } : t)) })),
      deleteString: (id) =>
        set((s) => ({ strings: s.strings.filter((t) => t.id !== id), compositions: released(s, [id]) })),

      addComposition: (composition) => {
        const id = nanoid(6);
        set((s) => ({ compositions: [...s.compositions, { ...composition, id, setId: composition.setId ?? s.sets[0]?.id ?? DEFAULT_SET_ID }] }));
        return id;
      },
      updateComposition: (id, updates) =>
        set((s) => ({ compositions: s.compositions.map((c) => (c.id === id ? { ...c, ...updates } : c)) })),
      deleteComposition: (id) =>
        set((s) => ({ compositions: s.compositions.filter((c) => c.id !== id) })),

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

      renameRepoToken: (kind, id, to) => {
        const token = listOf(get(), kind).find((t) => t.id === id);
        if (!token || !token.repoName || !to) return false;
        if (listOf(get(), kind).some((t) => t.id !== id && t.setId === token.setId && tokenKey(t) === to)) return false;
        const from = token.repoName;
        set((s) => {
          const next = withList(kind, listOf(s, kind).map((t) => (t.id === id ? { ...t, name: to, repoName: to } : t))) as Partial<TokenData>;
          return (kind === "color" ? { ...next, colors: renameAlias(next.colors!, token.setId, from, to) } : next) as never;
        });
        return true;
      },

      renameFileToken: (kind, id, name, repoName) => {
        const token = listOf(get(), kind).find((t) => t.id === id);
        if (!token || !name) return false;
        const to = tokenKey({ name, repoName });
        if (listOf(get(), kind).some((t) => t.id !== id && t.setId === token.setId && tokenKey(t as { name: string; repoName?: string }) === to)) return false;
        const from = tokenKey(token as { name: string; repoName?: string });
        set((s) => {
          const next = withList(kind, listOf(s, kind).map((t) => (t.id === id ? { ...t, name, repoName } : t))) as Partial<TokenData>;
          return (kind === "color" ? { ...next, colors: renameAlias(next.colors!, token.setId, from, to) } : next) as never;
        });
        return true;
      },

      setTokenGroup: (kind, ids, group) =>
        set((s) => withList(kind, listOf(s, kind).map((t) => (ids.includes(t.id) ? { ...t, group } : t))) as never),

      moveTokensToSet: (kind, ids, setId) =>
        set((s) => {
          const target = s.sets.find((x) => x.id === setId);
          if (!target) return {};
          // Colors keep being the tokens they were, and the colors that were them keep being them, in whichever set each is.
          if (kind === "color") return { colors: moveColors(s.colors, ids, setId, s.sets) };
          const next = listOf(s, kind).map((t) => {
            if (!ids.includes(t.id) || t.setId === setId) return t;
            const moved = { ...t, setId };
            // In the new set the token is a token of Motif's own until it is synced there.
            delete moved.repoName;
            return moved;
          });
          return withList(kind, next) as never;
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
            if (kind === "composition") (copy as unknown as Composition).slots = (source as unknown as Composition).slots.map((x) => ({ ...x }));
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
          const withColors = kind === "color" ? { ...next, colors: detachMissing(next.colors!) } : next;
          // Compositions that had one of these as a part keep the value it had.
          return (kind === "composition" ? withColors : { ...withColors, compositions: released(s, ids) }) as never;
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
          const other = targetOf(get().colors, token, target);
          if (!other || other.id === token.id || wouldLoop(get().colors, token, themeId, target, get().sets)) return false;
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

      copyThemeColors: (ids, from, to) => {
        if (from === to) return;
        set((s) => ({
          colors: refreshAliases(s.colors.map((c) => {
            if (!ids.includes(c.id)) return c;
            const themeValues = { ...c.themeValues, [to]: c.themeValues[from] ?? c.value };
            const target = c.themeAlias?.[from];
            // An alias goes along unless it would lead back to the color itself in the other theme: then it is the color it is.
            const alias = target && !wouldLoop(s.colors, c, to, target, s.sets) ? { ...c.themeAlias, [to]: target } : withoutKey(c.themeAlias, to);
            const tokenSet = s.sets.find((st) => st.id === c.setId);
            return { ...c, themeValues, value: tokenSet?.activeThemeId === to ? themeValues[to] : c.value, themeAlias: alias };
          }), s.sets),
        }));
      },

      replaceTokenData: (data) =>
        set({ sets: data.sets, colors: data.colors, typography: data.typography, spacing: data.spacing, radii: data.radii, shadows: data.shadows, numbers: data.numbers ?? [], strings: data.strings ?? [], compositions: data.compositions ?? [], components: data.components }),

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
          const target = c.themeAlias?.[active] ? targetOf(colors, c, c.themeAlias[active]) : undefined;
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
        const { numbers, strings } = get();
        if (numbers.length) {
          const group: Record<string, unknown> = {};
          for (const n of numbers) group[n.name] = n.unit ? { $value: `${n.value}${n.unit}`, $type: "dimension" } : { $value: n.value, $type: "number" };
          tokens.number = group;
        }
        if (strings.length) {
          const group: Record<string, unknown> = {};
          for (const t of strings) group[t.name] = t.use === "font-family" ? { $value: t.value, $type: "fontFamily" } : { $value: t.value, $type: "string" };
          tokens.string = group;
        }
        const data = composeData(get());
        const { compositions } = get();
        if (compositions.length) {
          const group: Record<string, unknown> = {};
          const dtcg = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
          for (const c of compositions) {
            const v = resolve(c, data);
            if (c.kind === "typography") {
              group[c.name] = { $type: "typography", $value: Object.fromEntries(Object.entries(v).map(([k, x]) => [dtcg(k), x])) };
            } else if (c.kind === "shadow") {
              group[c.name] = { $type: "shadow", $value: { x: v.x ?? "0px", y: v.y ?? "0px", blur: v.blur ?? "0px", spread: v.spread ?? "0px", color: v.color ?? "#00000040", ...(c.inset ? { inset: true } : {}) } };
            } else {
              // A custom composition is a group of the tokens it is made of.
              group[c.name] = Object.fromEntries(c.slots.filter((x) => v[x.name] !== undefined).map((x) => [x.name, { $value: v[x.name], $type: x.type === "number" ? (x.unit ? "dimension" : "number") : x.type === "color" ? "color" : "string" }]));
            }
          }
          tokens.composition = group;
        }
        return JSON.stringify(tokens, null, 2);
      },

      exportCSS: () => {
        const { colors, spacing, radii, shadows } = get();
        const lines: string[] = [":root {"];
        for (const c of colors) {
          const active = get().sets.find((st) => st.id === c.setId)?.activeThemeId ?? "";
          const target = c.themeAlias?.[active] ? targetOf(colors, c, c.themeAlias[active]) : undefined;
          lines.push(`  --color-${toKebab(c.name)}: ${target ? `var(--color-${toKebab(target.name)})` : c.value};`);
        }
        for (const sp of spacing) lines.push(`  --spacing-${toKebab(sp.name.replace(/^space-/, ""))}: ${sp.value}px;`);
        for (const r of radii) lines.push(`  --radius-${toKebab(r.name.replace(/^radius-/, ""))}: ${r.value === 9999 ? "9999px" : `${r.value}px`};`);
        for (const sh of shadows) lines.push(`  --shadow-${toKebab(sh.name.replace(/^shadow-/, ""))}: ${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread}px ${sh.color};`);
        for (const n of get().numbers) lines.push(`  --${toKebab(n.name)}: ${n.value}${n.unit};`);
        for (const t of get().strings) lines.push(`  --${toKebab(t.name)}: ${t.value};`);
        for (const c of get().compositions) {
          if (c.kind === "shadow") { lines.push(`  --shadow-${toKebab(c.name.replace(/^shadow-/, ""))}: ${previewStyle(c, composeData(get())).boxShadow};`); continue; }
          for (const [slotName, text] of Object.entries(resolve(c, composeData(get())))) lines.push(`  --${toKebab(c.name)}-${slotName}: ${text};`);
        }
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
