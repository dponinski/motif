import { nanoid } from "nanoid";
import type { TokenSet } from "../../store/design-system";
import { refreshAliases } from "../tokens/alias-colors";
import { fromStored, toStored } from "../tokens/migrate";
import { ALL_THEMES, TOKENS_VERSION, type Composition, type Slot, type StoredTokenData, type Token, type TokenType, type Unit } from "../tokens/model";
import { isUnit } from "../tokens/uses";
import { colorToCss, isColorValue } from "./color";
import { COMPOSITION_NAMESPACE, leafOf, pathOf, pathOfRef, purposeOfNamespace, repoNameOfPlace, slug, themeKey } from "./names";
import { walk, type Flat } from "./flat";
import type { DtcgConfig, DtcgFiles } from "./types";
import { SHADOW_PROPS, TYPOGRAPHY_PROPS } from "./write";

// Design tokens files back into Motif's tokens: the inverse of `writeDtcg`, and what reads a repository's own files. A reference is followed
// into whichever file (and set) its token is in. `existing` keeps the ids of tokens that are already there (found by set and path), so a
// token that is read again is the same token.

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const keyOf = (path: string[]) => path.join(".");
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A dimension, a number or a length as text, as a number and its unit.
function numberOf(value: unknown): { n: number; unit: Unit } | null {
  if (typeof value === "number") return Number.isFinite(value) ? { n: value, unit: "" } : null;
  if (isObject(value) && typeof value.value === "number" && typeof value.unit === "string") return isUnit(value.unit) ? { n: value.value, unit: value.unit } : null;
  if (typeof value === "string") {
    const m = /^(-?[\d.]+)(px|rem|em|%)?$/.exec(value.trim());
    return m ? { n: parseFloat(m[1]), unit: (m[2] ?? "") as Unit } : null;
  }
  return null;
}

const textOf = (value: unknown): string | null => (typeof value === "string" ? value : Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]).join(", ") : null);

export interface Read {
  data: StoredTokenData;
  notes: string[];
}

