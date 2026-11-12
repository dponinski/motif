import type { CanvasElement, ComponentGroup, VariantProp } from "../store/canvas";

export const DOCUMENT_EXTENSION = ".motif.json";

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

export interface MotifDocument extends DocumentContent {
  motif: 1;
  id: string;
  name: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const isKeyedList = (v: unknown): v is (Obj & { id: string })[] =>
  Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === "string");

const isPrimitiveList = (v: unknown): v is unknown[] =>
  Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null);

// ── Serialization ─────────────────────────────────────────────────────────────

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObj(value)) {
    const out: Obj = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

// Sorted keys and one value per line keep git diffs small and line-based merges workable.
export function serializeDocument(doc: MotifDocument): string {
  const ordered = {
    motif: doc.motif,
    id: doc.id,
    name: doc.name,
    componentGroups: canonical(doc.componentGroups),
    components: canonical(doc.components),
    // Left out while empty so files written before docs existed keep the same blob.
    ...(doc.docs.length ? { docs: canonical(doc.docs) } : {}),
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

export function parseDocument(text: string): MotifDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON (it may contain unresolved git conflict markers)");
  }
  if (!isObj(raw) || typeof raw.motif !== "number") throw new Error("Not a Motif design file");
  if (raw.motif !== 1) throw new Error(`Unsupported Motif file version ${raw.motif}`);
  if (typeof raw.id !== "string" || typeof raw.name !== "string" || !Array.isArray(raw.components)) {
    throw new Error("Motif design file is malformed");
  }
  const components = raw.components.map((c): DocumentComponent => {
    if (!isObj(c) || typeof c.id !== "string" || !isObj(c.elements)) {
      throw new Error("Motif design file is malformed");
    }
    return {
      id: c.id,
      name: typeof c.name === "string" ? c.name : "Component",
      groupId: typeof c.groupId === "string" ? c.groupId : null,
      variantProps: Array.isArray(c.variantProps) ? (c.variantProps as VariantProp[]) : [],
      elements: c.elements as Record<string, CanvasElement>,
      order: Array.isArray(c.order) ? (c.order as string[]) : [],
    };
  });
  return {
    motif: 1,
    id: raw.id,
    name: raw.name,
    componentGroups: Array.isArray(raw.componentGroups) ? (raw.componentGroups as ComponentGroup[]) : [],
    components,
    docs: Array.isArray(raw.docs) ? raw.docs.flatMap(parseDocPage) : [],
  };
}

const isRepoRef = (ref: unknown): ref is RepoRef => isObj(ref) && typeof ref.file === "string" && typeof ref.name === "string";

function isDocBlock(block: unknown): block is DocBlock {
  if (!isObj(block) || typeof block.id !== "string") return false;
  switch (block.type) {
    case "heading":
    case "text":
      return typeof block.text === "string";
    case "guideline":
      return typeof block.do === "string" && typeof block.dont === "string";
    case "preview":
    case "props":
    case "code":
      return typeof block.componentId === "string";
    case "repo-preview":
      return isRepoRef(block.ref) && (block.view === "single" || block.view === "variants");
    case "repo-props":
    case "repo-code":
      return isRepoRef(block.ref);
    case "tokens":
      return ["colors", "typography", "spacing", "radii", "shadows"].includes(block.kind as string);
    default:
      return false;
  }
}

function parseDocPage(page: unknown): DocPage[] {
  if (!isObj(page) || typeof page.id !== "string" || !Array.isArray(page.blocks)) return [];
  const title = typeof page.title === "string" ? page.title : "";
  return [{ id: page.id, title, blocks: page.blocks.filter(isDocBlock) }];
}

// ── Three-way merge ───────────────────────────────────────────────────────────

export interface MergeConflict {
  path: string[];
  label: string;
  mine: unknown;
  theirs: unknown;
}

export interface MergeResult {
  // Conflicts are provisionally resolved to "mine"; pass choices to resolveConflicts to change that.
  merged: MotifDocument;
  conflicts: MergeConflict[];
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

function merge3(base: unknown, mine: unknown, theirs: unknown, path: string[], conflicts: Omit<MergeConflict, "label">[]): unknown {
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

function describe(path: string[], mine: MotifDocument, theirs: MotifDocument): string {
  const [root, id, section, subId, ...rest] = path;
  if (root === "name") return "File name";
  if (root === "componentGroups") {
    const g = mine.componentGroups.find((x) => x.id === id) ?? theirs.componentGroups.find((x) => x.id === id);
    return [`Group "${g?.name ?? id}"`, section].filter(Boolean).join(" · ");
  }
  if (root === "docs") {
    const page = mine.docs.find((x) => x.id === id) ?? theirs.docs.find((x) => x.id === id);
    const what = section === "blocks" ? "content" : section;
    return [`Docs › ${page?.title || id}`, what].filter(Boolean).join(" · ");
  }
  if (root === "components") {
    const mc = mine.components.find((c) => c.id === id);
    const tc = theirs.components.find((c) => c.id === id);
    const comp = mc?.name ?? tc?.name ?? id;
    if (section === "elements" && subId) {
      const el = mc?.elements[subId] ?? tc?.elements[subId];
      return [`${comp} › ${el?.name ?? subId}`, ...rest].join(" · ");
    }
    if (section === "variantProps" && subId) {
      const p = mc?.variantProps.find((x) => x.id === subId) ?? tc?.variantProps.find((x) => x.id === subId);
      return [`${comp} › prop "${p?.name ?? subId}"`, ...rest].join(" · ");
    }
    return [`Component "${comp}"`, section, subId, ...rest].filter(Boolean).join(" · ");
  }
  return path.join(" · ");
}

// Restores tree invariants a merge can break (e.g. an element kept while its parent was deleted).
function repair(doc: MotifDocument): MotifDocument {
  const groupIds = new Set(doc.componentGroups.map((g) => g.id));
  const components = doc.components.map((comp) => {
    const elements: Record<string, CanvasElement> = { ...comp.elements };
    let removed = true;
    while (removed) {
      removed = false;
      for (const el of Object.values(elements)) {
        if (el.parentId && !elements[el.parentId]) {
          delete elements[el.id];
          removed = true;
        }
      }
    }
    const childrenOf = new Map<string, string[]>();
    for (const el of Object.values(elements)) {
      if (el.children) {
        const kept = [...new Set(el.children)].filter((id) => elements[id]?.parentId === el.id);
        childrenOf.set(el.id, kept);
      }
    }
    for (const el of Object.values(elements)) {
      if (!el.parentId) continue;
      const list = childrenOf.get(el.parentId) ?? [];
      if (!list.includes(el.id)) list.push(el.id);
      childrenOf.set(el.parentId, list);
    }
    for (const [id, children] of childrenOf) elements[id] = { ...elements[id], children };

    const order = [...new Set(comp.order)].filter((id) => elements[id] && !elements[id].parentId);
    for (const el of Object.values(elements)) {
      if (!el.parentId && !order.includes(el.id)) order.push(el.id);
    }
    const groupId = comp.groupId && groupIds.has(comp.groupId) ? comp.groupId : null;
    return { ...comp, groupId, elements, order };
  });
  return { ...doc, components };
}

// Three-way merge of any JSON-like value; conflicts are provisionally resolved to `mine`.
export function mergeJson(base: unknown, mine: unknown, theirs: unknown): { merged: unknown; conflicts: { path: string[]; mine: unknown; theirs: unknown }[] } {
  const conflicts: Omit<MergeConflict, "label">[] = [];
  const merged = merge3(base ?? {}, mine, theirs, [], conflicts);
  return { merged, conflicts };
}

export function mergeDocuments(base: MotifDocument | null, mine: MotifDocument, theirs: MotifDocument): MergeResult {
  const raw: Omit<MergeConflict, "label">[] = [];
  const merged = merge3(base ?? {}, mine, theirs, [], raw) as MotifDocument;
  const conflicts = raw.map((c) => ({ ...c, label: describe(c.path, mine, theirs) }));
  return { merged: repair(merged), conflicts };
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

export function resolveConflicts(result: MergeResult, takeTheirs: number[]): MotifDocument {
  let doc: unknown = result.merged;
  for (const index of takeTheirs) {
    const conflict = result.conflicts[index];
    doc = setAt(doc, conflict.path, conflict.theirs);
  }
  return repair(doc as MotifDocument);
}
