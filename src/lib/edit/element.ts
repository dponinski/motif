import { nameOf, parseModule, unwrap, walk, type AnyNode } from "../repo-scan/ast";
import { NO_NAMES, groupById, hasGroup, readGroup, writeGroup, type ClassGroup, type TokenNames } from "./classes";
import { applyEdits, type Edit } from "./patch";

// What can be changed about one element of a component's source, and the changes themselves. Everything is
// a text edit on the file, made from where the element starts, so the result is the diff a person would write.

export interface Part {
  // The characters between the quotes.
  start: number;
  end: number;
  text: string;
}

export interface ClassSlot {
  id: string;
  label: string;
  kind: "literal" | "cn" | "cva-base" | "cva-variant";
  // A string written as "a " + "b" is one slot made of several parts.
  parts: Part[];
  // A variant's classes only apply while that variant is chosen.
  active: boolean;
}

export const slotText = (slot: ClassSlot) => slot.parts.map((p) => p.text).join("");

export interface ElementInfo {
  path: string;
  start: number;
  end: number;
  tag: string;
  className: "static" | "none" | "dynamic";
  dynamicReason: string | null;
  slots: ClassSlot[];
  // The classes that apply right now: every active slot, in order.
  classes: string;
  text: { start: number; end: number; value: string } | null;
  canDelete: boolean;
  // Exactly one element inside it, so taking the wrapper off leaves that element.
  canUnwrap: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface EditResult {
  code: string;
  // Where the selected element starts afterwards; null when it is gone.
  selection: number | null;
  summary: string;
}

const CN_NAMES = new Set(["cn", "clsx", "cx", "classnames", "classNames", "twMerge", "tw", "cls"]);
const CVA_SOURCES: Record<string, string> = { "class-variance-authority": "cva", "tailwind-variants": "tv" };

export interface FileContext {
  code: string;
  program: AnyNode;
  parents: Map<AnyNode, AnyNode | null>;
  // Variable name -> the cva(...) call that defines it.
  cvas: Map<string, AnyNode>;
}

export async function context(path: string, code: string): Promise<FileContext> {
  const program = (await parseModule(code, path)).program as unknown as AnyNode;
  const parents = new Map<AnyNode, AnyNode | null>();
  walk(program, (node, parent) => { parents.set(node, parent); });

  const cvaLocals = new Set<string>();
  for (const stmt of program.body as AnyNode[]) {
    if (stmt.type !== "ImportDeclaration") continue;
    const wanted = CVA_SOURCES[(stmt.source as AnyNode).value as string];
    if (!wanted) continue;
    for (const spec of stmt.specifiers as AnyNode[]) if (spec.type === "ImportSpecifier" && nameOf(spec.imported) === wanted) cvaLocals.add(nameOf(spec.local)!);
  }
  const cvas = new Map<string, AnyNode>();
  for (const stmt of program.body as AnyNode[]) {
    const decl = (stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt) as AnyNode | null;
    if (decl?.type !== "VariableDeclaration") continue;
    for (const d of decl.declarations as AnyNode[]) {
      const init = unwrap(d.init as AnyNode | null);
      const callee = init?.type === "CallExpression" ? (init.callee as AnyNode) : null;
      if (init && callee?.type === "Identifier" && cvaLocals.has(callee.name as string) && (d.id as AnyNode).type === "Identifier") cvas.set((d.id as AnyNode).name as string, init);
    }
  }
  return { code, program, parents, cvas };
}

// "a" or "a " + "b" or a template with no holes, as the pieces of text it is made of.
function partsOf(code: string, node: AnyNode | null): Part[] | null {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === "StringLiteral" || (n.type === "TemplateLiteral" && (n.expressions as unknown[]).length === 0)) {
    const start = (n.start as number) + 1;
    const end = (n.end as number) - 1;
    const text = code.slice(start, end);
    return text.includes("\\") ? null : [{ start, end, text }];
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const left = partsOf(code, n.left as AnyNode);
    const right = partsOf(code, n.right as AnyNode);
    return left && right ? [...left, ...right] : null;
  }
  return null;
}

const objectProp = (obj: AnyNode | null, name: string): AnyNode | null => {
  if (obj?.type !== "ObjectExpression") return null;
  const prop = (obj.properties as AnyNode[]).find((p) => p.type === "ObjectProperty" && !p.computed && nameOf(p.key) === name);
  return unwrap(prop?.value as AnyNode | undefined);
};

