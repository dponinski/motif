import { nameOf, parseModule, typeArgs, unwrap, walk, type AnyNode } from "../repo-scan/ast";
import { context, type EditResult, type FileContext } from "./element";
import { applyEdits, type Edit } from "./patch";

// Editing what a component accepts: the options of a cva variant group, which one is the default, whole new
// groups, and plain props with their defaults. Like every other edit these are text patches on the file; where
// a shape isn't recognised the edit is refused with the reason rather than guessed at.

const IDENT = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(["class", "for", "default", "new", "delete", "function", "return", "var", "let", "const", "if", "else", "switch", "case", "this", "null", "true", "false", "undefined", "key", "ref", "children"]);

const lineStartOf = (code: string, pos: number) => code.lastIndexOf("\n", pos - 1) + 1;
const indentAt = (code: string, pos: number) => code.slice(lineStartOf(code, pos)).match(/^[ \t]*/)![0];
const ownLine = (code: string, start: number, end: number) => {
  const nl = code.indexOf("\n", end);
  return code.slice(lineStartOf(code, start), start).trim() === "" && code.slice(end, nl === -1 ? code.length : nl).replace(/[,;]/g, "").trim() === "";
};

function indentUnit(code: string): string {
  let best = Infinity;
  for (const line of code.split("\n")) {
    if (line.startsWith("\t")) return "\t";
    const n = line.match(/^ +/)?.[0].length ?? 0;
    if (n > 0 && n < best) best = n;
  }
  return " ".repeat(Number.isFinite(best) ? best : 2);
}

const done = (code: string, edits: Edit[], summary: string): EditResult => ({ ...applyEdits(code, edits, null), selection: null, summary });

// A key as it should be written: bare when it can be, quoted when it has to be.
const keyText = (name: string, quote: string) => (IDENT.test(name) ? name : `${quote}${name}${quote}`);

function quoteOf(code: string, node: AnyNode | null | undefined): string {
  const c = node ? code[node.start as number] : undefined;
  return c === "'" || c === '"' || c === "`" ? c : '"';
}

// ── Lists of things between braces ──────────────────────────────────────────────

// Adds an item at the end of an object, an object pattern or a type body, written the way the others are:
// one per line with their indentation and trailing comma, or all on one line.
function appendTo(code: string, container: AnyNode, items: AnyNode[], text: string, sep: "," | ";" = ",", isType = false): Edit {
  const open = container.start as number;
  const close = container.end as number;
  if (items.length === 0) {
    const unit = indentUnit(code);
    const base = indentAt(code, open);
    return { start: open + 1, end: close - 1, text: `\n${base}${unit}${text}${sep === ";" ? ";" : ","}\n${base}` };
  }
  const last = items[items.length - 1];
  const lastEnd = last.end as number;
  const first = items[0];
  const multiline = code.slice(open, first.start as number).includes("\n") || code.slice(lastEnd, close).includes("\n");
  if (isType) {
    // Members of an interface or type literal each end with the file's own separator.
    const after = code.slice(lastEnd, close).match(/^[ \t]*[,;]/);
    const terminated = /[,;]$/.test(code.slice(last.start as number, lastEnd)) || after !== null;
    const at = after ? lastEnd + after[0].length : lastEnd;
    if (!multiline) return { start: at, end: at, text: terminated ? ` ${text}${sep}` : `${sep} ${text}` };
    const indent = code.slice(lineStartOf(code, first.start as number), first.start as number).trim() === "" ? indentAt(code, first.start as number) : indentAt(code, open) + indentUnit(code);
    return { start: at, end: at, text: `${terminated ? "" : sep}\n${indent}${text}${terminated ? sep : ""}` };
  }
  const trailing = code.slice(lastEnd, close).match(/^[ \t]*[,;]/);
  const hasSep = trailing !== null || /[,;]$/.test(code.slice(last.start as number, lastEnd));
  if (!multiline) return { start: lastEnd, end: lastEnd, text: `${sep === ";" ? "; " : ", "}${text}` };
  const indent = code.slice(lineStartOf(code, first.start as number), first.start as number).trim() === "" ? indentAt(code, first.start as number) : indentAt(code, open) + indentUnit(code);
  if (trailing) {
    const at = lastEnd + trailing[0].length;
    return { start: at, end: at, text: `\n${indent}${text}${trailing[0].trim()}` };
  }
  return { start: lastEnd, end: lastEnd, text: `${hasSep ? "" : sep}\n${indent}${text}` };
}

