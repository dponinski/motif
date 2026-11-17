import { setAt } from "../motif-document";
import { stableStringify } from "../sync/payload";
import { walk, type Flat } from "./flat";
import { canonicalValue, isTokenFile } from "./sync";
import { stringify } from "./write";
import type { DtcgConfig, DtcgFiles } from "./types";

// What a push writes: not the merged files, but the repository's own files with the values that changed put in them, so the diff in the pull
// request is those tokens and not a file reformatted. A token the repository wrote differently (a color without its hex, a `$description`,
// a group of its own) that didn't change is left exactly as it is; one that changed has its `$value` replaced and nothing else touched. (How
// Motif arranges tokens, its `group`, isn't in the repository's files to be changed.)

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const getAt = (node: unknown, path: string[]): unknown => path.reduce((at, key) => (isObject(at) ? at[key] : undefined), node);
const parse = (text: string | undefined): Obj => { try { const j = text === undefined ? {} : JSON.parse(text); return isObject(j) ? j : {}; } catch { return {}; } };
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

// A config says the same when a set with no themes listed (a file written by hand) has the one theme Motif gives it.
function sameConfig(a: Obj, b: Obj): boolean {
  const norm = (c: Obj) => ({
    ...c,
    sets: (Array.isArray(c.sets) ? (c.sets as DtcgConfig["sets"]) : []).map((s) => ({ ...s, themes: s.themes?.length ? s.themes : [{ key: "default", name: "Default" }] })),
  });
  return same(norm(a), norm(b));
}

// The tokens of a tree, one by one (the parts of a composition of your own are tokens too).
function tokensOf(tree: Obj): { path: string[]; node: Obj; group?: Flat }[] {
  const flat: Flat[] = [];
  walk(tree, [], undefined, "", flat);
  return flat.flatMap((f) => (f.children ? f.children.map((c) => ({ path: c.path, node: getAt(tree, c.path) as Obj, group: f })) : [{ path: f.path, node: getAt(tree, f.path) as Obj }]));
}

// The files that have to be written for `planned` (the repository as the pull request will have it) to say what `merged` says: by path, with
// their new text.
export function patchFiles(planned: DtcgFiles, merged: DtcgFiles): DtcgFiles {
  const out: DtcgFiles = {};
  for (const file of Object.keys(merged).filter(isTokenFile)) {
    if (file.endsWith("tokens.config.json")) {
      if (!(file in planned) || !sameConfig(parse(planned[file]), parse(merged[file]))) out[file] = merged[file];
      continue;
    }
    if (!(file in planned)) { out[file] = merged[file]; continue; }
    const raw = parse(planned[file]);
    const want = parse(merged[file]);
    let patched: unknown = raw;
    let changed = false;
    for (const { path, node, group } of tokensOf(want)) {
      const have = getAt(patched, path) as Obj | undefined;
      if (have === undefined) {
        // A token that isn't there: written whole; a part of a composition of your own that is new goes with its group when that is new too.
        const groupPath = group?.path;
        patched = setAt(patched, groupPath && getAt(patched, groupPath) === undefined ? groupPath : path, groupPath && getAt(patched, groupPath) === undefined ? getAt(want, groupPath) : node);
        changed = true;
      } else if (!same(canonicalValue(have.$value), node.$value)) {
        patched = setAt(patched, [...path, "$value"], node.$value);
        changed = true;
      }
    }
    if (changed) out[file] = stringify(patched);
  }
  return out;
}
