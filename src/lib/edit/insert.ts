import type { AnyNode } from "../repo-scan/ast";
import { analyze, context, findElement, siblings, type EditResult, type FileContext } from "./element";
import { importEdits, type ImportSpec } from "./imports";
import { applyEdits, type Edit } from "./patch";

// Adding elements, wrapping them, taking a wrapper off, and changing what an element is. Like the rest of the
// editor these are text edits that keep the file's own indentation, so the diff reads like hand-written code.

export type InsertPosition = "first-child" | "last-child" | "before" | "after";

const VOID = new Set(["img", "input", "br", "hr", "meta", "link", "source", "wbr"]);

export const HOST_TAGS = ["div", "section", "article", "aside", "main", "header", "footer", "nav", "ul", "ol", "li", "p", "span", "h1", "h2", "h3", "h4", "a", "button", "label", "form"];

const lineStartOf = (code: string, pos: number) => code.lastIndexOf("\n", pos - 1) + 1;
const indentAt = (code: string, pos: number) => code.slice(lineStartOf(code, pos)).match(/^[ \t]*/)![0];

// The file's indentation step: the smallest indent of an indented line, or a tab.
function indentUnit(code: string): string {
  let best = Infinity;
  for (const line of code.split("\n")) {
    if (line.startsWith("\t")) return "\t";
    const n = line.match(/^ +/)?.[0].length ?? 0;
    if (n > 0 && n < best) best = n;
  }
  return " ".repeat(Number.isFinite(best) ? best : 2);
}

// True when nothing else is on the lines the node occupies.
function alone(code: string, start: number, end: number): boolean {
  const nl = code.indexOf("\n", end);
  return code.slice(lineStartOf(code, start), start).trim() === "" && code.slice(end, nl === -1 ? code.length : nl).trim() === "";
}

const reindent = (jsx: string, indent: string) => jsx.split("\n").map((l, i) => (i === 0 || l === "" ? l : indent + l)).join("\n");

const tagIn = (jsx: string) => jsx.match(/^<([A-Za-z][\w.]*)/)?.[1] ?? "element";

// A child's span, without the blank lines and indentation a text node carries around its words.
function kidSpan(code: string, node: AnyNode): { start: number; end: number } {
  const start = node.start as number;
  const end = node.end as number;
  if (node.type !== "JSXText") return { start, end };
  const raw = code.slice(start, end);
  return { start: start + (raw.length - raw.trimStart().length), end: end - (raw.length - raw.trimEnd().length) };
}

const kidsOf = (code: string, el: AnyNode) =>
  (el.children as AnyNode[]).filter((c) => !(c.type === "JSXText" && String(c.value).trim() === "")).map((c) => kidSpan(code, c));

async function withImport(path: string, code: string, imp: ImportSpec | undefined): Promise<Edit[]> {
  return imp ? (await importEdits(path, code, imp)).edits : [];
}

const delta = (edits: Edit[]) => edits.reduce((n, e) => n + e.text.length - (e.end - e.start), 0);

function finish(code: string, edits: Edit[], imports: Edit[], selection: number | null, summary: string): EditResult {
  // The imports are all above everything else, so they move the selection by exactly their length.
  const out = applyEdits(code, [...imports, ...edits]).code;
  return { code: out, selection: selection === null ? null : selection + delta(imports), summary };
}

function must(ctx: FileContext, start: number): AnyNode {
  const el = findElement(ctx, start);
  if (!el) throw new Error("That element is no longer in the file");
  return el;
}