// Takes an item out of its list, with its line, and the comma that belonged to it.
function removeFrom(code: string, container: AnyNode, items: AnyNode[], item: AnyNode): Edit {
  const start = item.start as number;
  let end = item.end as number;
  const after = code.slice(end).match(/^[ \t]*[,;]?/)![0];
  end += after.length;
  if (ownLine(code, start, item.end as number)) {
    const nl = code.indexOf("\n", end);
    return { start: lineStartOf(code, start), end: nl === -1 ? end : nl + 1, text: "" };
  }
  if (items.indexOf(item) === items.length - 1 && items.length > 1) {
    // The last of a line: the comma before it goes instead.
    const before = items[items.length - 2].end as number;
    return { start: before, end: item.end as number, text: "" };
  }
  const space = code.slice(end).match(/^[ \t]*/)![0];
  void container;
  return { start, end: end + space.length, text: "" };
}

// ── cva variants ──────────────────────────────────────────────────────────────

interface Group {
  name: string;
  // The cva variable, e.g. buttonVariants.
  cva: string;
  call: AnyNode;
  config: AnyNode;
  variants: AnyNode;
  prop: AnyNode;
  object: AnyNode;
  defaults: AnyNode | null;
}

const objectProp = (obj: AnyNode | null, name: string): AnyNode | null =>
  obj?.type === "ObjectExpression" ? (obj.properties as AnyNode[]).find((p) => p.type === "ObjectProperty" && !p.computed && nameOf(p.key) === name) ?? null : null;

function findGroup(ctx: FileContext, groupName: string): Group {
  const found: Group[] = [];
  for (const [cva, call] of ctx.cvas) {
    const config = unwrap((call.arguments as AnyNode[])[1] ?? null);
    const variantsProp = objectProp(config, "variants");
    const variants = unwrap(variantsProp?.value as AnyNode | undefined);
    const prop = objectProp(variants, groupName);
    const object = unwrap(prop?.value as AnyNode | undefined);
    if (config && variants?.type === "ObjectExpression" && prop && object?.type === "ObjectExpression") {
      found.push({ name: groupName, cva, call, config, variants, prop, object, defaults: unwrap(objectProp(config, "defaultVariants")?.value as AnyNode | undefined) });
    }
  }
  if (found.length === 0) throw new Error(`There is no variant group called ${groupName} in this file`);
  if (found.length > 1) throw new Error(`${groupName} is a variant group of more than one cva call in this file, so it can't be edited here`);
  return found[0];
}

const options = (g: Group) => (g.object.properties as AnyNode[]).filter((p) => p.type === "ObjectProperty" && !p.computed);
const optionNode = (g: Group, option: string): AnyNode => {
  const node = options(g).find((p) => nameOf(p.key) === option);
  if (!node) throw new Error(`${g.name} has no option called ${option}`);
  return node;
};
const defaultOf = (g: Group): string | null => {
  const v = unwrap(objectProp(g.defaults, g.name)?.value as AnyNode | undefined);
  return v && (v.type === "StringLiteral" || v.type === "BooleanLiteral") ? String(v.value) : null;
};

function checkOptionName(option: string) {
  if (!/^[A-Za-z0-9_$][\w$-]*$/.test(option)) throw new Error(`"${option}" can't be an option name: use letters, numbers, - and _`);
}

// The classes a new option starts with: copied from another option, so it looks the same until it is changed.
function classesOf(code: string, g: Group, from: string | null): string {
  const source = (from && options(g).find((p) => nameOf(p.key) === from)) ?? options(g)[0];
  return source ? code.slice((source.value as AnyNode).start as number, (source.value as AnyNode).end as number) : '""';
}

export async function addVariantOption(path: string, code: string, group: string, option: string, copyFrom: string | null = null): Promise<EditResult> {
  checkOptionName(option);
  const ctx = await context(path, code);
  const g = findGroup(ctx, group);
  if (options(g).some((p) => nameOf(p.key) === option)) throw new Error(`${group} already has an option called ${option}`);
  const quote = quoteOf(code, options(g)[0]?.value as AnyNode | undefined);
  const value = classesOf(code, g, copyFrom ?? defaultOf(g));
  return done(code, [appendTo(code, g.object, options(g), `${keyText(option, quote)}: ${value}`)], `${group}: added option ${option}`);
}

