import type { File, Node } from "@babel/types";

export type AnyNode = Node & Record<string, unknown>;

export async function parseModule(code: string, path: string): Promise<File> {
  const { parse } = await import("@babel/parser");
  const jsx = /\.[jt]sx$|\.js$/.test(path) && !/\.config\./.test(path);
  return parse(code, { sourceType: "module", plugins: jsx ? ["typescript", "jsx"] : ["typescript"] });
}

const SKIP = new Set(["loc", "start", "end", "range", "extra", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);

const isNode = (v: unknown): v is AnyNode => typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

// Visits every node below `root`. Return false from `visit` to skip that node's children.
export function walk(root: unknown, visit: (node: AnyNode, parent: AnyNode | null) => boolean | void, parent: AnyNode | null = null): void {
  if (Array.isArray(root)) {
    for (const child of root) walk(child, visit, parent);
    return;
  }
  if (!isNode(root)) return;
  if (visit(root, parent) === false) return;
  for (const key of Object.keys(root)) {
    if (!SKIP.has(key)) walk(root[key], visit, root);
  }
}

export const nameOf = (node: unknown): string | null => {
  if (!isNode(node)) return null;
  if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name as string;
  if (node.type === "StringLiteral") return node.value as string;
  if (node.type === "TSQualifiedName") return nameOf(node.right);
  if (node.type === "NumericLiteral") return String(node.value);
  if (node.type === "BooleanLiteral") return String(node.value);
  return null;
};

export const keyName = (prop: AnyNode): string | null => (prop.computed ? null : nameOf(prop.key));

// Babel 8 renamed typeParameters to typeArguments on type references and calls.
export const typeArgs = (node: AnyNode): AnyNode[] => {
  const inst = (node.typeArguments ?? node.typeParameters) as { params?: AnyNode[] } | undefined;
  return inst?.params ?? [];
};

export const unwrap = (node: AnyNode | null | undefined): AnyNode | null => {
  let cur = node ?? null;
  while (cur && (cur.type === "TSAsExpression" || cur.type === "TSSatisfiesExpression" || cur.type === "TSNonNullExpression" || cur.type === "ParenthesizedExpression" || cur.type === "TSTypeAssertion")) {
    cur = cur.expression as AnyNode;
  }
  return cur;
};

export function staticString(node: AnyNode | null | undefined, consts: Map<string, AnyNode>, seen = new Set<string>()): string | null {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === "StringLiteral") return n.value as string;
  if (n.type === "TemplateLiteral" && (n.expressions as unknown[]).length === 0) {
    return (n.quasis as { value: { cooked?: string; raw: string } }[]).map((q) => q.value.cooked ?? q.value.raw).join("");
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const left = staticString(n.left as AnyNode, consts, seen);
    const right = staticString(n.right as AnyNode, consts, seen);
    return left !== null && right !== null ? left + right : null;
  }
  if (n.type === "Identifier") {
    const name = n.name as string;
    const init = consts.get(name);
    if (!init || seen.has(name)) return null;
    return staticString(init, consts, new Set(seen).add(name));
  }
  return null;
}

export const sliceOf = (code: string, node: AnyNode) => code.slice(node.start as number, node.end as number).replace(/\s+/g, " ").trim();

export const lineOf = (node: AnyNode) => ((node.loc as { start: { line: number } } | undefined)?.start.line ?? 0);
