import { nanoid } from "nanoid";
import type { Composition, StoredTokenData, Token } from "../tokens/model";
import { cssToColor } from "./color";
import { pathOf, placeOf } from "./names";
import { readDtcg } from "./read";

// Tokens from a design tokens (DTCG) file pasted in, into one set of the project: the file's tokens, as Motif reads them from a repository,
// with the values of its one theme in every theme of the set. A token whose place the set already has is left as it is (and said).

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// The older form of a value (`"#6366f1"`, `"16px"`) as the 2025.10 one (a color object, a dimension) that Motif reads.
function upgrade(node: unknown, inherited: string | undefined): unknown {
  if (!isObject(node)) return node;
  const type = typeof node.$type === "string" ? node.$type : inherited;
  if ("$value" in node) {
    const v = node.$value;
    if (typeof v === "string" && type === "color") { const c = cssToColor(v); return c ? { ...node, $value: c } : node; }
    if (typeof v === "string" && type === "dimension") {
      const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(v.trim());
      return m ? { ...node, $value: { value: parseFloat(m[1]), unit: m[2] } } : node;
    }
    return node;
  }
  return Object.fromEntries(Object.entries(node).map(([k, x]) => [k, k.startsWith("$") ? x : upgrade(x, type)]));
}

export interface Imported { data: StoredTokenData; imported: number; notes: string[] }

// Null when the text isn't a design tokens file with tokens Motif keeps.
export function importDtcg(json: string, model: StoredTokenData, setId: string): Imported | null {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!isObject(parsed)) return null;
  const read = readDtcg({ "src/tokens/tokens.json": JSON.stringify(upgrade(parsed, undefined)) }, undefined);
  if (read.data.tokens.length + read.data.compositions.length === 0) return null;

  const target = model.sets.find((s) => s.id === setId);
  if (!target) return null;
  const from = read.data.sets[0];
  const fromBase = from.themes[0].id;
  const notes = [...read.notes];

  const taken = new Set([
    ...model.tokens.filter((t) => t.setId === setId).map((t) => (placeOf(t.repoName) ?? pathOf(t.type, t.use, t.name)).join(".")),
    ...model.compositions.filter((c) => c.setId === setId).map((c) => `${c.kind}.${c.name}`),
  ]);
  const ids = new Map<string, string>();
  const tokens: Token[] = [];
  const compositions: Composition[] = [];
  for (const t of read.data.tokens) {
    const key = (placeOf(t.repoName) ?? pathOf(t.type, t.use, t.name)).join(".");
    if (taken.has(key)) { notes.push(`${t.name}: the set has a token there already`); continue; }
    ids.set(t.id, nanoid(6));
  }
  const every = <T,>(value: T): Record<string, T> => Object.fromEntries(target.themes.map((th) => [th.id, value]));
  for (const t of read.data.tokens) {
    const id = ids.get(t.id);
    if (!id) continue;
    const values = t.type === "color" ? every(t.values[fromBase] ?? Object.values(t.values)[0] ?? "") : t.values;
    const ref = t.ref?.[fromBase] && ids.has(t.ref[fromBase]) ? every(ids.get(t.ref[fromBase])!) : undefined;
    const { ref: _ref, ...rest } = t;
    void _ref;
    tokens.push({ ...rest, id, setId, values, ...(t.type === "color" ? { value: values[target.activeThemeId] } : {}), ...(ref ? { ref } : {}) });
  }
  for (const c of read.data.compositions) {
    if (taken.has(`${c.kind}.${c.name}`)) { notes.push(`${c.name}: the set has a ${c.kind} of that name already`); continue; }
    compositions.push({ ...c, id: nanoid(6), setId, slots: c.slots.map((s) => (s.ref && ids.has(s.ref) ? { ...s, ref: ids.get(s.ref) } : s.ref ? { name: s.name, type: s.type, ...(s.value !== undefined ? { value: s.value } : {}), ...(s.unit !== undefined ? { unit: s.unit } : {}) } : s)) });
  }
  const imported = tokens.length + compositions.length;
  if (imported === 0) return { data: model, imported: 0, notes };
  return { data: { ...model, tokens: [...model.tokens, ...tokens], compositions: [...model.compositions, ...compositions] }, imported, notes };
}