export async function removeVariantOption(path: string, code: string, group: string, option: string): Promise<EditResult> {
  const ctx = await context(path, code);
  const g = findGroup(ctx, group);
  const node = optionNode(g, option);
  if (options(g).length === 1) throw new Error(`${group} needs at least one option`);
  if (defaultOf(g) === option) throw new Error(`${option} is the default for ${group}; choose another default first`);
  return done(code, [removeFrom(code, g.object, options(g), node)], `${group}: removed option ${option}`);
}

export async function renameVariantOption(path: string, code: string, group: string, from: string, to: string): Promise<EditResult> {
  checkOptionName(to);
  const ctx = await context(path, code);
  const g = findGroup(ctx, group);
  const node = optionNode(g, from);
  if (options(g).some((p) => nameOf(p.key) === to)) throw new Error(`${group} already has an option called ${to}`);
  // The name may be used by something else in the file (a lookup table keyed by variant); renaming only here would break it.
  const key = node.key as AnyNode;
  const rest = code.slice(0, key.start as number) + " ".repeat((key.end as number) - (key.start as number)) + code.slice(key.end as number);
  const dflt = objectProp(g.defaults, group);
  const dfltValue = dflt ? (dflt.value as AnyNode) : null;
  const masked = dfltValue && defaultOf(g) === from ? rest.slice(0, dfltValue.start as number) + " ".repeat((dfltValue.end as number) - (dfltValue.start as number)) + rest.slice(dfltValue.end as number) : rest;
  const other = new RegExp(`(["'\`])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1|[{,]\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`).exec(masked);
  if (other) {
    const line = masked.slice(0, other.index).split("\n").length;
    throw new Error(`${from} is also used on line ${line}, so renaming it here would break that`);
  }
  const quote = quoteOf(code, key);
  const edits: Edit[] = [{ start: key.start as number, end: key.end as number, text: IDENT.test(to) ? to : `${quote === "`" ? '"' : quote}${to}${quote === "`" ? '"' : quote}` }];
  if (dfltValue && defaultOf(g) === from) edits.push({ start: dfltValue.start as number, end: dfltValue.end as number, text: `${quoteOf(code, dfltValue)}${to}${quoteOf(code, dfltValue)}` });
  return done(code, edits, `${group}: renamed option ${from} to ${to}`);
}

// Sets which option a group has when none is chosen; null takes the default away.
export async function setVariantDefault(path: string, code: string, group: string, option: string | null): Promise<EditResult> {
  const ctx = await context(path, code);
  const g = findGroup(ctx, group);
  if (option !== null) optionNode(g, option);
  const existing = objectProp(g.defaults, group);
  const quote = quoteOf(code, options(g)[0]?.value as AnyNode | undefined);
  const summary = `${group}: default ${defaultOf(g) ?? "none"} → ${option ?? "none"}`;

  if (existing) {
    if (option === null) {
      const defaults = g.defaults!.properties as AnyNode[];
      // Taking the last default away takes the empty defaultVariants with it.
      const holder = objectProp(g.config, "defaultVariants");
      if (defaults.length === 1 && holder) return done(code, [removeFrom(code, g.config, g.config.properties as AnyNode[], holder)], summary);
      return done(code, [removeFrom(code, g.defaults!, defaults, existing)], summary);
    }
    const value = existing.value as AnyNode;
    return done(code, [{ start: value.start as number, end: value.end as number, text: `${quote}${option}${quote}` }], summary);
  }
  if (option === null) return { code, selection: null, summary };
  if (g.defaults) return done(code, [appendTo(code, g.defaults, g.defaults.properties as AnyNode[], `${keyText(group, quote)}: ${quote}${option}${quote}`)], summary);
  const props = g.config.properties as AnyNode[];
  return done(code, [appendTo(code, g.config, props, `defaultVariants: { ${keyText(group, quote)}: ${quote}${option}${quote} }`)], summary);
}

// ── Where a cva call is used, so a new group can be wired in ────────────────────────────────

function enclosingFunction(ctx: FileContext, node: AnyNode): AnyNode | null {
  for (let cur = ctx.parents.get(node) ?? null; cur; cur = ctx.parents.get(cur) ?? null) {
    if (cur.type === "ArrowFunctionExpression" || cur.type === "FunctionExpression" || cur.type === "FunctionDeclaration") return cur;
  }
  return null;
}

// A destructured parameter gets a new name in front of any ...rest.
function patternEdit(code: string, pattern: AnyNode, text: string): Edit {
  const props = pattern.properties as AnyNode[];
  const rest = props[props.length - 1]?.type === "RestElement" ? props[props.length - 1] : null;
  if (!rest) return appendTo(code, pattern, props, text);
  const before = props.slice(0, -1);
  const multiline = code.slice(pattern.start as number, props[0].start as number).includes("\n");
  if (!multiline) return { start: rest.start as number, end: rest.start as number, text: `${text}, ` };
  const indent = indentAt(code, rest.start as number);
  void before;
  return { start: lineStartOf(code, rest.start as number), end: lineStartOf(code, rest.start as number), text: `${indent}${text},\n` };
}

export async function addVariantGroup(path: string, code: string, cvaName: string, group: string, option: string): Promise<EditResult> {
  if (!IDENT.test(group) || RESERVED.has(group)) throw new Error(`"${group}" can't be a prop name`);
  checkOptionName(option);
  const ctx = await context(path, code);
  const call = ctx.cvas.get(cvaName);
  if (!call) throw new Error(`There is no cva call called ${cvaName} in this file`);
  const config = unwrap((call.arguments as AnyNode[])[1] ?? null);
  const variantsProp = objectProp(config, "variants");
  const variants = unwrap(variantsProp?.value as AnyNode | undefined);
  if (!config || variants?.type !== "ObjectExpression") throw new Error(`${cvaName} has no variants to add a group to`);
  if (objectProp(variants, group)) throw new Error(`${cvaName} already has a group called ${group}`);

  const groups = variants.properties as AnyNode[];
  const quote = quoteOf(code, nameOfFirstValue(groups));
  const unit = indentUnit(code);
  const indent = groups.length ? indentAt(code, groups[0].start as number) : indentAt(code, variants.start as number) + unit;
  const starter = classesStarter(code, groups);
  const body = `${keyText(group, quote)}: {\n${indent}${unit}${keyText(option, quote)}: ${starter},\n${indent}}`;
  const edits: Edit[] = [appendTo(code, variants, groups, body)];

  // Wiring: every place the cva is called passes the new prop, and the component it is called in takes it.
  const sites: AnyNode[] = [];
  walk(ctx.program, (n) => {
    if (n.type === "CallExpression" && (n.callee as AnyNode).type === "Identifier" && (n.callee as AnyNode).name === cvaName) sites.push(n);
  });
  if (sites.length === 0) throw new Error(`${cvaName} isn't called anywhere in this file, so the new group has nothing to be passed to`);
  const patterns = new Set<AnyNode>();
  for (const site of sites) {
    const arg = unwrap((site.arguments as AnyNode[])[0] ?? null);
    if (arg?.type !== "ObjectExpression") throw new Error(`${cvaName} is called without an object of variants, so the new group can't be passed to it`);
    edits.push(appendTo(code, arg, arg.properties as AnyNode[], group));
    const fn = enclosingFunction(ctx, site);
    const param = fn ? ((fn.params as AnyNode[])[0] ?? null) : null;
    const pattern = param?.type === "ObjectPattern" ? param : param?.type === "AssignmentPattern" && (param.left as AnyNode).type === "ObjectPattern" ? (param.left as AnyNode) : null;
    if (!pattern) throw new Error("The component's props aren't destructured, so the new group can't be taken from them");
    if (!(pattern.properties as AnyNode[]).some((p) => p.type === "ObjectProperty" && nameOf(p.key) === group)) patterns.add(pattern);
  }
  for (const pattern of patterns) edits.push(patternEdit(code, pattern, group));
  return done(code, edits, `${cvaName}: added variant group ${group}`);
}

function nameOfFirstValue(groups: AnyNode[]): AnyNode | undefined {
  const first = unwrap(groups[0]?.value as AnyNode | undefined);
  const prop = first?.type === "ObjectExpression" ? (first.properties as AnyNode[])[0] : undefined;
  return prop?.value as AnyNode | undefined;
}

// Classes for the first option of a new group: empty, in the file's quote style.
function classesStarter(code: string, groups: AnyNode[]): string {
  return quoteOf(code, nameOfFirstValue(groups)).repeat(2);
}

// ── Plain props ─────────────────────────────────────────────────────────────────

interface PropsShape {
  fn: AnyNode;
  pattern: AnyNode;
  // The members of the interface or type literal that declares the props, and the braces around them.
  body: AnyNode;
  members: AnyNode[];
  sep: "," | ";";
}

function componentFunction(ctx: FileContext, name: string): { fn: AnyNode; call: AnyNode | null } | null {
  const fnOf = (n: AnyNode | null): { fn: AnyNode; call: AnyNode | null } | null => {
    const u = unwrap(n);
    if (!u) return null;
    if (u.type === "ArrowFunctionExpression" || u.type === "FunctionExpression") return { fn: u, call: null };
    if (u.type === "CallExpression") {
      for (const arg of u.arguments as AnyNode[]) {
        const inner = fnOf(arg);
        if (inner) return { fn: inner.fn, call: inner.call ?? u };
      }
    }
    return null;
  };
  for (const stmt of ctx.program.body as AnyNode[]) {
    const decl = (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : stmt) as AnyNode | null;
    if (decl?.type === "FunctionDeclaration" && decl.id && nameOf(decl.id) === name) return { fn: decl, call: null };
    if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations as AnyNode[]) if (nameOf(d.id) === name) return fnOf(d.init as AnyNode);
    }
  }
  return null;
}

