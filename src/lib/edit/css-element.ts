import { normalize } from "../repo-scan/model";
import { CssError, classesIn, hasRule, readDeclarations, setDeclarations, STATES } from "./css";
import { cssGroupById, cssNames } from "./css-groups";
import { analyze, context, findElement, type ElementInfo } from "./element";
import { applyEdits, type Edit } from "./patch";
import type { AnyNode } from "../repo-scan/ast";
import type { TokenIndex } from "./tokens";

// Changing how an element looks when the component's styles are in a stylesheet next to it: the element gets a class of
// its own (when it has none with a rule), and the rule for that class in the stylesheet gets the declaration. One
// change can touch both files, and both are returned together so it is one step to undo.

// The stylesheet a component file imports, as a path in the repository. CSS modules are not plain stylesheets.
export function stylesheetOf(path: string, code: string): string | null {
  for (const m of code.matchAll(/^\s*import\s+["'](\.{1,2}\/[^"']+\.css)["']\s*;?/gm)) {
    if (/\.module\.css$/i.test(m[1])) continue;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    return normalize(dir ? `${dir}/${m[1]}` : m[1]);
  }
  return null;
}

// The class of an element whose rule its styles are in: the first of its classes that has one.
export const ownedClass = (classes: string, css: string): string | null => classes.split(/\s+/).filter(Boolean).find((c) => hasRule(css, c)) ?? null;

// How many elements of the file name this class in their className: in a plain string, or among the strings of an
// expression such as cn("a", open && "b").
export function usesOf(code: string, cls: string): number {
  let n = 0;
  for (const m of code.matchAll(/className\s*=\s*/g)) {
    let i = m.index! + m[0].length;
    let body = "";
    if (code[i] === '"' || code[i] === "'") {
      const end = code.indexOf(code[i], i + 1);
      body = end === -1 ? "" : code.slice(i + 1, end);
    } else if (code[i] === "{") {
      let depth = 0;
      let end = i;
      for (; end < code.length; end++) {
        if (code[end] === "{") depth++;
        else if (code[end] === "}" && --depth === 0) break;
      }
      body = [...code.slice(i + 1, end).matchAll(/"([^"]*)"|'([^']*)'|`([^`$]*)`/g)].map((x) => x[1] ?? x[2] ?? x[3] ?? "").join(" ");
    }
    if (body.split(/\s+/).includes(cls)) n++;
  }
  return n;
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

// A class name for an element that has none: the component's, a double underscore, what the element is.
export function newClassName(stylesheet: string, tag: string, code: string, css: string): string {
  const file = stylesheet.slice(stylesheet.lastIndexOf("/") + 1).replace(/\.css$/i, "");
  const stem = `${kebab(file) || "component"}__${kebab(tag) || "element"}`;
  const taken = new Set(classesIn(css));
  for (const m of code.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) for (const c of (m[1] ?? m[2]).split(/\s+/)) taken.add(c);
  let name = stem;
  for (let n = 2; taken.has(name); n++) name = `${stem}-${n}`;
  return name;
}

// The edits that give an element a class: onto the string it already has, or as a new attribute.
async function classEdits(path: string, code: string, start: number, info: ElementInfo, cls: string): Promise<Edit[]> {
  if (info.className === "none") {
    const ctx = await context(path, code);
    const el = findElement(ctx, start)!;
    const at = ((el.openingElement as AnyNode).name as AnyNode).end as number;
    return [{ start: at, end: at, text: ` className="${cls}"` }];
  }
  const slot = [...info.slots].reverse().find((s) => s.active && (s.kind === "literal" || s.kind === "cn"));
  if (!slot) throw new CssError("This element's classes are computed, so Motif can't give it one to style.");
  const part = slot.parts[slot.parts.length - 1];
  return [{ start: part.start, end: part.end, text: part.text.trim() === "" ? cls : `${part.text}${/\s$/.test(part.text) ? "" : " "}${cls}` }];
}

export interface CssView {
  // The class the element's styles are in, or null when it has none yet.
  cls: string | null;
  // Other elements of the file that share it.
  sharedWith: number;
}

export function viewOf(info: ElementInfo, code: string, css: string): CssView {
  const cls = ownedClass(info.classes, css);
  return { cls, sharedWith: cls ? Math.max(0, usesOf(code, cls) - 1) : 0 };
}

export interface CssEdit {
  // The files that change, with their new text.
  texts: Record<string, string>;
  selection: number;
  summary: string;
}

// Sets one group (gap, background, ...) on an element, in the stylesheet. A null value takes it away. With a state
// ("hover:", "md:") it is that state's rule that is read and written.
export async function setCssGroup(a: {
  path: string; code: string; start: number; stylesheet: string; css: string;
  groupId: string; value: string | null; modifier?: string; index: TokenIndex;
}): Promise<CssEdit | null> {
  const { path, code, start, stylesheet, css, groupId, value, index } = a;
  const modifier = a.modifier ?? "";
  if (!(modifier in STATES)) throw new CssError(`The state ${modifier} can't be written in CSS`);
  const info = await analyze(path, code, start);
  if (!info) return null;
  if (info.className === "dynamic") throw new CssError(info.dynamicReason ?? "This element's classes are computed, so Motif can't edit its styles.");

  const group = cssGroupById(groupId);
  const names = cssNames(index);
  let cls = ownedClass(info.classes, css);
  const before = cls ? group.fromCss(readDeclarations(css, cls, modifier), names) : null;
  const state = modifier ? `${modifier.replace(/:$/, "")} ` : "";
  const summary = `${info.tag}: ${state}${group.label.toLowerCase()} ${before ?? "none"} → ${value ?? "none"}`;
  if (before === value || (value === null && !cls)) return { texts: {}, selection: start, summary };

  let nextCode = code;
  if (!cls) {
    cls = newClassName(stylesheet, info.tag, code, css);
    nextCode = applyEdits(code, await classEdits(path, code, start, info, cls), start).code;
  }
  const changes = value === null ? group.props.map((p) => [p, null] as [string, null]) : group.toCss(value, names);
  const nextCss = setDeclarations(css, cls, modifier, changes);

  const texts: Record<string, string> = {};
  if (nextCode !== code) texts[path] = nextCode;
  if (nextCss !== css) texts[stylesheet] = nextCss;
  return { texts, selection: start, summary };
}