function cvaSlots(ctx: FileContext, call: AnyNode, label: string, values: Record<string, string>, out: ClassSlot[]) {
  const args = call.arguments as AnyNode[];
  const base = partsOf(ctx.code, args[0] ?? null);
  if (base) out.push({ id: `${out.length}`, label: `${label} base`, kind: "cva-base", parts: base, active: true });
  const config = unwrap(args[1] ?? null);
  const defaults: Record<string, string> = {};
  const defaultNode = objectProp(config, "defaultVariants");
  if (defaultNode?.type === "ObjectExpression") {
    for (const p of defaultNode.properties as AnyNode[]) {
      const v = unwrap(p.value as AnyNode);
      if (p.type === "ObjectProperty" && v && (v.type === "StringLiteral" || v.type === "BooleanLiteral")) defaults[nameOf(p.key) ?? ""] = String(v.value);
    }
  }
  const variants = objectProp(config, "variants");
  if (variants?.type !== "ObjectExpression") return;
  for (const group of variants.properties as AnyNode[]) {
    const groupName = group.type === "ObjectProperty" ? nameOf(group.key) : null;
    const options = unwrap(group.value as AnyNode);
    if (!groupName || options?.type !== "ObjectExpression") continue;
    const current = values[groupName] ?? defaults[groupName];
    for (const option of options.properties as AnyNode[]) {
      const optionName = option.type === "ObjectProperty" ? nameOf(option.key) : null;
      const parts = optionName ? partsOf(ctx.code, option.value as AnyNode) : null;
      if (optionName && parts) out.push({ id: `${out.length}`, label: `${groupName}: ${optionName}`, kind: "cva-variant", parts, active: current === optionName });
    }
  }
}

function classNameSlots(ctx: FileContext, expr: AnyNode, values: Record<string, string>): { slots: ClassSlot[]; reason: string | null } {
  const slots: ClassSlot[] = [];
  const e = unwrap(expr);
  const literal = partsOf(ctx.code, e);
  if (literal) return { slots: [{ id: "0", label: "className", kind: "literal", parts: literal, active: true }], reason: null };
  if (e?.type === "CallExpression" && (e.callee as AnyNode).type === "Identifier") {
    const callee = (e.callee as AnyNode).name as string;
    if (ctx.cvas.has(callee)) cvaSlots(ctx, ctx.cvas.get(callee)!, callee, values, slots);
    else if (CN_NAMES.has(callee)) {
      for (const arg of e.arguments as AnyNode[]) {
        const parts = partsOf(ctx.code, arg);
        const inner = unwrap(arg);
        if (parts) slots.push({ id: `${slots.length}`, label: "Classes", kind: "cn", parts, active: true });
        else if (inner?.type === "CallExpression" && (inner.callee as AnyNode).type === "Identifier" && ctx.cvas.has((inner.callee as AnyNode).name as string)) {
          const name = (inner.callee as AnyNode).name as string;
          cvaSlots(ctx, ctx.cvas.get(name)!, name, values, slots);
        }
      }
    }
  }
  return slots.length ? { slots, reason: null } : { slots: [], reason: "Its classes are built at runtime or come from another file, so they can't be edited here" };
}

export function findElement(ctx: FileContext, start: number): AnyNode | null {
  let found: AnyNode | null = null;
  walk(ctx.program, (node) => {
    if (found) return false;
    if (node.type === "JSXElement" && node.start === start) found = node;
  });
  return found;
}

function textOf(code: string, el: AnyNode): ElementInfo["text"] {
  const children = el.children as AnyNode[];
  const texts = children.filter((c) => c.type === "JSXText" && String(c.value).trim() !== "");
  if (texts.length !== 1 || children.some((c) => c.type !== "JSXText")) return null;
  const node = texts[0];
  const raw = code.slice(node.start as number, node.end as number);
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  const start = (node.start as number) + lead;
  const end = (node.end as number) - trail;
  return { start, end, value: code.slice(start, end) };
}

export const siblings = (ctx: FileContext, el: AnyNode): { parent: AnyNode; list: AnyNode[]; index: number } | null => {
  const parent = ctx.parents.get(el) ?? null;
  if (!parent || (parent.type !== "JSXElement" && parent.type !== "JSXFragment")) return null;
  const list = (parent.children as AnyNode[]).filter((c) => c.type === "JSXElement") as AnyNode[];
  return { parent, list, index: list.indexOf(el) };
};