function propsShape(ctx: FileContext, component: string): PropsShape {
  const found = componentFunction(ctx, component);
  if (!found) throw new Error(`Couldn't find a component called ${component} in this file`);
  const param = (found.fn.params as AnyNode[])[0] ?? null;
  const pattern = param?.type === "ObjectPattern" ? param : null;
  if (!pattern) throw new Error(`${component}'s props aren't destructured in its parameters, so they can't be edited here`);

  let type = unwrap((param!.typeAnnotation as AnyNode | undefined)?.typeAnnotation as AnyNode | undefined);
  if (!type && found.call) type = typeArgs(found.call)[1] ?? null;
  if (!type) throw new Error(`${component} has no props type to add to`);

  let body: AnyNode | null = null;
  let members: AnyNode[] = [];
  if (type.type === "TSTypeLiteral") { body = type; members = type.members as AnyNode[]; }
  else if (type.type === "TSTypeReference") {
    const ref = nameOf(type.typeName);
    for (const stmt of ctx.program.body as AnyNode[]) {
      const decl = (stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt) as AnyNode | null;
      if (decl?.type === "TSInterfaceDeclaration" && nameOf(decl.id) === ref) { body = decl.body as AnyNode; members = (decl.body as AnyNode).body as AnyNode[]; }
      else if (decl?.type === "TSTypeAliasDeclaration" && nameOf(decl.id) === ref && (decl.typeAnnotation as AnyNode).type === "TSTypeLiteral") {
        body = decl.typeAnnotation as AnyNode;
        members = (body.members as AnyNode[]);
      }
    }
  }
  if (!body) throw new Error(`${component}'s props type isn't an interface or object type in this file`);
  // The separator is whatever the members already use; a file with one unterminated member gets semicolons.
  let sep: "," | ";" = ";";
  for (const m of members) {
    const own = ctx.code.slice(m.start as number, m.end as number).match(/([,;])$/);
    const next = ctx.code.slice(m.end as number, body.end as number).match(/^[ \t]*([,;])/);
    const found = own?.[1] ?? next?.[1];
    if (found) { sep = found as "," | ";"; break; }
  }
  return { fn: found.fn, pattern, body, members, sep };
}

