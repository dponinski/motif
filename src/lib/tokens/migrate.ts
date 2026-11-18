import {
  emptyTokenData,
  type ColorToken, type ComponentDefinition, type NumberToken, type RadiusToken, type ShadowToken, type SpacingToken, type StringToken, type TokenData, type TokenSet, type TypographyToken,
} from "../../store/design-system";
import { targetKey, targetOf } from "./alias-colors";
import { ALL_THEMES, TOKENS_VERSION, type Composition, type Slot, type StoredTokenData, type Token } from "./model";

// Turning the token store's five lists (colors, typography, spacing, radii, shadows) into the typed model a project keeps (tokens and
// compositions), and back, without losing anything. `migrateTokenData` reads either shape, so a project saved by an earlier version
// opens as it always did.

// ── Lists → typed model ───────────────────────────────────────────────────────

const num = (n: number): string => String(n);

function refsOf(color: ColorToken, colors: ColorToken[]): Record<string, string> | undefined {
  if (!color.themeAlias) return undefined;
  const out: Record<string, string> = {};
  for (const [theme, key] of Object.entries(color.themeAlias)) {
    const target = targetOf(colors, color, key);
    // An alias to a token that isn't there is no alias: the color it came to stays.
    if (target && target.id !== color.id) out[theme] = target.id;
  }
  return Object.keys(out).length ? out : undefined;
}

const colorToken = (c: ColorToken, colors: ColorToken[]): Token => {
  const ref = refsOf(c, colors);
  return {
    id: c.id, name: c.name, setId: c.setId, group: c.group, type: "color", values: { ...c.themeValues }, value: c.value, use: "color",
    ...(ref ? { ref } : {}), ...(c.repoName !== undefined ? { repoName: c.repoName } : {}),
  };
};

const lengthToken = (t: SpacingToken | RadiusToken, use: "spacing" | "radius"): Token => ({
  id: t.id, name: t.name, setId: t.setId, ...(t.group !== undefined ? { group: t.group } : {}), type: "number", unit: "px", use,
  values: { [ALL_THEMES]: num(t.value) }, ...(t.repoName !== undefined ? { repoName: t.repoName } : {}),
});

const numberToken = (t: NumberToken): Token => ({
  id: t.id, name: t.name, setId: t.setId, ...(t.group !== undefined ? { group: t.group } : {}), type: "number", unit: t.unit, ...(t.use !== undefined ? { use: t.use } : {}),
  values: { [ALL_THEMES]: num(t.value), ...Object.fromEntries(Object.entries(t.themeValues ?? {}).map(([theme, v]) => [theme, num(v)])) }, ...(t.repoName !== undefined ? { repoName: t.repoName } : {}),
});

const stringToken = (t: StringToken): Token => ({
  id: t.id, name: t.name, setId: t.setId, ...(t.group !== undefined ? { group: t.group } : {}), type: "string", ...(t.use !== undefined ? { use: t.use } : {}),
  values: { [ALL_THEMES]: t.value, ...(t.themeValues ?? {}) }, ...(t.repoName !== undefined ? { repoName: t.repoName } : {}),
});

// The values a token has in themes of its own (everything but the default for every theme).
const ofThemes = (t: Token): Record<string, string> => Object.fromEntries(Object.entries(t.values).filter(([k]) => k !== ALL_THEMES));

const slot = (name: string, type: Slot["type"], value: string, unit?: Slot["unit"]): Slot => ({ name, type, value, ...(unit !== undefined ? { unit } : {}) });

const typographyComposition = (t: TypographyToken): Composition => ({
  id: t.id, name: t.name, setId: t.setId, ...(t.group !== undefined ? { group: t.group } : {}), kind: "typography",
  slots: [
    slot("font-family", "string", t.fontFamily),
    slot("font-size", "number", num(t.fontSize), "px"),
    slot("font-weight", "number", num(t.fontWeight), ""),
    slot("line-height", "number", num(t.lineHeight), "px"),
    ...(t.letterSpacing !== undefined ? [slot("letter-spacing", "number", num(t.letterSpacing), "px")] : []),
  ],
});

