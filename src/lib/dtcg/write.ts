import type { Composition, Slot, StoredTokenData, Token, TokenType } from "../tokens/model";
import { ALL_THEMES } from "../tokens/model";
import { cssToColor } from "./color";
import { COMPOSITION_NAMESPACE, leafOf, namespaceOf, pathOf, placeOf, refOf, slug, themeKey } from "./names";
import { EXT, type DtcgConfig, type DtcgFiles, type Skipped } from "./types";

// Motif's tokens as design tokens (DTCG 2025.10) files: the base values of each set in a file (all the sets in one, or a file each), and the
// values of every other theme in a file of their own that holds only what is different. A token that is another token is a reference
// (`{color.gray-50}`), in whichever set that is.

export interface WriteOptions {
  files?: "single" | "per-set";
  dir?: string;
  output?: string;
  tailwind?: boolean;
}

export interface Written {
  files: DtcgFiles;
  config: DtcgConfig;
  skipped: Skipped[];
}

type Obj = Record<string, unknown>;

export const TYPOGRAPHY_PROPS: Record<string, string> = { "font-family": "fontFamily", "font-size": "fontSize", "font-weight": "fontWeight", "line-height": "lineHeight", "letter-spacing": "letterSpacing" };
export const SHADOW_PROPS: Record<string, string> = { x: "offsetX", y: "offsetY", blur: "blur", spread: "spread", color: "color" };

const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function put(tree: Obj, path: string[], node: Obj) {
  let at = tree;
  for (const part of path.slice(0, -1)) at = (at[part] = isObject(at[part]) ? at[part] : {}) as Obj;
  at[path[path.length - 1]] = node;
}

const round = (n: number) => parseFloat(n.toFixed(4));

// A number with its unit: a length in px or rem is a dimension; a bare number is a number; any other unit is kept in the text.
export function numberValue(n: number, unit: string): unknown {
  if (unit === "px" || unit === "rem") return { value: round(n), unit };
  return unit === "" ? round(n) : `${round(n)}${unit}`;
}

// JSON with two-space indentation, but an array of plain values on one line (a color's components).
export const stringify = (value: unknown): string =>
  `${JSON.stringify(value, null, 2).replace(/\[\n\s+([^[\]{}]*?)\n\s*\]/g, (_, inner: string) => `[${inner.replace(/\n\s+/g, " ")}]`)}\n`;

const extension = (e: Obj): Obj => (Object.keys(e).length ? { $extensions: { [EXT]: e } } : {});

// Unique keys for a list of names.
function uniqueKeys(keys: string[]): string[] {
  const used = new Set<string>();
  return keys.map((base) => {
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
    used.add(key);
    return key;
  });
}

