import { create } from "zustand";
import { nanoid } from "nanoid";

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

export interface ColorToken {
  id: string;
  name: string;
  value: string; // resolved from active theme
  group: string;
  setId: string;
  themeValues: Record<string, string>; // themeId -> hex/rgba
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
  setId: string;
}

export interface SpacingToken {
  id: string;
  name: string;
  value: number;
  setId: string;
  repoName?: string;
}

export interface RadiusToken {
  id: string;
  name: string;
  value: number;
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

function resolveColor(token: ColorToken, sets: TokenSet[]): string {
  const tokenSet = sets.find((s) => s.id === token.setId);
  if (!tokenSet) return token.value;
  return token.themeValues[tokenSet.activeThemeId] ?? token.value;
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
              return { ...c, themeValues: { ...c.themeValues, [themeId]: baseValue } };
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
            return { ...c, themeValues: rest };
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
          colors: s.colors.map((c) => {
            if (c.id !== tokenId) return c;
            const themeValues = { ...c.themeValues, [themeId]: value };
            const tokenSet = s.sets.find((st) => st.id === c.setId);
            const resolved =
              tokenSet?.activeThemeId === themeId ? value : c.value;
            return { ...c, themeValues, value: resolved };
          }),
        })),

      deleteColor: (id) =>
        set((s) => ({ colors: s.colors.filter((c) => c.id !== id) })),

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
          group[c.group][c.name] = { $value: c.value, $type: "color" };
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
        for (const c of colors) lines.push(`  --color-${toKebab(c.name)}: ${c.value};`);
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
