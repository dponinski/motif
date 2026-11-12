import { keyName, lineOf, nameOf, sliceOf, typeArgs, unwrap, walk, staticString, type AnyNode } from "./ast";
import type { FileModel, Resolver } from "./model";
import { collectProps } from "./props";
import type { RepoComponent, StylingSystem, Support } from "./types";

export interface ScannedComponent extends Omit<RepoComponent, "support" | "public"> {
  // Name the component is declared under in its file, to match against the package entry's exports.
  local: string;
  classKinds: string[];
}

export interface ScannedFile {
  components: ScannedComponent[];
  // Which styling approaches this file's components use; "class-strings" is utility or plain class names.
  usage: ("class-strings" | StylingSystem)[];
}

const CLASS_HELPERS = new Set(["cn", "clsx", "classnames", "classNames", "twMerge", "twJoin", "cx", "cls", "clsxm", "merge"]);
const HELPER_PACKAGES = new Set(["clsx", "classnames", "tailwind-merge"]);

const isFunction = (n: AnyNode | null): n is AnyNode => n?.type === "ArrowFunctionExpression" || n?.type === "FunctionExpression" || n?.type === "FunctionDeclaration";

function containsJsx(root: AnyNode): boolean {
  let found = false;
  walk(root, (n) => {
    if (found) return false;
    if (n.type === "JSXElement" || n.type === "JSXFragment") found = true;
  });
  return found;
}

const calleeName = (call: AnyNode): string | null => {
  const callee = call.callee as AnyNode;
  if (callee.type === "Identifier") return callee.name as string;
  if (callee.type === "MemberExpression") return nameOf(callee.property);
  return null;
};

interface Found {
  fn: AnyNode;
  wrappers: AnyNode[];
  declarator: AnyNode | null;
}

function componentFunction(model: FileModel, local: string): Found | null {
  const declared = model.functions.get(local);
  if (declared) return { fn: declared, wrappers: [], declarator: null };
  const wrappers: AnyNode[] = [];
  let init = unwrap(model.consts.get(local));
  while (init?.type === "CallExpression") {
    const name = calleeName(init);
    if (name !== "forwardRef" && name !== "memo") return null;
    wrappers.push(init);
    init = unwrap((init.arguments as AnyNode[])[0]);
  }
  return isFunction(init) ? { fn: init!, wrappers, declarator: model.declarators.get(local) ?? null } : null;
}

function propsTypeNode(found: Found): AnyNode | null {
  for (const wrapper of found.wrappers) {
    const args = typeArgs(wrapper);
    const name = calleeName(wrapper);
    if (name === "forwardRef" && args[1]) return args[1];
    if (name === "memo" && args[0]) return args[0];
  }
  const annotation = ((found.declarator?.id as AnyNode | undefined)?.typeAnnotation as { typeAnnotation?: AnyNode } | undefined)?.typeAnnotation;
  if (annotation?.type === "TSTypeReference" && /^(FC|FunctionComponent|VFC)$/.test(nameOf(annotation.typeName) ?? "")) {
    return typeArgs(annotation)[0] ?? null;
  }
  const param = (found.fn.params as AnyNode[] | undefined)?.[0];
  return ((param?.typeAnnotation as { typeAnnotation?: AnyNode } | undefined)?.typeAnnotation) ?? null;
}

function defaultsOf(fn: AnyNode, code: string): Map<string, string> {
  const out = new Map<string, string>();
  const param = (fn.params as AnyNode[] | undefined)?.[0];
  if (param?.type !== "ObjectPattern") return out;
  for (const prop of param.properties as AnyNode[]) {
    const value = prop.type === "ObjectProperty" ? (prop.value as AnyNode) : null;
    const key = prop.type === "ObjectProperty" ? keyName(prop) : null;
    if (!key || value?.type !== "AssignmentPattern") continue;
    const right = value.right as AnyNode;
    out.set(key, right.type === "StringLiteral" || right.type === "NumericLiteral" || right.type === "BooleanLiteral" ? String(right.value) : sliceOf(code, right));
  }
  return out;
}

function hooksOf(fn: AnyNode): string[] {
  const hooks = new Set<string>();
  walk(fn, (n) => {
    if (n.type !== "CallExpression") return;
    const name = calleeName(n);
    if (name && /^use[A-Z]/.test(name)) hooks.add(name);
  });
  return [...hooks].sort();
}

