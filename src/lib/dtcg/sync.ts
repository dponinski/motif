import { mergeJson, setAt } from "../motif-document";
import type { StoredTokenData } from "../tokens/model";
import { colorToCss, isColorValue } from "./color";
import { walk, type Flat } from "./flat";
import { readDtcg, type Read } from "./read";
import { stringify, writeDtcg, type WriteOptions } from "./write";
import type { DtcgFiles } from "./types";

// Syncing design tokens files is a three-way merge of JSON: `base` is the files as of the last sync, `mine` what Motif writes from its tokens
// now, `theirs` what the repository has. Each token is a place in a file, so a token changed on one side is taken, and one changed on both
// is a clash only when the two changes disagree. A token that was deleted in Motif is brought back (a sync never deletes a token from a
// repository: its code may use the variable).

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// The JSON merge treats a list of plain values as a list of things to keep in order, and goes into an object: but a list of fonts, a color
// (its space, components, hex) and a dimension (its value and unit) are each one value, which a change on both sides clashes on as a whole.
const FROZEN = "\u0000json:";
const isDimension = (v: Obj) => "value" in v && "unit" in v && Object.keys(v).length === 2;
function freeze(v: unknown): unknown {
  if (Array.isArray(v) || (isObject(v) && (isColorValue(v) || isDimension(v)))) return `${FROZEN}${JSON.stringify(v)}`;
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, freeze(x)]));
  return v;
}
function thaw(v: unknown): unknown {
  if (typeof v === "string" && v.startsWith(FROZEN)) return JSON.parse(v.slice(FROZEN.length));
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, thaw(x)]));
  return v;
}

function parse(files: DtcgFiles, file: string): Obj {
  const text = files[file];
  if (text === undefined) return {};
  try { const json = JSON.parse(text); return isObject(json) ? json : {}; } catch { return {}; }
}

const getAt = (node: unknown, path: string[]): unknown => path.reduce((at, key) => (isObject(at) ? at[key] : undefined), node);

// The places in a tree that are a token (or a composition of your own, which is one thing).
function tokenPaths(tree: Obj): string[][] {
  const out: Flat[] = [];
  walk(tree, [], undefined, "", out);
  return out.map((f) => f.path);
}

export interface DtcgConflict {
  file: string;
  path: string[];
  // The token, and the theme the file is of (null for the base).
  name: string;
  theme: string | null;
  label: string;
  mine: string;
  theirs: string;
  theirsValue: unknown;
}

export interface DtcgMerge {
  // The merged files, with every clash taken as Motif's side.
  files: DtcgFiles;
  trees: Record<string, unknown>;
  conflicts: DtcgConflict[];
  // Tokens deleted in Motif that are kept, because a sync never deletes a token from a repository.
  restored: string[];
}

export const isTokenFile = (file: string) => file.endsWith(".json");

// The theme a file is of: `primitives.dark.json` is `dark`; a base file has none.
export const themeOfFile = (file: string): string | null => {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return name === "tokens.config.json" ? null : name.slice(0, -5).split(".")[1] ?? null;
};

function summary(value: unknown): string {
  if (value === undefined) return "Removed";
  if (typeof value === "string") return value;
  if (isObject(value)) {
    if (isColorValue(value)) return colorToCss(value) ?? JSON.stringify(value);
    if ("value" in value && "unit" in value && Object.keys(value).length === 2) return `${value.value}${value.unit}`;
  }
  return JSON.stringify(value);
}

// The token a path in a file is in: the path up to the part with its value.
function nameOf(path: string[]): string {
  const at = path.findIndex((p) => p.startsWith("$"));
  return (at === -1 ? path : path.slice(0, at)).join(".");
}

export function mergeDtcg(base: DtcgFiles, mine: DtcgFiles, theirs: DtcgFiles): DtcgMerge {
  const trees: Record<string, unknown> = {};
  const conflicts: DtcgConflict[] = [];
  const restored: string[] = [];
  const names = [...new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])].filter(isTokenFile).sort();

  for (const file of names) {
    const [b, t] = [parse(base, file), parse(theirs, file)];
    let m = parse(mine, file);
    // Deleted in Motif, still in the repository: kept.
    if (file in base && !(file in mine) && file in theirs) m = t;
    else {
      const have = new Set(tokenPaths(m).map((p) => p.join(".")));
      const was = new Set(tokenPaths(b).map((p) => p.join(".")));
      for (const path of tokenPaths(t)) {
        const key = path.join(".");
        if (was.has(key) && !have.has(key)) { m = setAt(m, path, getAt(t, path)) as Obj; restored.push(key); }
      }
    }
    const { merged, conflicts: clashes } = mergeJson(freeze(b), freeze(m), freeze(t));
    trees[file] = thaw(merged);
    for (const c of clashes) {
      const name = nameOf(c.path);
      const theme = themeOfFile(file);
      conflicts.push({ file, path: c.path.map(String), name, theme, label: theme ? `${name} · ${theme}` : name, mine: summary(thaw(c.mine)), theirs: summary(thaw(c.theirs)), theirsValue: thaw(c.theirs) });
    }
  }

  return { files: filesOf(trees, [base, mine, theirs]), trees, conflicts, restored: [...new Set(restored)] };
}

