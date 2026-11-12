import { create } from "zustand";
import { persist } from "zustand/middleware";
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
}

export interface RadiusToken {
  id: string;
  name: string;
  value: number;
  setId: string;
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

function mkColor(id: string, name: string, value: string, group: string): ColorToken {
  return { id, name, value, group, setId: DEFAULT_SET_ID, themeValues: { [DEFAULT_THEME_ID]: value } };
}

const DEFAULT_COLORS: ColorToken[] = [
  mkColor("c1", "primary-50", "#eef2ff", "primary"),
  mkColor("c2", "primary-100", "#e0e7ff", "primary"),
  mkColor("c3", "primary-200", "#c7d2fe", "primary"),
  mkColor("c4", "primary-300", "#a5b4fc", "primary"),
  mkColor("c5", "primary-400", "#818cf8", "primary"),
  mkColor("c6", "primary-500", "#6366f1", "primary"),
  mkColor("c7", "primary-600", "#4f46e5", "primary"),
  mkColor("c8", "primary-700", "#4338ca", "primary"),
  mkColor("n1", "neutral-50", "#fafafa", "neutral"),
  mkColor("n2", "neutral-100", "#f5f5f5", "neutral"),
  mkColor("n3", "neutral-200", "#e5e5e5", "neutral"),
  mkColor("n4", "neutral-300", "#d4d4d4", "neutral"),
  mkColor("n5", "neutral-400", "#a3a3a3", "neutral"),
  mkColor("n6", "neutral-500", "#737373", "neutral"),
  mkColor("n7", "neutral-700", "#404040", "neutral"),
  mkColor("n8", "neutral-900", "#171717", "neutral"),
  mkColor("s1", "success", "#22c55e", "semantic"),
  mkColor("s2", "warning", "#f59e0b", "semantic"),
  mkColor("s3", "error", "#ef4444", "semantic"),
  mkColor("s4", "info", "#3b82f6", "semantic"),
];

function mkTypo(id: string, name: string, fontFamily: string, fontSize: number, fontWeight: number, lineHeight: number): TypographyToken {
  return { id, name, fontFamily, fontSize, fontWeight, lineHeight, setId: DEFAULT_SET_ID };
}

const DEFAULT_TYPOGRAPHY: TypographyToken[] = [
  mkTypo("t1", "display-xl", "Inter", 48, 700, 56),
  mkTypo("t2", "display-lg", "Inter", 36, 700, 44),
  mkTypo("t3", "heading-xl", "Inter", 30, 600, 38),
  mkTypo("t4", "heading-lg", "Inter", 24, 600, 32),
  mkTypo("t5", "heading-md", "Inter", 20, 600, 28),
  mkTypo("t6", "heading-sm", "Inter", 16, 600, 24),
  mkTypo("t7", "body-lg", "Inter", 16, 400, 24),
  mkTypo("t8", "body-md", "Inter", 14, 400, 20),
  mkTypo("t9", "body-sm", "Inter", 12, 400, 18),
  mkTypo("t10", "label-lg", "Inter", 14, 500, 20),
  mkTypo("t11", "label-sm", "Inter", 12, 500, 16),
  mkTypo("t12", "caption", "Inter", 11, 400, 16),
];

const DEFAULT_SPACING: SpacingToken[] = [
  { id: "sp1", name: "space-1", value: 4, setId: DEFAULT_SET_ID },
  { id: "sp2", name: "space-2", value: 8, setId: DEFAULT_SET_ID },
  { id: "sp3", name: "space-3", value: 12, setId: DEFAULT_SET_ID },
  { id: "sp4", name: "space-4", value: 16, setId: DEFAULT_SET_ID },
  { id: "sp5", name: "space-5", value: 20, setId: DEFAULT_SET_ID },
  { id: "sp6", name: "space-6", value: 24, setId: DEFAULT_SET_ID },
  { id: "sp7", name: "space-8", value: 32, setId: DEFAULT_SET_ID },
  { id: "sp8", name: "space-10", value: 40, setId: DEFAULT_SET_ID },
  { id: "sp9", name: "space-12", value: 48, setId: DEFAULT_SET_ID },
  { id: "sp10", name: "space-16", value: 64, setId: DEFAULT_SET_ID },
];

const DEFAULT_RADII: RadiusToken[] = [
  { id: "r1", name: "radius-none", value: 0, setId: DEFAULT_SET_ID },
  { id: "r2", name: "radius-sm", value: 2, setId: DEFAULT_SET_ID },
  { id: "r3", name: "radius-md", value: 4, setId: DEFAULT_SET_ID },
  { id: "r4", name: "radius-lg", value: 8, setId: DEFAULT_SET_ID },
  { id: "r5", name: "radius-xl", value: 12, setId: DEFAULT_SET_ID },
  { id: "r6", name: "radius-2xl", value: 16, setId: DEFAULT_SET_ID },
  { id: "r7", name: "radius-full", value: 9999, setId: DEFAULT_SET_ID },
];

const DEFAULT_SHADOWS: ShadowToken[] = [
  { id: "sh1", name: "shadow-sm", x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0,0,0,0.05)", group: "default", setId: DEFAULT_SET_ID },
  { id: "sh2", name: "shadow-md", x: 0, y: 4, blur: 6, spread: -1, color: "rgba(0,0,0,0.1)", group: "default", setId: DEFAULT_SET_ID },
  { id: "sh3", name: "shadow-lg", x: 0, y: 10, blur: 15, spread: -3, color: "rgba(0,0,0,0.1)", group: "default", setId: DEFAULT_SET_ID },
  { id: "sh4", name: "shadow-xl", x: 0, y: 20, blur: 25, spread: -5, color: "rgba(0,0,0,0.1)", group: "default", setId: DEFAULT_SET_ID },
  { id: "sh5", name: "shadow-inner", x: 0, y: 2, blur: 4, spread: 0, color: "rgba(0,0,0,0.06)", group: "inner", setId: DEFAULT_SET_ID },
];

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

export const useDesignSystemStore = create<DesignSystemStore>()(
  persist(
    (set, get) => ({
      sets: DEFAULT_SETS,
      colors: DEFAULT_COLORS,
      typography: DEFAULT_TYPOGRAPHY,
      spacing: DEFAULT_SPACING,
      radii: DEFAULT_RADII,
      shadows: DEFAULT_SHADOWS,
      components: [],

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
    }),
    {
      name: "motif-design-system",
      merge: (persisted: unknown, current) => {
        const p = persisted as Partial<DesignSystemStore> | null;
        if (!p) return current;
        // Migrate old ColorTokens that lack setId/themeValues
        const colors = (p.colors ?? current.colors).map((c: ColorToken) => ({
          ...c,
          setId: c.setId ?? DEFAULT_SET_ID,
          themeValues: c.themeValues ?? { [DEFAULT_THEME_ID]: c.value },
        }));
        // Migrate other token types
        const migrateSetId = <T extends { setId?: string }>(arr: T[]): T[] =>
          arr.map((t) => ({ setId: DEFAULT_SET_ID, ...t }));
        return {
          ...current,
          ...p,
          sets: p.sets ?? current.sets,
          colors,
          typography: migrateSetId(p.typography ?? current.typography),
          spacing: migrateSetId(p.spacing ?? current.spacing),
          radii: migrateSetId(p.radii ?? current.radii),
          shadows: migrateSetId(p.shadows ?? current.shadows),
        };
      },
    }
  )
);