export function readDtcg(files: DtcgFiles, existing?: StoredTokenData): Read {
  const notes: string[] = [];
  const parsed: { file: string; stem: string; theme: string | null; tree: Obj }[] = [];
  let config: DtcgConfig | null = null;

  for (const [file, text] of Object.entries(files)) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    if (!name.endsWith(".json")) continue;
    let json: unknown;
    try { json = JSON.parse(text); } catch { notes.push(`${file} isn't valid JSON`); continue; }
    if (!isObject(json)) { notes.push(`${file} isn't an object`); continue; }
    if (name === "tokens.config.json") { config = json as unknown as DtcgConfig; continue; }
    const [stem, theme] = name.slice(0, -5).split(".");
    parsed.push({ file, stem, theme: theme ?? null, tree: json });
  }

  const mode = config?.files ?? (parsed.some((p) => p.stem !== "tokens") ? "per-set" : "single");

  // ── Sets and themes ────────────────────────────────────────────────────────
  type ConfigSet = DtcgConfig["sets"][number];
  const configSets: ConfigSet[] = config?.sets?.length
    ? config.sets
    : mode === "per-set"
      ? [...new Set(parsed.map((p) => p.stem))].map((stem) => ({ name: titleCase(stem), key: stem, themes: [] }))
      : [{ name: "Tokens", key: "tokens", themes: [] }];
  // Themes that only the files say (no config): the override files' names.
  for (const s of configSets) {
    if (s.themes.length) continue;
    const keys = [...new Set(parsed.filter((p) => p.theme && (mode === "single" || p.stem === s.key)).map((p) => p.theme as string))];
    s.themes = [{ key: "default", name: "Default" }, ...keys.map((k) => ({ key: k, name: titleCase(k) }))];
  }

  const oldSet = (name: string) => existing?.sets.find((s) => s.name.toLowerCase() === name.toLowerCase());
  const sets: TokenSet[] = configSets.map((cs) => {
    const old = oldSet(cs.name);
    const themes = cs.themes.map((t) => ({ id: old?.themes.find((x) => x.name.toLowerCase() === t.name.toLowerCase())?.id ?? `theme-${nanoid(6)}`, name: t.name, ...(t.key !== themeKey(t.name) ? { repoKey: t.key } : {}) }));
    const active = old && themes.some((t) => t.id === old.activeThemeId) ? old.activeThemeId : themes[0].id;
    return { id: old?.id ?? `set-${nanoid(6)}`, name: cs.name, ...(cs.key !== slug(cs.name) ? { repoKey: cs.key } : {}), themes, activeThemeId: active, ...(cs.description ? { description: cs.description } : {}) };
  });
  const setByKey = new Map(configSets.map((cs, i) => [cs.key, { cs, set: sets[i] }]));

  // ── What is in the files ───────────────────────────────────────────────────
  const base: Flat[] = [];
  const overrides = new Map<string, Flat>(); // `${theme}\0${path}`
  for (const p of parsed) {
    const out: Flat[] = [];
    walk(p.tree, [], undefined, p.file, out);
    if (!p.theme) { base.push(...out.map((f) => ({ ...f, ext: { ...f.ext, ...(mode === "per-set" && !f.ext.set ? { set: p.stem } : {}) } }))); continue; }
    for (const f of out) overrides.set(`${p.theme}\0${keyOf(f.path)}`, f);
  }

  const first = configSets[0].key;
  const setOf = (f: Flat) => setByKey.get(typeof f.ext.set === "string" ? f.ext.set : first) ?? setByKey.get(first)!;

  // Ids: an existing token (same set and path) stays itself.
  const known = new Map<string, string>();
  if (existing) {
    const setName = new Map(existing.sets.map((s) => [s.id, s.name.toLowerCase()]));
    for (const t of existing.tokens) known.set(`${setName.get(t.setId)}\0${pathOf(t.type, t.use, t.name).join(".")}`, t.id);
    for (const c of existing.compositions) known.set(`${setName.get(c.setId)}\0${[COMPOSITION_NAMESPACE[c.kind], leafOf(c.name, COMPOSITION_NAMESPACE[c.kind])].join(".")}`, c.id);
  }
  const idFor = (setName: string, path: string[]) => known.get(`${setName.toLowerCase()}\0${keyOf(path)}`) ?? nanoid(6);

  // Every token by path (so a reference finds it).
  const byPath = new Map<string, Flat>();
  for (const f of base) if (!f.children && f.type !== "typography" && f.type !== "shadow") byPath.set(keyOf(f.path), f);
  const idByPath = new Map<string, string>();
  for (const f of byPath.values()) idByPath.set(keyOf(f.path), idFor(setOf(f).set.name, f.path));

  // A value that is a reference, followed to a literal (for the tokens that Motif can't keep as references).
  const literalOf = (value: unknown, depth = 0): unknown => {
    const ref = typeof value === "string" ? pathOfRef(value) : null;
    if (!ref) return value;
    const target = byPath.get(keyOf(ref));
    return target && depth < 8 ? literalOf(target.value, depth + 1) : undefined;
  };

  const tokens: Token[] = [];
  const compositions: Composition[] = [];

  const nameOf = (f: Flat) => (typeof f.ext.name === "string" ? f.ext.name : f.path.length > 1 ? f.path.slice(1).join("-") : f.path[0]);

  // ── Tokens ─────────────────────────────────────────────────────────────────
  for (const f of byPath.values()) {
    const { set, cs } = setOf(f);
    const id = idByPath.get(keyOf(f.path))!;
    const name = nameOf(f);
    const group = typeof f.ext.group === "string" ? f.ext.group : undefined;
    const nsUse = f.path.length > 1 ? purposeOfNamespace(f.path[0]) : undefined;
    const use = typeof f.ext.use === "string" ? f.ext.use : nsUse;
    // Somewhere in the files other than where Motif puts a token of this name: remembered, so a push writes it back there.
    const kind: TokenType = f.type === "color" ? "color" : f.type === "fontFamily" || f.type === "string" ? "string" : "number";
    const place = keyOf(pathOf(kind, use, name)) !== keyOf(f.path) ? repoNameOfPlace(f.path) : undefined;
    const repoName = place ?? (typeof f.ext.repoName === "string" ? f.ext.repoName : undefined);
    const where = { id, name, setId: set.id, ...(group ? { group } : {}), ...(repoName !== undefined ? { repoName } : {}) };

    if (f.type === "color") {
      const values: Record<string, string> = {};
      const ref: Record<string, string> = {};
      const pick = (themeKey: string | null, theme: { id: string }) => {
        const node = themeKey ? overrides.get(`${themeKey}\0${keyOf(f.path)}`) ?? f : f;
        const v = node.value;
        const target = typeof v === "string" ? pathOfRef(v) : null;
        if (target) {
          const to = idByPath.get(keyOf(target));
          if (to && byPath.get(keyOf(target))?.type === "color") { ref[theme.id] = to; values[theme.id] = ""; return; }
          notes.push(`${name}: it refers to ${keyOf(target)}, which isn't a color`);
          return;
        }
        const css = isColorValue(v) ? colorToCss(v) : null;
        if (css === null) { notes.push(`${name}: a color Motif can't read`); return; }
        values[theme.id] = css;
      };
      cs.themes.forEach((t, i) => pick(i === 0 ? null : t.key, set.themes[i]));
      if (Object.keys(values).length === 0) continue;
      tokens.push({ ...where, type: "color", values, value: values[set.activeThemeId] || Object.values(values)[0], use: "color", ...(Object.keys(ref).length ? { ref } : {}) });
      continue;
    }

    const literal = literalOf(f.value);
    if (f.type === "dimension" || f.type === "number" || f.type === "fontWeight") {
      const n = numberOf(literal);
      if (!n) { notes.push(`${name}: not a number or a dimension`); continue; }
      tokens.push({ ...where, type: "number", unit: n.unit, ...(use ? { use } : {}), values: { [ALL_THEMES]: String(n.n) } });
    } else if (f.type === "fontFamily" || f.type === "string") {
      const text = textOf(literal);
      if (text === null) { notes.push(`${name}: not text`); continue; }
      tokens.push({ ...where, type: "string", ...(use ? { use } : f.type === "fontFamily" ? { use: "font-family" } : {}), values: { [ALL_THEMES]: text } });
    } else {
      notes.push(`${name}: a ${f.type ?? "token without a type"}, which Motif doesn't keep yet`);
    }
  }

  // ── Compositions ───────────────────────────────────────────────────────────
  const slotOf = (name: string, type: TokenType, value: unknown): Slot | null => {
    const ref = typeof value === "string" ? pathOfRef(value) : null;
    if (ref) {
      const to = idByPath.get(keyOf(ref));
      if (!to) { notes.push(`The part ${name} refers to ${keyOf(ref)}, which isn't a token`); return null; }
      return { name, type, ref: to };
    }
    if (type === "color") { const css = isColorValue(value) ? colorToCss(value) : null; return css === null ? null : { name, type, value: css }; }
    if (type === "number") { const n = numberOf(value); return n ? { name, type, value: String(n.n), unit: n.unit } : null; }
    const text = textOf(value);
    return text === null ? null : { name, type, value: text };
  };
  const SLOT_TYPE: Record<string, TokenType> = { "font-family": "string", "font-size": "number", "font-weight": "number", "line-height": "number", "letter-spacing": "number", x: "number", y: "number", blur: "number", spread: "number", color: "color" };

  for (const f of base) {
    const { set } = setOf(f);
    const group = typeof f.ext.group === "string" ? f.ext.group : undefined;
    const repoName = typeof f.ext.repoName === "string" ? f.ext.repoName : undefined;
    const head = { name: nameOf(f), setId: set.id, ...(group ? { group } : {}), ...(repoName !== undefined ? { repoName } : {}) };

    if (f.children) {
      const slots: Slot[] = [];
      for (const child of f.children) {
        const slotName = typeof child.ext.slot === "string" ? child.ext.slot : child.path[child.path.length - 1];
        const type: TokenType = child.type === "color" ? "color" : child.type === "dimension" || child.type === "number" ? "number" : "string";
        const slot = slotOf(slotName, type, child.value);
        if (slot) slots.push(slot);
      }
      compositions.push({ id: idFor(set.name, f.path), ...head, kind: "custom", slots });
    } else if ((f.type === "typography" || f.type === "shadow") && isObject(f.value)) {
      const props = f.type === "typography" ? TYPOGRAPHY_PROPS : SHADOW_PROPS;
      const slots: Slot[] = [];
      for (const [slotName, prop] of Object.entries(props)) {
        if (!(prop in f.value)) continue;
        const slot = slotOf(slotName, SLOT_TYPE[slotName], f.value[prop]);
        if (slot) slots.push(slot);
      }
      if (Array.isArray(f.ext.extra)) slots.push(...(f.ext.extra as Slot[]));
      compositions.push({
        id: idFor(set.name, f.path), ...head, kind: f.type, slots,
        ...(f.type === "shadow" && f.value.inset === true ? { inset: true } : {}),
        ...(typeof f.ext.raw === "string" ? { raw: f.ext.raw } : {}),
      });
    }
  }

  const stored: StoredTokenData = {
    tokensVersion: TOKENS_VERSION,
    sets,
    tokens,
    compositions: compositions.map((c) => ({ ...c, own: true })),
    components: existing?.components ?? [],
  };
  // The colors that are other colors have the color they come to.
  const legacy = fromStored(stored);
  legacy.colors = refreshAliases(legacy.colors, legacy.sets);
  return { data: toStored(legacy), notes };
}