// The files for the trees: a file that came out empty is left out unless some side had it.
function filesOf(trees: Record<string, unknown>, sides: DtcgFiles[]): DtcgFiles {
  const out: DtcgFiles = {};
  for (const [file, tree] of Object.entries(trees)) {
    if (isObject(tree) && Object.keys(tree).length === 0 && !sides.some((s) => file in s)) continue;
    out[file] = stringify(tree);
  }
  return out;
}

// The files after the person chose the repository's side for some of the clashes (their indexes).
export function resolveDtcg(merge: DtcgMerge, takeTheirs: number[]): DtcgFiles {
  const trees = { ...merge.trees };
  for (const i of takeTheirs) {
    const c = merge.conflicts[i];
    trees[c.file] = setAt(trees[c.file], c.path, c.theirsValue);
  }
  return filesOf(trees, [merge.files]);
}

// ── What changed ───────────────────────────────────────────────────────────

export interface DtcgChange {
  name: string;
  theme: string | null;
  type: "added" | "changed" | "removed";
  before?: string;
  after?: string;
}

// The token values in a set of files, by token and theme.
function valuesOf(files: DtcgFiles): Map<string, { name: string; theme: string | null; text: string }> {
  const out = new Map<string, { name: string; theme: string | null; text: string }>();
  for (const file of Object.keys(files).filter(isTokenFile)) {
    if (file.endsWith("tokens.config.json")) continue;
    const flat: Flat[] = [];
    walk(parse(files, file), [], undefined, file, flat);
    const theme = themeOfFile(file);
    for (const f of flat) {
      const name = f.path.join(".");
      const kids = f.children ?? [f];
      for (const k of kids) out.set(`${theme ?? ""}\0${k.path.join(".")}`, { name: k.path.join("."), theme, text: JSON.stringify(thaw(freeze(k.value))) });
      if (f.children && f.children.length === 0) out.set(`${theme ?? ""}\0${name}`, { name, theme, text: "{}" });
    }
  }
  return out;
}

// What changing `from` into `to` does to the tokens (the config file isn't a token).
export function describeDtcgChanges(from: DtcgFiles, to: DtcgFiles): DtcgChange[] {
  const [a, b] = [valuesOf(from), valuesOf(to)];
  const out: DtcgChange[] = [];
  for (const [key, was] of a) {
    const now = b.get(key);
    if (!now) out.push({ name: was.name, theme: was.theme, type: "removed", before: show(was.text) });
    else if (now.text !== was.text) out.push({ name: was.name, theme: was.theme, type: "changed", before: show(was.text), after: show(now.text) });
  }
  for (const [key, now] of b) if (!a.has(key)) out.push({ name: now.name, theme: now.theme, type: "added", after: show(now.text) });
  return out;
}

function show(text: string): string {
  try { return summary(JSON.parse(text)); } catch { return text; }
}

// ── The sync ───────────────────────────────────────────────────────────────

// The connection between Motif's tokens and a repository whose tokens are design tokens files: every set, in the files the config describes.
export interface DtcgLink {
  repo: string;
  branch: string;
  // Where the files are and how they are laid out (also in tokens.config.json).
  dir: string;
  files: "single" | "per-set";
  output: string;
  tailwind: boolean;
  // The files as of the last sync: the common ancestor for the next merge.
  base: DtcgFiles;
  syncedAt: number;
}

export const writeOptionsOf = (link: Pick<DtcgLink, "dir" | "files" | "output" | "tailwind">): WriteOptions => ({ dir: link.dir, files: link.files, output: link.output, tailwind: link.tailwind });

export interface DtcgPlan {
  merge: DtcgMerge;
  // What taking the repository's changes does to Motif, and what a pull request would change in the repository.
  toMotif: DtcgChange[];
  toRepo: DtcgChange[];
}

export function planDtcgSync(link: DtcgLink, model: StoredTokenData, theirs: DtcgFiles): DtcgPlan {
  const mine = writeDtcg(model, writeOptionsOf(link)).files;
  const merge = mergeDtcg(link.base, mine, theirs);
  return { merge, toMotif: describeDtcgChanges(mine, merge.files), toRepo: describeDtcgChanges(theirs, merge.files) };
}

// Motif's tokens after taking the merged files in.
export const takeDtcg = (files: DtcgFiles, model: StoredTokenData): Read => readDtcg(files, model);