export async function analyze(path: string, code: string, start: number, values: Record<string, string> = {}): Promise<ElementInfo | null> {
  const ctx = await context(path, code);
  const el = findElement(ctx, start);
  if (!el) return null;
  const open = el.openingElement as AnyNode;
  const nameNode = open.name as AnyNode;
  const attr = (open.attributes as AnyNode[]).find((a) => a.type === "JSXAttribute" && nameOf(a.name) === "className");

  let slots: ClassSlot[] = [];
  let className: ElementInfo["className"] = "none";
  let reason: string | null = null;
  if (attr) {
    const value = attr.value as AnyNode | null;
    const expr = value?.type === "JSXExpressionContainer" ? (value.expression as AnyNode) : value;
    const result = expr ? classNameSlots(ctx, expr, values) : { slots: [], reason: "className has no value" };
    slots = result.slots;
    reason = result.reason;
    className = result.slots.length ? "static" : "dynamic";
  }
  const sib = siblings(ctx, el);
  return {
    path, start, end: el.end as number,
    tag: nameNode.type === "JSXIdentifier" ? (nameNode.name as string) : code.slice(nameNode.start as number, nameNode.end as number),
    className, dynamicReason: reason, slots,
    classes: slots.filter((s) => s.active).map(slotText).join(" "),
    text: textOf(code, el),
    canDelete: !!sib,
    canUnwrap: (() => {
      const kids = (el.children as AnyNode[]).filter((c) => !(c.type === "JSXText" && String(c.value).trim() === ""));
      return kids.length === 1 && kids[0].type === "JSXElement" && !!el.closingElement;
    })(),
    canMoveUp: !!sib && sib.index > 0,
    canMoveDown: !!sib && sib.index >= 0 && sib.index < sib.list.length - 1,
  };
}

const done = (code: string, edits: Edit[], selection: number, summary: string): EditResult => ({ ...applyEdits(code, edits, selection), summary });

// The edits that give a slot new text. A string made of several parts keeps its shape.
function slotEdits(slot: ClassSlot, group: ClassGroup, value: string | null, modifier: string, names: TokenNames): Edit[] {
  const matching = slot.parts.findIndex((p) => hasGroup(p.text, group, modifier, names));
  const edits: Edit[] = [];
  const target = matching === -1 ? slot.parts.length - 1 : matching;
  slot.parts.forEach((part, i) => {
    const next = i === target ? writeGroup(part.text, group, value, modifier, names) : hasGroup(part.text, group, modifier, names) ? writeGroup(part.text, group, null, modifier, names) : part.text;
    if (next !== part.text) edits.push({ start: part.start, end: part.end, text: next });
  });
  return edits;
}

// Sets one group (gap, background, ...) on an element, in the class string where that group already is, or
// in the element's own classes when it isn't set yet. A null value removes it. With a modifier ("hover:", "md:")
// it is that state's class that is read and written, and the plain class is left alone. `names` are the
// repository's token names, which decide what `text-display` or `shadow-card` is.
export async function setGroup(path: string, code: string, start: number, groupId: string, value: string | null, values: Record<string, string> = {}, modifier = "", names: TokenNames = NO_NAMES): Promise<EditResult | null> {
  const info = await analyze(path, code, start, values);
  if (!info) return null;
  if (info.className === "dynamic") throw new Error(info.dynamicReason ?? "These classes can't be edited");
  const group = groupById(groupId);
  const before = readGroup(info.classes, group, modifier, names);
  const state = modifier ? `${modifier.replace(/:$/, "").replace(/:/g, " ")} ` : "";
  const summary = `${info.tag}: ${state}${group.label.toLowerCase()} ${before ?? "none"} → ${value ?? "none"}`;
  if (before === value) return { code, selection: start, summary };

  const active = info.slots.filter((s) => s.active);
  const holder = [...active].reverse().find((s) => hasGroup(slotText(s), group, modifier, names));
  if (holder) return done(code, slotEdits(holder, group, value, modifier, names), start, summary);
  if (value === null) return { code, selection: start, summary };

  // A state goes next to the plain class it is a state of (dark:bg-x beside bg-x), so a variant's own colors
  // stay in the variant; otherwise it goes in the element's own classes, or the cva base.
  const neighbour = modifier ? [...active].reverse().find((s) => hasGroup(slotText(s), group, "", names)) : undefined;
  const adopter = neighbour ?? [...active].reverse().find((s) => s.kind === "literal" || s.kind === "cn") ?? active.find((s) => s.kind === "cva-base");
  if (adopter) return done(code, slotEdits(adopter, group, value, modifier, names), start, summary);

  // No className yet.
  const ctx = await context(path, code);
  const el = findElement(ctx, start)!;
  const at = ((el.openingElement as AnyNode).name as AnyNode).end as number;
  return done(code, [{ start: at, end: at, text: ` className="${modifier}${group.write(value)}"` }], start, summary);
}

