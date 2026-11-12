import type { CanvasElement, ComponentGroup, VariantProp } from "../store/canvas";

export interface DocumentComponent {
  id: string;
  name: string;
  groupId: string | null;
  variantProps: VariantProp[];
  elements: Record<string, CanvasElement>;
  order: string[];
}

export type TokenKind = "colors" | "typography" | "spacing" | "radii" | "shadows";

// A component of the connected repository, by where it is declared and what it is called.
export interface RepoRef {
  file: string;
  name: string;
}

export type DocBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "preview"; componentId: string }
  | { id: string; type: "props"; componentId: string }
  | { id: string; type: "code"; componentId: string }
  // The repository's own component, running as it does in the repository. `view` shows one, or every variant.
  | { id: string; type: "repo-preview"; ref: RepoRef; view: "single" | "variants" }
  | { id: string; type: "repo-props"; ref: RepoRef }
  | { id: string; type: "repo-code"; ref: RepoRef }
  | { id: string; type: "tokens"; kind: TokenKind }
  | { id: string; type: "guideline"; do: string; dont: string };

export interface DocPage {
  id: string;
  title: string;
  blocks: DocBlock[];
}

export interface DocumentContent {
  componentGroups: ComponentGroup[];
  components: DocumentComponent[];
  docs: DocPage[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const isKeyedList = (v: unknown): v is (Obj & { id: string })[] =>
  Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === "string");

const isPrimitiveList = (v: unknown): v is unknown[] =>
  Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null);

// ── Three-way merge ───────────────────────────────────────────────────────────

export interface JsonConflict {
  path: string[];
  mine: unknown;
  theirs: unknown;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!equal(a[k], b[k])) return false;
    return true;
  }
  return false;
}

// Their order wins; my removals are dropped and my additions slotted in after their nearest neighbour.
function mergeOrder(base: unknown[], mine: unknown[], theirs: unknown[]): unknown[] {
  const inBase = new Set(base);
  const inMine = new Set(mine);
  const out = theirs.filter((id) => !(inBase.has(id) && !inMine.has(id)));
  mine.forEach((id, i) => {
    if (inBase.has(id) || out.includes(id)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at === -1; j--) at = out.indexOf(mine[j]);
    out.splice(at + 1, 0, id);
  });
  return out;
}

function merge3(base: unknown, mine: unknown, theirs: unknown, path: string[], conflicts: JsonConflict[]): unknown {
  if (equal(mine, theirs)) return mine;
  if (equal(base, mine)) return theirs;
  if (equal(base, theirs)) return mine;

  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out: Obj = {};
    for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge3(b[key], mine[key], theirs[key], [...path, key], conflicts);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  if (isKeyedList(mine) && isKeyedList(theirs)) {
    const b = isKeyedList(base) ? base : [];
    const byId = (list: (Obj & { id: string })[]) => new Map(list.map((x) => [x.id, x]));
    const [bm, mm, tm] = [byId(b), byId(mine), byId(theirs)];
    const kept = new Map<string, unknown>();
    for (const id of new Set([...mm.keys(), ...tm.keys()])) {
      const v = merge3(bm.get(id), mm.get(id), tm.get(id), [...path, id], conflicts);
      if (v !== undefined) kept.set(id, v);
    }
    const ids = mergeOrder([...bm.keys()], [...mm.keys()], [...tm.keys()]) as string[];
    for (const id of kept.keys()) if (!ids.includes(id)) ids.push(id);
    return ids.filter((id) => kept.has(id)).map((id) => kept.get(id));
  }

  if (isPrimitiveList(mine) && isPrimitiveList(theirs)) {
    return mergeOrder(isPrimitiveList(base) ? base : [], mine, theirs);
  }

  conflicts.push({ path, mine, theirs });
  return mine;
}

// Three-way merge of any JSON-like value; conflicts are provisionally resolved to `mine`.
export function mergeJson(base: unknown, mine: unknown, theirs: unknown): { merged: unknown; conflicts: { path: string[]; mine: unknown; theirs: unknown }[] } {
  const conflicts: JsonConflict[] = [];
  const merged = merge3(base ?? {}, mine, theirs, [], conflicts);
  return { merged, conflicts };
}

export function setAt(node: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(node)) {
    const list = node as (Obj & { id: string })[];
    const index = list.findIndex((x) => x.id === key);
    const next = setAt(index === -1 ? undefined : list[index], rest, value);
    if (next === undefined) return list.filter((x) => x.id !== key);
    return index === -1 ? [...list, next] : list.map((x, i) => (i === index ? next : x));
  }
  const obj: Obj = isObj(node) ? { ...node } : {};
  const next = setAt(obj[key], rest, value);
  if (next === undefined) delete obj[key];
  else obj[key] = next;
  return obj;
}