const memberName = (m: AnyNode) => (m.type === "TSPropertySignature" && !m.computed ? nameOf(m.key) : null);
const patternProp = (p: AnyNode, name: string) => p.type === "ObjectProperty" && !p.computed && nameOf(p.key) === name;

export type PropKind = "string" | "boolean" | "number";

// How a value is written in source for its type; null when it isn't a valid one.
export function literalFor(kind: PropKind, input: string): string | null {
  const text = input.trim();
  if (kind === "boolean") return text === "true" || text === "false" ? text : null;
  if (kind === "number") return text !== "" && Number.isFinite(Number(text)) ? String(Number(text)) : null;
  return JSON.stringify(input);
}

export async function addProp(path: string, code: string, component: string, name: string, kind: PropKind, defaultSource: string | null): Promise<EditResult> {
  if (!IDENT.test(name) || RESERVED.has(name)) throw new Error(`"${name}" can't be a prop name`);
  const ctx = await context(path, code);
  const shape = propsShape(ctx, component);
  if (shape.members.some((m) => memberName(m) === name) || (shape.pattern.properties as AnyNode[]).some((p) => patternProp(p, name))) throw new Error(`${component} already has a prop called ${name}`);
  const optional = defaultSource !== null || true;
  const edits: Edit[] = [appendTo(code, shape.body, shape.members, `${name}${optional ? "?" : ""}: ${kind}`, shape.sep, true)];
  edits.push(patternEdit(code, shape.pattern, defaultSource === null ? name : `${name} = ${defaultSource}`));
  return done(code, edits, `${component}: added prop ${name}`);
}