// Adds `jsx` (one or more lines of JSX) inside, before or after an element, selecting the new element.
export async function insertElement(path: string, code: string, start: number, position: InsertPosition, jsx: string, imp?: ImportSpec): Promise<EditResult> {
  const ctx = await context(path, code);
  const el = must(ctx, start);
  const open = el.openingElement as AnyNode;
  const end = el.end as number;
  const unit = indentUnit(code);
  const own = indentAt(code, start);
  const what = tagIn(jsx);
  const target = code.slice((open.name as AnyNode).start as number, (open.name as AnyNode).end as number);
  const summary = `${target}: added <${what}> ${position === "before" || position === "after" ? position : "inside"}`;
  const imports = await withImport(path, code, imp);

  if (position === "before" || position === "after") {
    if (!siblings(ctx, el)) throw new Error("An element can only be added beside another element that is inside a parent element");
    const lone = alone(code, start, end);
    if (position === "before") {
      const at = lone ? lineStartOf(code, start) : start;
      const text = lone ? `${own}${reindent(jsx, own)}\n` : jsx;
      return finish(code, [{ start: at, end: at, text }], imports, at + (lone ? own.length : 0), summary);
    }
    const text = lone ? `\n${own}${reindent(jsx, own)}` : jsx;
    return finish(code, [{ start: end, end, text }], imports, end + (lone ? 1 + own.length : 0), summary);
  }

  if (VOID.has(target)) throw new Error(`<${target}> can't contain other elements`);
  const childIndent = own + unit;
  const snippet = reindent(jsx, childIndent);
  const closing = el.closingElement as AnyNode | null;

  // <X /> becomes <X>…</X> with the new element inside.
  if (!closing) {
    const openText = code.slice(open.start as number, open.end as number).replace(/\s*\/>$/, ">");
    const text = `${openText}\n${childIndent}${snippet}\n${own}</${target}>`;
    return finish(code, [{ start, end, text }], imports, start + openText.length + 1 + childIndent.length, summary);
  }

  const kids = kidsOf(code, el);
  const closeAt = closing.start as number;
  if (kids.length === 0) {
    const from = open.end as number;
    return finish(code, [{ start: from, end: closeAt, text: `\n${childIndent}${snippet}\n${own}` }], imports, from + 1 + childIndent.length, summary);
  }

  if (position === "first-child") {
    const first = kids[0];
    if (code.slice(lineStartOf(code, first.start), first.start).trim() === "") {
      const ind = indentAt(code, first.start);
      const at = lineStartOf(code, first.start);
      return finish(code, [{ start: at, end: at, text: `${ind}${reindent(jsx, ind)}\n` }], imports, at + ind.length, summary);
    }
    return finish(code, [{ start: first.start, end: first.start, text: jsx }], imports, first.start, summary);
  }

  const last = kids[kids.length - 1];
  if (code.slice(last.end, closeAt).includes("\n")) {
    const ind = indentAt(code, last.start);
    const lineIndent = code.slice(lineStartOf(code, last.start), last.start).trim() === "" ? ind : childIndent;
    return finish(code, [{ start: last.end, end: last.end, text: `\n${lineIndent}${reindent(jsx, lineIndent)}` }], imports, last.end + 1 + lineIndent.length, summary);
  }
  return finish(code, [{ start: closeAt, end: closeAt, text: jsx }], imports, closeAt, summary);
}

// Puts an element inside a new one: `open` is the new element's opening tag, `tag` its name.
export async function wrapElement(path: string, code: string, start: number, tag: string, classes: string | null, imp?: ImportSpec): Promise<EditResult> {
  const ctx = await context(path, code);
  const el = must(ctx, start);
  const end = el.end as number;
  const unit = indentUnit(code);
  const lone = alone(code, start, end);
  const own = indentAt(code, start);
  const open = `<${tag}${classes ? ` className="${classes}"` : ""}>`;
  const inner = code.slice(start, end);
  const info = await analyze(path, code, start);
  const imports = await withImport(path, code, imp);
  const summary = `${info?.tag ?? "element"}: wrapped in <${tag}>`;
  const text = lone
    ? `${open}\n${own}${unit}${inner.split("\n").map((l, i) => (i === 0 || l === "" ? l : unit + l)).join("\n")}\n${own}</${tag}>`
    : `${open}${inner}</${tag}>`;
  return finish(code, [{ start, end, text }], imports, start, summary);
}

// Takes an element's wrapper off, keeping the one element inside it.
export async function unwrapElement(path: string, code: string, start: number): Promise<EditResult | null> {
  const ctx = await context(path, code);
  const el = must(ctx, start);
  const kids = (el.children as AnyNode[]).filter((c) => !(c.type === "JSXText" && String(c.value).trim() === ""));
  if (kids.length !== 1 || kids[0].type !== "JSXElement" || !el.closingElement) return null;
  const unit = indentUnit(code);
  const kid = kids[0];
  const info = await analyze(path, code, start);
  const text = code.slice(kid.start as number, kid.end as number).split("\n").map((l, i) => (i > 0 && l.startsWith(unit) ? l.slice(unit.length) : l)).join("\n");
  return { ...applyEdits(code, [{ start, end: el.end as number, text }], null), selection: start, summary: `${info?.tag ?? "element"}: unwrapped` };
}

// Changes what an element is, keeping its classes, props and content.
export async function changeTag(path: string, code: string, start: number, tag: string): Promise<EditResult | null> {
  if (!/^[a-z][a-z0-9]*$/.test(tag)) throw new Error(`${tag} isn't an HTML element`);
  const ctx = await context(path, code);
  const el = must(ctx, start);
  const open = el.openingElement as AnyNode;
  const name = open.name as AnyNode;
  if (name.type !== "JSXIdentifier") return null;
  if (VOID.has(tag) && kidsOf(code, el).length > 0) throw new Error(`<${tag}> can't contain other elements`);
  const from = name.name as string;
  if (from === tag) return { code, selection: start, summary: `${from}: unchanged` };
  const edits: Edit[] = [{ start: name.start as number, end: name.end as number, text: tag }];
  const closing = el.closingElement as AnyNode | null;
  if (closing) edits.push({ start: (closing.name as AnyNode).start as number, end: (closing.name as AnyNode).end as number, text: tag });
  return { ...applyEdits(code, edits, start), summary: `${from}: now <${tag}>` };
}