// Replaces the whole text of a slot (the raw class editor).
export async function setSlotClasses(path: string, code: string, start: number, slotId: string, text: string, values: Record<string, string> = {}): Promise<EditResult | null> {
  const info = await analyze(path, code, start, values);
  const slot = info?.slots.find((s) => s.id === slotId);
  if (!info || !slot) return null;
  const clean = text.replace(/["'`\\]/g, "");
  const edits: Edit[] = slot.parts.map((part, i) => ({ start: part.start, end: part.end, text: i === 0 ? clean + (slot.parts.length > 1 && !/\s$/.test(clean) ? " " : "") : "" }));
  return done(code, edits.filter((e, i) => e.text !== slot.parts[i].text), start, `${info.tag}: classes edited`);
}

export async function setText(path: string, code: string, start: number, value: string): Promise<EditResult | null> {
  const info = await analyze(path, code, start);
  if (!info?.text) return null;
  const text = /[{}<>]/.test(value) ? `{${JSON.stringify(value)}}` : value;
  return done(code, [{ start: info.text.start, end: info.text.end, text }], start, `${info.tag}: text "${info.text.value.slice(0, 24)}${info.text.value.length > 24 ? "…" : ""}" → "${value.slice(0, 24)}${value.length > 24 ? "…" : ""}"`);
}

// The line an element sits alone on, with its line break, so deleting it leaves no blank line behind.
function lineSpan(code: string, start: number, end: number): { start: number; end: number } {
  const lineStart = code.lastIndexOf("\n", start - 1) + 1;
  const nl = code.indexOf("\n", end);
  const lineEnd = nl === -1 ? code.length : nl;
  return code.slice(lineStart, start).trim() === "" && code.slice(end, lineEnd).trim() === "" ? { start: lineStart, end: Math.min(lineEnd + 1, code.length) } : { start, end };
}

export async function deleteElement(path: string, code: string, start: number): Promise<EditResult | null> {
  const ctx = await context(path, code);
  const el = findElement(ctx, start);
  if (!el || !siblings(ctx, el)) return null;
  const info = await analyze(path, code, start);
  const span = lineSpan(code, start, el.end as number);
  return { ...applyEdits(code, [{ ...span, text: "" }], null), selection: null, summary: `${info?.tag ?? "element"}: deleted` };
}

export async function duplicateElement(path: string, code: string, start: number): Promise<EditResult | null> {
  const ctx = await context(path, code);
  const el = findElement(ctx, start);
  if (!el || !siblings(ctx, el)) return null;
  const info = await analyze(path, code, start);
  const end = el.end as number;
  const lineStart = code.lastIndexOf("\n", start - 1) + 1;
  const indent = code.slice(lineStart, start);
  const alone = indent.trim() === "";
  const copy = code.slice(start, end);
  return done(code, [{ start: end, end, text: alone ? `\n${indent}${copy}` : copy }], start, `${info?.tag ?? "element"}: duplicated`);
}

export async function moveElement(path: string, code: string, start: number, direction: -1 | 1): Promise<EditResult | null> {
  const ctx = await context(path, code);
  const el = findElement(ctx, start);
  const sib = el && siblings(ctx, el);
  if (!el || !sib) return null;
  const other = sib.list[sib.index + direction];
  if (!other) return null;
  const [first, second] = direction === -1 ? [other, el] : [el, other];
  const a = { start: first.start as number, end: first.end as number };
  const b = { start: second.start as number, end: second.end as number };
  const textA = code.slice(a.start, a.end);
  const textB = code.slice(b.start, b.end);
  const between = code.slice(a.end, b.start);
  const swapped = textB + between + textA;
  const out = code.slice(0, a.start) + swapped + code.slice(b.end);
  // The moved element now starts where the other one did, or after the other one and what lay between.
  const selection = direction === -1 ? a.start : a.start + textB.length + between.length;
  const info = await analyze(path, code, start);
  return { code: out, selection, summary: `${info?.tag ?? "element"}: moved ${direction === -1 ? "up" : "down"}` };
}