export async function removeProp(path: string, code: string, component: string, name: string): Promise<EditResult> {
  const ctx = await context(path, code);
  const shape = propsShape(ctx, component);
  const member = shape.members.find((m) => memberName(m) === name);
  if (!member) throw new Error(`${name} isn't declared in ${component}'s own props, so it can't be removed here`);
  const props = shape.pattern.properties as AnyNode[];
  const inPattern = props.find((p) => patternProp(p, name));

  // Still used in the body: removing it would leave a reference to nothing.
  const local = inPattern ? nameOf(((inPattern.value as AnyNode).type === "AssignmentPattern" ? (inPattern.value as AnyNode).left : inPattern.value) as AnyNode) : name;
  let usedAt: number | null = null;
  const body = shape.fn.body as AnyNode;
  walk(body, (n, parent) => {
    if (usedAt !== null) return false;
    if (n.type === "Identifier" && n.name === local && !(parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && parent.property === n && !parent.computed) && !(parent && parent.type === "ObjectProperty" && parent.key === n && !parent.computed && parent.value !== n)) {
      usedAt = code.slice(0, n.start as number).split("\n").length;
    }
  });
  if (usedAt !== null) throw new Error(`${name} is still used on line ${usedAt}; remove that first`);

  const edits: Edit[] = [removeFrom(code, shape.body, shape.members, member)];
  if (inPattern) edits.push(removeFrom(code, shape.pattern, props, inPattern));
  return done(code, edits, `${component}: removed prop ${name}`);
}

// Sets the default a prop has in the component's parameters; null takes it away.
export async function setPropDefault(path: string, code: string, component: string, name: string, defaultSource: string | null): Promise<EditResult> {
  const ctx = await context(path, code);
  const shape = propsShape(ctx, component);
  const prop = (shape.pattern.properties as AnyNode[]).find((p) => patternProp(p, name));
  if (!prop) throw new Error(`${name} isn't taken from ${component}'s props by name, so its default can't be set here`);
  const value = prop.value as AnyNode;
  const summary = `${component}: default of ${name} ${value.type === "AssignmentPattern" ? code.slice((value.right as AnyNode).start as number, (value.right as AnyNode).end as number) : "none"} → ${defaultSource ?? "none"}`;
  if (value.type === "AssignmentPattern") {
    const right = value.right as AnyNode;
    if (defaultSource === null) return done(code, [{ start: (value.left as AnyNode).end as number, end: right.end as number, text: "" }], summary);
    return done(code, [{ start: right.start as number, end: right.end as number, text: defaultSource }], summary);
  }
  if (defaultSource === null) return { code, selection: null, summary };
  return done(code, [{ start: value.end as number, end: value.end as number, text: ` = ${defaultSource}` }], summary);
}

export async function checkParses(path: string, code: string): Promise<void> {
  await parseModule(code, path);
}

// The cva calls in a file, by variable name, to choose which one a new variant group belongs to.
export async function cvaNamesIn(path: string, code: string): Promise<string[]> {
  return [...(await context(path, code)).cvas.keys()];
}
