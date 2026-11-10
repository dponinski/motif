import { create } from "zustand";
import { nanoid } from "nanoid";

export interface ColorToken {
  id: string;
  name: string;
  value: string;
  group: string;
}

export interface TypographyToken {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing?: number;
}

export interface SpacingToken {
  id: string;
  name: string;
  value: number;
}

export interface RadiusToken {
  id: string;
  name: string;
  value: number;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultProps: Record<string, unknown>;
}

interface DesignSystemStore {
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
  radii: RadiusToken[];
  components: ComponentDefinition[];

  addColor: (token: Omit<ColorToken, "id">) => void;
  updateColor: (id: string, updates: Partial<ColorToken>) => void;
  deleteColor: (id: string) => void;

  addTypography: (token: Omit<TypographyToken, "id">) => void;
  updateTypography: (id: string, updates: Partial<TypographyToken>) => void;
  deleteTypography: (id: string) => void;

  addSpacing: (token: Omit<SpacingToken, "id">) => void;
  updateSpacing: (id: string, updates: Partial<SpacingToken>) => void;
  deleteSpacing: (id: string) => void;

  loadTokens: (data: {
    colors?: ColorToken[];
    typography?: TypographyToken[];
    spacing?: SpacingToken[];
    radii?: RadiusToken[];
  }) => void;

  exportTokens: () => string;
}

const DEFAULT_COLORS: ColorToken[] = [
  // Primary
  { id: "c1", name: "primary-50", value: "#eef2ff", group: "primary" },
  { id: "c2", name: "primary-100", value: "#e0e7ff", group: "primary" },
  { id: "c3", name: "primary-200", value: "#c7d2fe", group: "primary" },
  { id: "c4", name: "primary-300", value: "#a5b4fc", group: "primary" },
  { id: "c5", name: "primary-400", value: "#818cf8", group: "primary" },
  { id: "c6", name: "primary-500", value: "#6366f1", group: "primary" },
  { id: "c7", name: "primary-600", value: "#4f46e5", group: "primary" },
  { id: "c8", name: "primary-700", value: "#4338ca", group: "primary" },
  // Neutral
  { id: "n1", name: "neutral-50", value: "#fafafa", group: "neutral" },
  { id: "n2", name: "neutral-100", value: "#f5f5f5", group: "neutral" },
  { id: "n3", name: "neutral-200", value: "#e5e5e5", group: "neutral" },
  { id: "n4", name: "neutral-300", value: "#d4d4d4", group: "neutral" },
  { id: "n5", name: "neutral-400", value: "#a3a3a3", group: "neutral" },
  { id: "n6", name: "neutral-500", value: "#737373", group: "neutral" },
  { id: "n7", name: "neutral-700", value: "#404040", group: "neutral" },
  { id: "n8", name: "neutral-900", value: "#171717", group: "neutral" },
  // Semantic
  { id: "s1", name: "success", value: "#22c55e", group: "semantic" },
  { id: "s2", name: "warning", value: "#f59e0b", group: "semantic" },
  { id: "s3", name: "error", value: "#ef4444", group: "semantic" },
  { id: "s4", name: "info", value: "#3b82f6", group: "semantic" },
];

const DEFAULT_TYPOGRAPHY: TypographyToken[] = [
  { id: "t1", name: "display-xl", fontFamily: "Inter", fontSize: 48, fontWeight: 700, lineHeight: 56 },
  { id: "t2", name: "display-lg", fontFamily: "Inter", fontSize: 36, fontWeight: 700, lineHeight: 44 },
  { id: "t3", name: "heading-xl", fontFamily: "Inter", fontSize: 30, fontWeight: 600, lineHeight: 38 },
  { id: "t4", name: "heading-lg", fontFamily: "Inter", fontSize: 24, fontWeight: 600, lineHeight: 32 },
  { id: "t5", name: "heading-md", fontFamily: "Inter", fontSize: 20, fontWeight: 600, lineHeight: 28 },
  { id: "t6", name: "heading-sm", fontFamily: "Inter", fontSize: 16, fontWeight: 600, lineHeight: 24 },
  { id: "t7", name: "body-lg", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 24 },
  { id: "t8", name: "body-md", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20 },
  { id: "t9", name: "body-sm", fontFamily: "Inter", fontSize: 12, fontWeight: 400, lineHeight: 18 },
  { id: "t10", name: "label-lg", fontFamily: "Inter", fontSize: 14, fontWeight: 500, lineHeight: 20 },
  { id: "t11", name: "label-sm", fontFamily: "Inter", fontSize: 12, fontWeight: 500, lineHeight: 16 },
  { id: "t12", name: "caption", fontFamily: "Inter", fontSize: 11, fontWeight: 400, lineHeight: 16 },
];