const shadowComposition = (s: ShadowToken): Composition => ({
  id: s.id, name: s.name, setId: s.setId, group: s.group, kind: "shadow",
  slots: [slot("x", "number", num(s.x), "px"), slot("y", "number", num(s.y), "px"), slot("blur", "number", num(s.blur), "px"), slot("spread", "number", num(s.spread), "px"), slot("color", "color", s.color)],
  ...(s.repoName !== undefined ? { repoName: s.repoName } : {}),
  ...(s.inset !== undefined ? { inset: s.inset } : {}),
  ...(s.raw !== undefined ? { raw: s.raw } : {}),
});

export function toStored(data: TokenData): StoredTokenData {
  return {
    tokensVersion: TOKENS_VERSION,
    sets: data.sets,
    tokens: [
      ...data.colors.map((c) => colorToken(c, data.colors)),
      ...data.spacing.map((t) => lengthToken(t, "spacing")),
      ...data.radii.map((t) => lengthToken(t, "radius")),
      ...data.numbers.map(numberToken),
      ...data.strings.map(stringToken),
    ],
    // The compositions made as compositions (their slots can be tokens) are marked, so they come back as such and not as a text style or a shadow.
    compositions: [...data.typography.map(typographyComposition), ...data.shadows.map(shadowComposition), ...data.compositions.map((c) => ({ ...c, own: true }))],
    components: data.components,
  };
}

// ── Typed model → lists ───────────────────────────────────────────────────────

const slotOf = (c: Composition, name: string): Slot | undefined => c.slots.find((s) => s.name === name);
const numberOf = (s: Slot | undefined, fallback = 0): number => { const n = parseFloat(s?.value ?? ""); return Number.isNaN(n) ? fallback : n; };