export function writeDtcg(data: StoredTokenData, options: WriteOptions = {}): Written {
  const mode = options.files ?? "single";
  const dir = (options.dir ?? "src/tokens").replace(/\/+$/, "");
  const skipped: Skipped[] = [];

  // A set and a theme keep the key the repository's config gave them.
  const setKeys = uniqueKeys(data.sets.map((s) => s.repoKey ?? slug(s.name)));
  const keyOfSet = new Map(data.sets.map((s, i) => [s.id, setKeys[i]]));
  const themesOfSet = new Map(data.sets.map((s) => {
    const keys = uniqueKeys(s.themes.map((t) => t.repoKey ?? themeKey(t.name)));
    return [s.id, s.themes.map((t, i) => ({ id: t.id, name: t.name, key: keys[i] }))] as const;
  }));
  const baseOf = (setId: string) => themesOfSet.get(setId)?.[0];

  // Which token is where: a path can only be one token, so a later token that reuses it is left out.
  const pathById = new Map<string, string[]>();
  const taken = new Set<string>();
  const claim = (id: string, name: string, path: string[]): boolean => {
    const key = path.join(".");
    if (taken.has(key)) { skipped.push({ name, reason: `Another token is already ${key}` }); return false; }
    taken.add(key);
    pathById.set(id, path);
    return true;
  };

  const trees = new Map<string, Obj>();
  const treeFor = (file: string) => trees.get(file) ?? (trees.set(file, {}), trees.get(file)!);
  const baseFile = (setId: string) => (mode === "single" ? `${dir}/tokens.json` : `${dir}/${keyOfSet.get(setId)}.json`);
  const themeFile = (setId: string, key: string) => (mode === "single" ? `${dir}/tokens.${key}.json` : `${dir}/${keyOfSet.get(setId)}.${key}.json`);

  const common = (setId: string, group: string | undefined, extra: Obj = {}): Obj => ({
    ...(mode === "single" ? { set: keyOfSet.get(setId) } : {}),
    ...(group ? { group } : {}),
    ...extra,
  });

  // ── Tokens ─────────────────────────────────────────────────────────────────
  // Pass one: where each token goes (so a reference can name any of them).
  const placed: { token: Token; path: string[] }[] = [];
  for (const t of data.tokens) {
    if (t.type === "color" && Object.keys(t.values).length === 0) continue;
    const path = placeOf(t.repoName) ?? pathOf(t.type, t.use, t.name);
    if (t.type === "color" && !Object.entries(t.values).every(([, v]) => cssToColor(v) !== null) && !t.ref) { skipped.push({ name: t.name, reason: "Its color isn't one Motif can write as a design token" }); continue; }
    if (claim(t.id, t.name, path)) placed.push({ token: t, path });
  }

  const colorOf = (t: Token, themeId: string): unknown | undefined => {
    const target = t.ref?.[themeId];
    const to = target ? pathById.get(target) : undefined;
    if (to) return refOf(to);
    const css = t.values[themeId] ?? t.value;
    return css === undefined ? undefined : cssToColor(css) ?? undefined;
  };
  const signature = (t: Token, themeId: string) => (t.ref?.[themeId] && pathById.has(t.ref[themeId]) ? `ref:${t.ref[themeId]}` : `v:${t.values[themeId] ?? t.value ?? ""}`);

  for (const { token: t, path } of placed) {
    const ns = namespaceOf(t.type, t.use);
    // The name is written when the path doesn't say it (the namespace took a prefix off, or the slug changed it).
    const ext = common(t.setId, t.group, {
      ...(t.name !== path[path.length - 1] && !placeOf(t.repoName) ? { name: t.name } : {}),
      ...(t.repoName !== undefined && !placeOf(t.repoName) ? { repoName: t.repoName } : {}),
      ...(ns === "" && t.use ? { use: t.use } : {}),
    });

    if (t.type === "color") {
      const base = baseOf(t.setId);
      if (!base) continue;
      const value = colorOf(t, base.id);
      if (value === undefined) { skipped.push({ name: t.name, reason: "It has no color" }); continue; }
      put(treeFor(baseFile(t.setId)), path, { $type: "color", $value: value, ...extension(ext) });
      for (const theme of (themesOfSet.get(t.setId) ?? []).slice(1)) {
        if (signature(t, theme.id) === signature(t, base.id)) continue;
        const v = colorOf(t, theme.id);
        if (v !== undefined) put(treeFor(themeFile(t.setId, theme.key)), path, { $value: v });
      }
      continue;
    }

    const text = t.values[ALL_THEMES] ?? Object.values(t.values)[0] ?? "";
    if (t.type === "number") {
      const n = parseFloat(text);
      if (!Number.isFinite(n)) { skipped.push({ name: t.name, reason: "It isn't a number" }); continue; }
      const unit = t.unit ?? "";
      const type = unit === "" ? (t.use === "font-weight" ? "fontWeight" : "number") : "dimension";
      put(treeFor(baseFile(t.setId)), path, { $type: type, $value: numberValue(n, unit), ...extension(ext) });
    } else {
      put(treeFor(baseFile(t.setId)), path, { $type: t.use === "font-family" ? "fontFamily" : "string", $value: text, ...extension(ext) });
    }
  }

  // ── Compositions ───────────────────────────────────────────────────────────
  const literal = (slot: Slot): unknown | undefined => {
    const v = slot.value;
    if (v === undefined || v === "") return undefined;
    if (slot.type === "color") return cssToColor(v) ?? undefined;
    if (slot.type === "number") { const n = parseFloat(v); return Number.isFinite(n) ? numberValue(n, slot.unit ?? "") : undefined; }
    return v;
  };
  const slotValue = (slot: Slot): unknown | undefined => {
    const to = slot.ref ? pathById.get(slot.ref) : undefined;
    return to ? refOf(to) : literal(slot);
  };
  const typeOf = (type: TokenType, slot: Slot): string => (type === "color" ? "color" : type === "number" ? ((slot.unit ?? "") === "" ? "number" : "dimension") : "string");

  const compositionNode = (c: Composition): { path: string[]; node: Obj } | null => {
    const ns = COMPOSITION_NAMESPACE[c.kind];
    if (c.kind === "custom") {
      const path = [ns, slug(c.name)];
      const children: Obj = {};
      for (const slot of c.slots) {
        const value = slotValue(slot);
        if (value === undefined) continue;
        children[slug(slot.name)] = { $type: typeOf(slot.type, slot), $value: value, ...(slug(slot.name) !== slot.name ? extension({ slot: slot.name }) : {}) };
      }
      return { path, node: { ...children, ...extension(common(c.setId, c.group, { composition: "custom", ...(slug(c.name) !== c.name ? { name: c.name } : {}), ...(c.repoName !== undefined ? { repoName: c.repoName } : {}) })) } };
    }
    const path = [ns, leafOf(c.name, ns)];
    const props = c.kind === "typography" ? TYPOGRAPHY_PROPS : SHADOW_PROPS;
    const value: Obj = {};
    const extra: Slot[] = [];
    for (const slot of c.slots) {
      const prop = props[slot.name];
      if (!prop) { extra.push(slot); continue; }
      const v = slotValue(slot);
      if (v !== undefined) value[prop] = v;
    }
    if (c.kind === "shadow" && c.inset) value.inset = true;
    return {
      path,
      node: {
        $type: c.kind,
        $value: value,
        ...extension(common(c.setId, c.group, {
          ...(path[1] !== c.name ? { name: c.name } : {}),
          ...(c.repoName !== undefined ? { repoName: c.repoName } : {}),
          ...(c.raw !== undefined ? { raw: c.raw } : {}),
          ...(extra.length ? { extra } : {}),
        })),
      },
    };
  };

  for (const c of data.compositions) {
    const made = compositionNode(c);
    if (!made) continue;
    if (!claim(c.id, c.name, made.path)) continue;
    put(treeFor(baseFile(c.setId)), made.path, made.node);
  }

  // ── Files and config ───────────────────────────────────────────────────────
  const config: DtcgConfig = {
    files: mode,
    output: options.output ?? "src/styles/tokens.css",
    tailwind: options.tailwind ?? true,
    selectors: {},
    sets: data.sets.map((s, i) => ({
      name: s.name,
      key: setKeys[i],
      ...(s.description ? { description: s.description } : {}),
      themes: (themesOfSet.get(s.id) ?? []).map((t) => ({ key: t.key, name: t.name })),
    })),
  };
  for (const s of config.sets) for (const t of s.themes.slice(1)) config.selectors[t.key] ??= `.${t.key}`;

  const files: DtcgFiles = {};
  // Every base file is there, even when a set has no tokens yet (the config says it exists).
  if (mode === "single") treeFor(`${dir}/tokens.json`);
  else for (const key of setKeys) treeFor(`${dir}/${key}.json`);
  for (const [file, tree] of [...trees].sort(([a], [b]) => a.localeCompare(b))) files[file] = stringify(tree);
  files[`${dir}/tokens.config.json`] = stringify(config);
  return { files, config, skipped };
}
