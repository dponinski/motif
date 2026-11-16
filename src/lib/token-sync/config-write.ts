import { keyName, parseModule, unwrap, type AnyNode } from "../repo-scan/ast";
import { configTheme, objectOf, property } from "../repo-scan/tokens";

// Changing a Tailwind 3 config in place. The file is parsed to find where a value is, and the text is spliced there: nothing is printed
// again, so the formatting, the comments and the quotes the repository uses stay exactly as they are.

export interface ConfigSet {
  // From `theme` (or `theme.extend`): the section and the keys to the value, as the scanner recorded them.
  path: string[];
  inExtend: boolean;
  // What the literal holds.
  value: string;
  // Which token it is, for saying why it couldn't be done.
  token: string;
}

export interface ConfigSkip {
  token: string;
  reason: string;
}

export interface ConfigResult {
  code: string;
  skipped: ConfigSkip[];
}

const quoteOf = (code: string, node: AnyNode) => (code[node.start as number] === "'" ? "'" : '"');
const escapeIn = (value: string, quote: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").split(quote).join(`\\${quote}`);

// The text that makes `node` hold `value`, in the notation `node` is written in.
function literal(code: string, node: AnyNode, value: string): string | null {
  if (node.type === "StringLiteral") { const q = quoteOf(code, node); return `${q}${escapeIn(value, q)}${q}`; }
  if (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0) return `\`${value.replace(/[`\\]|\$\{/g, (m) => `\\${m}`)}\``;
  if (node.type === "NumericLiteral") return /^-?\d+(\.\d+)?$/.test(value) ? value : `"${escapeIn(value, '"')}"`;
  return null;
}

// The property that `path` leads to, or why it can't be found.
export function findInConfig(ast: { program: { body: unknown[] } }, path: string[], inExtend: boolean): { prop: AnyNode } | { reason: string } {
  const { theme, consts } = configTheme(ast);
  if (!theme) return { reason: "The config has no theme any more" };
  let object: AnyNode | null = inExtend ? objectOf(property(theme, "extend") ?? null, consts) : theme;
  for (let i = 0; i < path.length; i++) {
    if (!object) return { reason: "The config changed since it was read" };
    const prop = (object.properties as AnyNode[]).find((p) => p.type === "ObjectProperty" && keyName(p) === path[i]);
    if (!prop) return { reason: "The config changed since it was read" };
    if (i === path.length - 1) return { prop };
    object = unwrap(prop.value as AnyNode)?.type === "ObjectExpression" ? unwrap(prop.value as AnyNode) : null;
  }
  return { reason: "The config changed since it was read" };
}

export async function editConfig(code: string, file: string, sets: ConfigSet[]): Promise<ConfigResult> {
  const skipped: ConfigSkip[] = [];
  let ast;
  try {
    ast = await parseModule(code, file);
  } catch {
    return { code, skipped: sets.map((s) => ({ token: s.token, reason: `${file} couldn't be read` })) };
  }
  const edits: { start: number; end: number; text: string }[] = [];
  for (const set of sets) {
    const found = findInConfig(ast, set.path, set.inExtend);
    if ("reason" in found) { skipped.push({ token: set.token, reason: found.reason }); continue; }
    const node = unwrap(found.prop.value as AnyNode);
    const text = node && literal(code, node, set.value);
    if (!node || text === null) { skipped.push({ token: set.token, reason: "Its value in the config is computed, not written out" }); continue; }
    edits.push({ start: node.start as number, end: node.end as number, text });
  }
  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { code: out, skipped };
}

// ── New entries ───────────────────────────────────────────────────────────────