const tagName = (n: AnyNode | null): string | null => {
  if (!n) return null;
  if (n.type === "JSXFragment") return "fragment";
  if (n.type !== "JSXElement") return null;
  const name = (n.openingElement as AnyNode).name as AnyNode;
  if (name.type === "JSXIdentifier") return name.name as string;
  if (name.type === "JSXMemberExpression") return `${nameOf(name.object)}.${nameOf(name.property)}`;
  return null;
};

function jsxRoot(expr: AnyNode | null | undefined): AnyNode | null {
  const n = unwrap(expr);
  if (!n) return null;
  if (n.type === "JSXElement" || n.type === "JSXFragment") return n;
  if (n.type === "ConditionalExpression") return jsxRoot(n.consequent as AnyNode) ?? jsxRoot(n.alternate as AnyNode);
  if (n.type === "LogicalExpression") return jsxRoot(n.right as AnyNode);
  return null;
}

function rootTag(fn: AnyNode): string | null {
  const body = fn.body as AnyNode;
  if (body.type !== "BlockStatement") return tagName(jsxRoot(body));
  let root: AnyNode | null = null;
  walk(body, (node) => {
    if (root) return false;
    if (node !== body && /^(ArrowFunctionExpression|FunctionExpression|FunctionDeclaration)$/.test(node.type)) return false;
    if (node.type === "ReturnStatement") root = jsxRoot(node.argument as AnyNode);
  });
  return tagName(root);
}

// ── How class names are built ─────────────────────────────────────────────────

function classify(expr: AnyNode | null | undefined, m: FileModel, kinds: Set<string>, depth = 0): void {
  const n = unwrap(expr);
  if (!n || depth > 8) return;
  switch (n.type) {
    case "StringLiteral":
      kinds.add("static");
      return;
    case "NullLiteral":
    case "BooleanLiteral":
      return;
    case "JSXExpressionContainer":
      classify(n.expression as AnyNode, m, kinds, depth + 1);
      return;
    case "TemplateLiteral":
      kinds.add("static");
      for (const e of n.expressions as AnyNode[]) classify(e, m, kinds, depth + 1);
      return;
    case "BinaryExpression":
      if (staticString(n, m.consts) !== null) kinds.add("static");
      else { classify(n.left as AnyNode, m, kinds, depth + 1); classify(n.right as AnyNode, m, kinds, depth + 1); }
      return;
    case "Identifier": {
      const name = n.name as string;
      if (name === "undefined") return;
      if (name === "className") { kinds.add("passthrough"); return; }
      if (m.cvas.has(name)) { kinds.add("cva"); return; }
      const init = m.consts.get(name);
      if (init && staticString(init, m.consts) !== null) { kinds.add(`shared:${name}`); return; }
      kinds.add("dynamic");
      return;
    }
    case "CallExpression": {
      const callee = n.callee as AnyNode;
      const name = callee.type === "Identifier" ? (callee.name as string) : null;
      if (!name) { kinds.add("dynamic"); return; }
      if (m.cvas.has(name)) { kinds.add("cva"); return; }
      const binding = m.imports.get(name);
      const init = unwrap(m.consts.get(name));
      if (init?.type === "CallExpression" && calleeName(init) === "bind") { kinds.add("css-module"); return; }
      if (CLASS_HELPERS.has(name) || (binding && HELPER_PACKAGES.has(binding.source))) {
        for (const arg of n.arguments as AnyNode[]) classify(arg, m, kinds, depth + 1);
        return;
      }
      kinds.add("dynamic");
      return;
    }
    case "MemberExpression": {
      const object = n.object as AnyNode;
      const name = object.type === "Identifier" ? (object.name as string) : null;
      if (name && m.cssModuleImports.has(name)) kinds.add("css-module");
      else if (name && m.lookups.has(name)) kinds.add("lookup");
      else kinds.add("dynamic");
      return;
    }
    case "ConditionalExpression":
      kinds.add("conditional");
      classify(n.consequent as AnyNode, m, kinds, depth + 1);
      classify(n.alternate as AnyNode, m, kinds, depth + 1);
      return;
    case "LogicalExpression":
      classify(n.left as AnyNode, m, kinds, depth + 1);
      classify(n.right as AnyNode, m, kinds, depth + 1);
      if (n.operator === "&&") kinds.add("conditional");
      return;
    case "ObjectExpression":
      kinds.add("conditional");
      return;
    case "ArrayExpression":
      for (const e of n.elements as AnyNode[]) classify(e, m, kinds, depth + 1);
      return;
    default:
      kinds.add("dynamic");
  }
}