const DEFAULT_SPACING: SpacingToken[] = [
  { id: "sp1", name: "space-1", value: 4 },
  { id: "sp2", name: "space-2", value: 8 },
  { id: "sp3", name: "space-3", value: 12 },
  { id: "sp4", name: "space-4", value: 16 },
  { id: "sp5", name: "space-5", value: 20 },
  { id: "sp6", name: "space-6", value: 24 },
  { id: "sp7", name: "space-8", value: 32 },
  { id: "sp8", name: "space-10", value: 40 },
  { id: "sp9", name: "space-12", value: 48 },
  { id: "sp10", name: "space-16", value: 64 },
  { id: "sp11", name: "space-20", value: 80 },
  { id: "sp12", name: "space-24", value: 96 },
];

const DEFAULT_RADII: RadiusToken[] = [
  { id: "r1", name: "radius-none", value: 0 },
  { id: "r2", name: "radius-sm", value: 2 },
  { id: "r3", name: "radius-md", value: 4 },
  { id: "r4", name: "radius-lg", value: 8 },
  { id: "r5", name: "radius-xl", value: 12 },
  { id: "r6", name: "radius-2xl", value: 16 },
  { id: "r7", name: "radius-full", value: 9999 },
];

export const useDesignSystemStore = create<DesignSystemStore>((set, get) => ({
  colors: DEFAULT_COLORS,
  typography: DEFAULT_TYPOGRAPHY,
  spacing: DEFAULT_SPACING,
  radii: DEFAULT_RADII,
  components: [],

  addColor: (token) =>
    set((s) => ({ colors: [...s.colors, { ...token, id: nanoid(6) }] })),
  updateColor: (id, updates) =>
    set((s) => ({
      colors: s.colors.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),
  deleteColor: (id) =>
    set((s) => ({ colors: s.colors.filter((c) => c.id !== id) })),

  addTypography: (token) =>
    set((s) => ({ typography: [...s.typography, { ...token, id: nanoid(6) }] })),
  updateTypography: (id, updates) =>
    set((s) => ({
      typography: s.typography.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  deleteTypography: (id) =>
    set((s) => ({ typography: s.typography.filter((t) => t.id !== id) })),

  addSpacing: (token) =>
    set((s) => ({ spacing: [...s.spacing, { ...token, id: nanoid(6) }] })),
  updateSpacing: (id, updates) =>
    set((s) => ({
      spacing: s.spacing.map((sp) => (sp.id === id ? { ...sp, ...updates } : sp)),
    })),
  deleteSpacing: (id) =>
    set((s) => ({ spacing: s.spacing.filter((sp) => sp.id !== id) })),

  loadTokens: (data) => {
    set((s) => ({
      colors: data.colors ?? s.colors,
      typography: data.typography ?? s.typography,
      spacing: data.spacing ?? s.spacing,
      radii: data.radii ?? s.radii,
    }));
  },

  exportTokens: () => {
    const { colors, typography, spacing, radii } = get();
    const tokens: Record<string, unknown> = {
      color: {},
      typography: {},
      spacing: {},
      borderRadius: {},
    };

    for (const c of colors) {
      const group = tokens.color as Record<string, Record<string, { value: string }>>;
      if (!group[c.group]) group[c.group] = {};
      group[c.group][c.name] = { value: c.value };
    }

    for (const t of typography) {
      const group = tokens.typography as Record<string, unknown>;
      group[t.name] = {
        fontFamily: { value: t.fontFamily },
        fontSize: { value: `${t.fontSize}px` },
        fontWeight: { value: t.fontWeight },
        lineHeight: { value: `${t.lineHeight}px` },
      };
    }

    for (const sp of spacing) {
      const group = tokens.spacing as Record<string, unknown>;
      group[sp.name] = { value: `${sp.value}px` };
    }

    for (const r of radii) {
      const group = tokens.borderRadius as Record<string, { value: string }>;
      group[r.name] = { value: r.value === 9999 ? "50%" : `${r.value}px` };
    }

    return JSON.stringify(tokens, null, 2);
  },
}));