export interface ConfigAdd {
  // `theme.extend.<section>.<key> = value`
  section: string;
  key: string;
  value: string;
  token: string;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
const keyText = (key: string) => (IDENT.test(key) ? key : `"${escapeIn(key, '"')}"`);
const lineStart = (code: string, at: number) => code.lastIndexOf("\n", at - 1) + 1;
const indentAt = (code: string, at: number) => /^[ \t]*/.exec(code.slice(lineStart(code, at)))![0];
const INDENT_STEP = "  ";

// Puts `key: value` at the end of an object's properties, in the layout the object already has (a trailing comma stays, or not).
function insertProperty(code: string, object: AnyNode, entry: string): { at: number; text: string } {
  const props = object.properties as AnyNode[];
  if (props.length === 0) {
    const open = object.start as number;
    const indent = indentAt(code, open) + INDENT_STEP;
    return { at: (object.end as number) - 1, text: `\n${indent}${entry},\n${indentAt(code, open)}` };
  }
  const last = props[props.length - 1];
  const end = last.end as number;
  const indent = indentAt(code, last.start as number);
  const rest = code.slice(end, object.end as number);
  // A comma after the last property is kept after the new one.
  const trailing = /^\s*,/.exec(rest);
  if (trailing) return { at: end + trailing[0].length, text: `\n${indent}${entry},` };
  return { at: end, text: `,\n${indent}${entry}` };
}

// New entries in `theme.extend`, each in its section (made when the config has none). One entry is written once; a key that is there
// already is left alone and reported.
export async function addToConfig(code: string, file: string, adds: ConfigAdd[]): Promise<ConfigResult> {
  const skipped: ConfigSkip[] = [];
  let out = code;
  // One entry at a time, parsing again after each, so the positions are always those of the text as it is.
  for (const add of adds) {
    let ast;
    try {
      ast = await parseModule(out, file);
    } catch {
      skipped.push({ token: add.token, reason: `${file} couldn't be read` });
      continue;
    }
    const { theme, consts } = configTheme(ast);
    if (!theme) { skipped.push({ token: add.token, reason: "The config has no theme to add it to" }); continue; }
    const entry = `${keyText(add.key)}: "${escapeIn(add.value, '"')}"`;
    const extendNode = property(theme, "extend");
    const extend = extendNode ? objectOf(extendNode, consts) : null;
    if (extendNode && !extend) { skipped.push({ token: add.token, reason: "Its theme.extend is built in a way Motif can't add to" }); continue; }
    let edit: { at: number; text: string };
    if (!extend) {
      edit = insertProperty(out, theme, `extend: {\n${indentAt(out, theme.start as number) + INDENT_STEP + INDENT_STEP}${add.section}: {\n${indentAt(out, theme.start as number) + INDENT_STEP.repeat(3)}${entry},\n${indentAt(out, theme.start as number) + INDENT_STEP + INDENT_STEP}},\n${indentAt(out, theme.start as number) + INDENT_STEP}}`);
    } else {
      const sectionNode = property(extend, add.section);
      const section = sectionNode ? objectOf(sectionNode, consts) : null;
      if (sectionNode && !section) { skipped.push({ token: add.token, reason: `Its ${add.section} in the config are built in a way Motif can't add to` }); continue; }
      if (!section) {
        const base = indentAt(out, extend.start as number) + INDENT_STEP;
        edit = insertProperty(out, extend, `${add.section}: {\n${base + INDENT_STEP}${entry},\n${base}}`);
      } else {
        if ((section.properties as AnyNode[]).some((p) => p.type === "ObjectProperty" && keyName(p) === add.key)) { skipped.push({ token: add.token, reason: `The config has ${add.key} in ${add.section} already` }); continue; }
        edit = insertProperty(out, section, entry);
      }
    }
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  }
  return { code: out, skipped };
}

// ── Renaming an entry ─────────────────────────────────────────────────────────

const DEFAULT_KEY = "DEFAULT";

export interface ConfigMove {
  // Where the entry is (as the scanner recorded it), and the class value it gives (`primary`, `muted-foreground`, `md`) before and after.
  path: string[];
  inExtend: boolean;
  classFrom: string;
  classTo: string;
}

// Takes a property out of an object: its own line when it has one (with its comma), or just it and the comma next to it when it shares one.
function removeProperty(code: string, object: AnyNode, prop: AnyNode): { start: number; end: number } {
  const props = object.properties as AnyNode[];
  const at = props.indexOf(prop);
  const start = lineStart(code, prop.start as number);
  if (/^\s*$/.test(code.slice(start, prop.start as number))) {
    const rest = /^[ \t]*,?[ \t]*\n?/.exec(code.slice(prop.end as number))![0];
    return { start, end: (prop.end as number) + rest.length };
  }
  const next = props[at + 1];
  if (next) return { start: prop.start as number, end: next.start as number };
  return { start: props[at - 1].end as number, end: prop.end as number };
}

// Renames the entry that gives a class its name, as the entry can be renamed without changing the class names of the others:
//  - a flat entry (`md: …`) or a leaf kept in its group (`primary.foreground` to `primary.fg`) has its key changed;
//  - the DEFAULT of a group that has nothing else in it takes the group's key; one that shares the group (`primary: { DEFAULT, foreground }`)
//    is taken out of it and put beside it, so the others keep their names.
export async function renameConfigEntry(code: string, file: string, move: ConfigMove): Promise<{ code: string } | { refused: string }> {
  let ast;
  try {
    ast = await parseModule(code, file);
  } catch {
    return { refused: `${file} couldn't be read` };
  }
  const found = findInConfig(ast, move.path, move.inExtend);
  if ("reason" in found) return { refused: found.reason };
  const { prop } = found;
  const keys = move.path.slice(1);
  const leaf = keys[keys.length - 1];
  const { theme, consts } = configTheme(ast);
  const extend = move.inExtend && theme ? objectOf(property(theme, "extend") ?? null, consts) : theme;
  const sectionNode = extend && property(extend, move.path[0]);
  const section = sectionNode ? objectOf(sectionNode, consts) : null;
  if (!section) return { refused: "The config changed since it was read" };
  const sameName = (o: AnyNode, key: string) => (o.properties as AnyNode[]).some((p) => p.type === "ObjectProperty" && keyName(p) === key && p !== prop);
  const replaceKey = (target: AnyNode, key: string) => {
    const k = target.key as AnyNode;
    if (target.computed || target.shorthand || (k.type !== "Identifier" && k.type !== "StringLiteral" && k.type !== "NumericLiteral")) return null;
    return code.slice(0, k.start as number) + keyText(key) + code.slice(k.end as number);
  };

  // A flat entry.
  if (keys.length === 1 && leaf !== DEFAULT_KEY) {
    if (sameName(section, move.classTo)) return { refused: `The config has ${move.classTo} in ${move.path[0]} already` };
    const out = replaceKey(prop, move.classTo);
    return out === null ? { refused: "Its key in the config is written in a way Motif can't change" } : { code: out };
  }
  // A leaf of a group.
  if (leaf !== DEFAULT_KEY) {
    const group = keys.slice(0, -1).join("-");
    if (!move.classTo.startsWith(`${group}-`)) return { refused: `It is ${leaf} in the ${group} group of the config, so its name has to keep starting with ${group}-` };
    const parent = findInConfig(ast, move.path.slice(0, -1), move.inExtend);
    const groupObject = "prop" in parent ? unwrap(parent.prop.value as AnyNode) : null;
    const key = move.classTo.slice(group.length + 1);
    if (groupObject?.type === "ObjectExpression" && sameName(groupObject, key)) return { refused: `The ${group} group in the config has ${key} already` };
    const out = replaceKey(prop, key);
    return out === null ? { refused: "Its key in the config is written in a way Motif can't change" } : { code: out };
  }
  // A DEFAULT.
  if (keys.length !== 2) return { refused: "It is nested too deeply in the config for Motif to rename" };
  const groupFound = findInConfig(ast, move.path.slice(0, -1), move.inExtend);
  if ("reason" in groupFound) return { refused: groupFound.reason };
  const groupProp = groupFound.prop;
  const groupObject = unwrap(groupProp.value as AnyNode);
  if (groupObject?.type !== "ObjectExpression") return { refused: "The config changed since it was read" };
  if (sameName(section, move.classTo)) return { refused: `The config has ${move.classTo} in ${move.path[0]} already` };
  if ((groupObject.properties as AnyNode[]).length === 1) {
    const out = replaceKey(groupProp, move.classTo);
    return out === null ? { refused: "Its key in the config is written in a way Motif can't change" } : { code: out };
  }
  // Out of the group, and beside it: first the new entry after the group, then the old one is removed (the later position goes first).
  const valueText = code.slice(prop.value ? (prop.value as AnyNode).start as number : 0, (prop.value as AnyNode).end as number);
  const entry = `${keyText(move.classTo)}: ${valueText}`;
  const removal = removeProperty(code, groupObject, prop);
  const groupEnd = groupProp.end as number;
  const trailing = /^\s*,/.exec(code.slice(groupEnd, section.end as number));
  const indent = indentAt(code, groupProp.start as number);
  const insertAt = trailing ? groupEnd + trailing[0].length : groupEnd;
  const insertion = trailing ? `\n${indent}${entry},` : `,\n${indent}${entry}`;
  // The removal is inside the group, so it comes before the insertion, which is after it.
  return { code: code.slice(0, removal.start) + code.slice(removal.end, insertAt) + insertion + code.slice(insertAt) };
}
