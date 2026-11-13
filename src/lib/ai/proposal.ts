import { GROUPS, MODIFIERS, NO_NAMES, groupById, readGroup, type TokenNames } from "../edit/classes";
import { analyze, setGroup, setText } from "../edit/element";
import type { TreeNode } from "../edit/tree";

// Changes to the open component that the assistant suggests. They are not source text: each is one of the edits
// the inspector makes (a class group on an element, or an element's text), named by the element's place in the
// component, so they are checked before anything is shown and made through the same engine, as one undo step.

export interface ElementRef {
  // Where the element comes in the component, in reading order: what the assistant is told and answers with.
  index: number;
  // Where it starts in the file now; only for the edit that is being made, never sent or kept.
  start: number;
  tag: string;
  parent: number | null;
  // Plain HTML elements can be edited; other components are only shown for the structure.
  selectable: boolean;
}

export function flattenTree(tree: TreeNode[]): ElementRef[] {
  const out: ElementRef[] = [];
  const visit = (nodes: TreeNode[], parent: number | null) => {
    for (const node of nodes) {
      const index = out.length;
      out.push({ index, start: node.start, tag: node.tag, parent, selectable: node.selectable });
      visit(node.children, index);
    }
  };
  visit(tree, null);
  return out;
}

// What the component's structure was when the assistant was asked. A suggestion refers to elements by number, so
// it only applies while the elements are still the same ones.
export const signatureOf = (elements: ElementRef[]) => elements.map((e) => `${e.parent ?? ""}>${e.tag}`).join(" ");

export type Change =
  | { element: number; group: string; value: string | null; state: string }
  | { element: number; text: string };

export interface ParsedEdit {
  summary: string;
  changes: Change[];
  // Why each suggestion that was left out was.
  rejected: string[];
}

export const MAX_CHANGES = 40;
// What a class value is made of: letters, digits and the punctuation of `primary/50`, `[#4f46e5]`, `4.5`.
// Nothing that could end a class or a string.
const VALUE = /^[\w./[\]#%(),:+-]{1,60}$/;
const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// The suggestion as far as it can be trusted, or null when the reply is not a suggestion of changes at all.
export function parseEdit(raw: unknown, elements: ElementRef[]): ParsedEdit | null {
  if (!isObject(raw) || raw.action !== "edit" || !Array.isArray(raw.changes)) return null;
  const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 200) : "";
  const changes: Change[] = [];
  const rejected: string[] = [];
  raw.changes.forEach((item, i) => {
    const no = `Change ${i + 1}`;
    if (changes.length >= MAX_CHANGES) { if (i === MAX_CHANGES) rejected.push(`Only the first ${MAX_CHANGES} changes are taken`); return; }
    if (!isObject(item)) return void rejected.push(`${no} is not a change`);
    const el = Number.isInteger(item.element) ? elements[item.element as number] : undefined;
    if (!el) return void rejected.push(`${no} is for an element that isn't in the component`);
    if (!el.selectable) return void rejected.push(`${no} is for <${el.tag}>, which is another component and can't be edited here`);

    if ("text" in item) {
      if (typeof item.text !== "string" || item.text.length > 200 || hasControl(item.text)) return void rejected.push(`${no} has text that can't be used`);
      changes.push({ element: el.index, text: item.text });
      return;
    }
    if (typeof item.group !== "string" || !GROUPS.some((g) => g.id === item.group)) return void rejected.push(`${no} is for something that can't be edited (${String(item.group).slice(0, 30)})`);
    const group = groupById(item.group);
    const state = item.state === undefined || item.state === null ? "" : item.state;
    if (typeof state !== "string" || !MODIFIERS.some((m) => m.id === state)) return void rejected.push(`${no} is for a state that isn't one of the inspector's`);
    const value = item.value === undefined ? null : item.value;
    if (value !== null && (typeof value !== "string" || !VALUE.test(value))) return void rejected.push(`${no} has a value that can't be used`);
    // A group with a fixed list (display, direction, weight ...) takes only what is in it.
    if (value !== null && !group.role && group.options && !group.options.includes(value)) return void rejected.push(`${no}: "${value}" isn't a value of ${group.label.toLowerCase()}`);
    changes.push({ element: el.index, group: group.id, value, state });
  });
  return { summary, changes, rejected };
}

export interface Row {
  change: Change;
  tag: string;
  label: string;
  before: string | null;
  after: string | null;
}

const stateLabel = (state: string) => (state ? ` (${state.replace(/:$/, "").replace(/:/g, " ")})` : "");

// What each change would do, from what the component has now.
export async function previewChanges(path: string, code: string, elements: ElementRef[], changes: Change[], names: TokenNames = NO_NAMES, values: Record<string, string> = {}): Promise<Row[]> {
  const rows: Row[] = [];
  for (const change of changes) {
    const el = elements[change.element];
    const info = await analyze(path, code, el.start, values).catch(() => null);
    if ("text" in change) rows.push({ change, tag: el.tag, label: "Text", before: info?.text?.value ?? null, after: change.text });
    else {
      const group = groupById(change.group);
      rows.push({ change, tag: el.tag, label: `${group.label}${stateLabel(change.state)}`, before: info ? readGroup(info.classes, group, change.state, names) : null, after: change.value });
    }
  }
  return rows;
}

export interface Applied {
  code: string;
  // How many changes altered the file; the rest already were what was asked.
  changed: number;
  skipped: { change: Change; reason: string }[];
}

// Makes the changes in the file, later elements first so the places of the earlier ones hold. The elements must be
// read from `code` as it is now.
export async function applyChanges(path: string, code: string, elements: ElementRef[], changes: Change[], names: TokenNames = NO_NAMES, values: Record<string, string> = {}): Promise<Applied> {
  const order = changes.map((change, i) => ({ change, i })).sort((a, b) => elements[b.change.element].start - elements[a.change.element].start || a.i - b.i);
  let current = code;
  let changed = 0;
  const skipped: Applied["skipped"] = [];
  for (const { change } of order) {
    const start = elements[change.element].start;
    try {
      const result = "text" in change
        ? await setText(path, current, start, change.text)
        : await setGroup(path, current, start, change.group, change.value, values, change.state, names);
      if (!result) { skipped.push({ change, reason: "text" in change ? "It has no text of its own to change" : "It is no longer there" }); continue; }
      if (result.code !== current) { current = result.code; changed++; }
    } catch (err) {
      skipped.push({ change, reason: err instanceof Error ? err.message : "It could not be changed" });
    }
  }
  return { code: current, changed, skipped };
}