export function fromStored(data: StoredTokenData): TokenData {
  const colorTokens = data.tokens.filter((t) => t.type === "color");
  const byId = new Map(colorTokens.map((t) => [t.id, t]));

  const colors: ColorToken[] = colorTokens.map((t) => {
    let themeAlias: Record<string, string> | undefined;
    for (const [theme, id] of Object.entries(t.ref ?? {})) {
      const target = byId.get(id);
      if (target && target.id !== t.id) (themeAlias ??= {})[theme] = targetKey(target, t.setId);
    }
    return {
      id: t.id, name: t.name, value: t.value ?? Object.values(t.values)[0] ?? "", group: t.group ?? "base", setId: t.setId, themeValues: { ...t.values },
      ...(themeAlias ? { themeAlias } : {}), ...(t.repoName !== undefined ? { repoName: t.repoName } : {}),
    };
  });

  // A spacing or a radius in pixels is a token of its own kind (the repository's sync reads and writes those); any other number is a number.
  const isLength = (t: Token, use: string) => t.type === "number" && t.use === use && t.unit === "px" && Object.keys(ofThemes(t)).length === 0;
  const lengths = (use: string) => data.tokens.filter((t) => isLength(t, use)).map((t) => ({
    id: t.id, name: t.name, value: parseFloat(t.values[ALL_THEMES] ?? Object.values(t.values)[0] ?? "0") || 0, setId: t.setId,
    ...(t.group !== undefined ? { group: t.group } : {}), ...(t.repoName !== undefined ? { repoName: t.repoName } : {}),
  }));

  // A text style or a shadow of the fixed shape is in its own list; a composition made as one (or of another kind) in the compositions.
  const fixed = (c: Composition) => !c.own && (c.kind === "typography" || c.kind === "shadow");
  const typography: TypographyToken[] = data.compositions.filter((c) => fixed(c) && c.kind === "typography").map((c) => {
    const letter = slotOf(c, "letter-spacing");
    return {
      id: c.id, name: c.name, setId: c.setId, ...(c.group !== undefined ? { group: c.group } : {}),
      fontFamily: slotOf(c, "font-family")?.value ?? "Inter", fontSize: numberOf(slotOf(c, "font-size"), 14), fontWeight: numberOf(slotOf(c, "font-weight"), 400),
      lineHeight: numberOf(slotOf(c, "line-height"), 20), ...(letter ? { letterSpacing: numberOf(letter) } : {}),
    };
  });

  const shadows: ShadowToken[] = data.compositions.filter((c) => fixed(c) && c.kind === "shadow").map((c) => ({
    id: c.id, name: c.name, setId: c.setId, group: c.group ?? "default",
    x: numberOf(slotOf(c, "x")), y: numberOf(slotOf(c, "y")), blur: numberOf(slotOf(c, "blur")), spread: numberOf(slotOf(c, "spread")),
    color: slotOf(c, "color")?.value ?? "#00000000",
    ...(c.repoName !== undefined ? { repoName: c.repoName } : {}), ...(c.inset !== undefined ? { inset: c.inset } : {}), ...(c.raw !== undefined ? { raw: c.raw } : {}),
  }));

  const numberThemes = (t: Token) => { const o = Object.entries(ofThemes(t)).map(([k, v]) => [k, parseFloat(v)] as const).filter(([, v]) => Number.isFinite(v)); return o.length ? { themeValues: Object.fromEntries(o) } : {}; };
  const numbers: NumberToken[] = data.tokens.filter((t) => t.type === "number" && !isLength(t, "spacing") && !isLength(t, "radius")).map((t) => ({
    id: t.id, name: t.name, value: parseFloat(t.values[ALL_THEMES] ?? Object.values(t.values)[0] ?? "0") || 0, unit: t.unit ?? "", setId: t.setId, ...numberThemes(t),
    ...(t.use !== undefined ? { use: t.use } : {}), ...(t.group !== undefined ? { group: t.group } : {}), ...(t.repoName !== undefined ? { repoName: t.repoName } : {}),
  }));
  const strings: StringToken[] = data.tokens.filter((t) => t.type === "string").map((t) => ({
    id: t.id, name: t.name, value: t.values[ALL_THEMES] ?? Object.values(t.values)[0] ?? "", setId: t.setId, ...(Object.keys(ofThemes(t)).length ? { themeValues: ofThemes(t) } : {}),
    ...(t.use !== undefined ? { use: t.use } : {}), ...(t.group !== undefined ? { group: t.group } : {}), ...(t.repoName !== undefined ? { repoName: t.repoName } : {}),
  }));

  const compositions: Composition[] = data.compositions.filter((c) => !fixed(c)).map(({ own: _, ...c }) => c);

  return { sets: data.sets, colors, typography, spacing: lengths("spacing"), radii: lengths("radius"), shadows, numbers, strings, compositions, components: data.components };
}

// ── Whatever a project holds ──────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// The tokens of a project in the typed model, whichever shape they were saved in: the five lists of an earlier version, the typed model
// itself, or nothing usable (which is an empty project's tokens).
export function migrateTokenData(raw: unknown): StoredTokenData {
  const empty = emptyTokenData();
  if (!isObject(raw)) return toStored(empty);
  const sets = list<TokenSet>(raw.sets);
  const components = list<ComponentDefinition>(raw.components);
  if (raw.tokensVersion === TOKENS_VERSION) {
    return { tokensVersion: TOKENS_VERSION, sets: sets.length ? sets : empty.sets, tokens: list<Token>(raw.tokens), compositions: list<Composition>(raw.compositions), components };
  }
  return toStored({
    sets: sets.length ? sets : empty.sets,
    colors: list<ColorToken>(raw.colors),
    typography: list<TypographyToken>(raw.typography),
    spacing: list<SpacingToken>(raw.spacing),
    radii: list<RadiusToken>(raw.radii),
    shadows: list<ShadowToken>(raw.shadows),
    numbers: list<NumberToken>(raw.numbers),
    strings: list<StringToken>(raw.strings),
    compositions: list<Composition>(raw.compositions),
    components,
  });
}

// The same, as the token store holds it.
export const legacyOf = (raw: unknown): TokenData => fromStored(migrateTokenData(raw));

export const emptyStoredTokenData = (): StoredTokenData => toStored(emptyTokenData());