function classKindsOf(fn: AnyNode, m: FileModel): Set<string> {
  const kinds = new Set<string>();
  walk(fn, (n) => {
    if (n.type !== "JSXAttribute") return;
    const name = nameOf(n.name);
    if (name === "className") classify(n.value as AnyNode, m, kinds);
    else if (name === "style" && n.value) kinds.add("inline-style");
  });
  return kinds;
}

const LABEL: Record<string, string> = {
  tailwind: "Tailwind",
  "css-modules": "CSS modules",
  "styled-components": "styled-components",
  emotion: "Emotion",
  sass: "Sass",
  "vanilla-extract": "vanilla-extract",
  "plain-css": "plain CSS",
};

export function rateSupport(kinds: string[], primary: StylingSystem | null): { level: Support; reasons: string[] } {
  const reasons: string[] = [];
  const has = (kind: string) => kinds.includes(kind);
  const classStrings = kinds.some((k) => k === "static" || k === "cva" || k === "lookup" || k === "conditional" || k.startsWith("shared:"));

  if (has("styled")) reasons.push("Styled with CSS-in-JS, which Motif can't edit yet");
  if (has("css-module")) reasons.push("Styled with CSS modules, which Motif can't edit yet");
  if (classStrings && primary && primary !== "tailwind") reasons.push(`Class names refer to ${LABEL[primary]} styles, which Motif can't edit yet`);
  if (has("dynamic")) reasons.push("Some class names are computed at runtime");
  if (reasons.length) return { level: "view-only", reasons };

  if (has("conditional")) reasons.push("Some classes depend on a condition");
  for (const kind of kinds) if (kind.startsWith("shared:")) reasons.push(`Uses the shared class constant \`${kind.slice(7)}\``);
  if (has("inline-style")) reasons.push("Sets inline styles");
  return { level: reasons.length ? "partial" : "editable", reasons };
}

// ── Per file ──────────────────────────────────────────────────────────────────

function defaultName(local: string, path: string): string {
  if (local !== "default") return local;
  const parts = path.replace(/\.[^.]+$/, "").split("/");
  const base = parts[parts.length - 1] === "index" ? parts[parts.length - 2] ?? "Component" : parts[parts.length - 1];
  return base.replace(/(^|[-_ .])(\w)/g, (_, __, c: string) => c.toUpperCase());
}

// Variant tables and lookup objects imported from other files count as local ones when classifying.
async function importHelpers(model: FileModel, resolver: Resolver): Promise<void> {
  for (const [local, binding] of model.imports) {
    if (model.cvas.has(local) || model.lookups.has(local) || binding.imported === "*") continue;
    if (!/^(\.|@\/|~\/)/.test(binding.source)) continue;
    const found = await resolver.lookup(model, local, (m, l) => m.cvas.get(l) ?? m.lookups.get(l));
    if (!found) continue;
    if (Array.isArray(found.value)) model.lookups.set(local, found.value);
    else model.cvas.set(local, found.value);
  }
}

export async function scanComponentFile(model: FileModel, resolver: Resolver): Promise<ScannedFile> {
  await importHelpers(model, resolver);
  const components: ScannedComponent[] = [];
  const usage = new Set<ScannedFile["usage"][number]>();
  for (const system of model.stylingUsage) usage.add(system);

  for (const [exportName, local] of model.exports) {
    const name = defaultName(exportName === "default" ? local : exportName, model.path);
    if (!/^[A-Z]/.test(name)) continue;
    const exported = exportName === "default" ? "default" : "named";

    const styled = model.styled.get(local);
    if (styled) {
      components.push({
        name, local, file: model.path, line: lineOf(styled.node), exported, root: styled.root,
        props: [], nativeProps: null, variants: [], hooks: [], notes: [], classKinds: ["styled"],
      });
      continue;
    }

    const found = componentFunction(model, local);
    if (!found || !containsJsx(found.fn)) continue;

    const kinds = classKindsOf(found.fn, model);
    if ([...kinds].some((k) => k === "static" || k === "cva" || k === "lookup" || k === "conditional" || k.startsWith("shared:"))) usage.add("class-strings");

    const collected = await collectProps(propsTypeNode(found), model, resolver, defaultsOf(found.fn, model.code));
    const notes = [...collected.notes];
    if (!propsTypeNode(found) && ((found.fn.params as AnyNode[]) ?? []).length > 0) notes.push("No props type found, so props are not listed");

    components.push({
      name, local, file: model.path, line: lineOf(found.declarator ?? found.fn), exported,
      root: rootTag(found.fn),
      props: collected.props, nativeProps: collected.nativeProps, variants: collected.variants,
      hooks: hooksOf(found.fn), notes, classKinds: [...kinds],
    });
  }
  return { components, usage: [...usage] };
}
