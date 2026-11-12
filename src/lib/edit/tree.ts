import { nameOf, parseModule, unwrap, walk, type AnyNode } from "../repo-scan/ast";

// The elements a component renders, as a tree for the layers panel. An element is where it starts in the
// source, the same number the preview reports when one is clicked, so the tree and the preview agree.
export interface TreeNode {
  start: number;
  tag: string;
  // What it says, when it is just text, or a hint of what it is.
  label: string | null;
  // Plain HTML elements can be picked and edited; a component (`<Button />`) is only shown.
  selectable: boolean;
  children: TreeNode[];
}

const tagOf = (el: AnyNode): string => {
  const name = (el.openingElement as AnyNode).name as AnyNode;
  if (name.type === "JSXMemberExpression") return `${nameOf(name.object)}.${nameOf(name.property)}`;
  if (name.type === "JSXNamespacedName") return `${nameOf(name.namespace)}:${nameOf(name.name)}`;
  return nameOf(name) ?? "?";
};

const textLabel = (code: string, el: AnyNode): string | null => {
  const children = el.children as AnyNode[];
  const text = children
    .filter((c) => c.type === "JSXText")
    .map((c) => String(c.value).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return text ? (text.length > 28 ? `${text.slice(0, 27)}…` : text) : null;
};

// Every element below `node`, looking through fragments, conditions and `.map(...)` calls.
function collect(code: string, node: unknown, out: TreeNode[]) {
  walk(node, (n) => {
    if (n.type === "JSXElement") {
      const tag = tagOf(n);
      const children: TreeNode[] = [];
      for (const child of n.children as AnyNode[]) collect(code, child, children);
      out.push({ start: n.start as number, tag, label: textLabel(code, n), selectable: /^[a-z]/.test(tag), children });
      return false;
    }
    // Arrow functions defined as props (render callbacks, handlers) are not part of what is drawn.
    return undefined;
  });
}

const declaresComponent = (stmt: AnyNode, name: string): AnyNode | null => {
  const decl = (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : stmt) as AnyNode | null;
  if (!decl) return null;
  if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && (nameOf(decl.id) === name || name === "default")) return decl;
  if (decl.type === "VariableDeclaration") {
    for (const d of decl.declarations as AnyNode[]) {
      if (nameOf(d.id) === name) return unwrap(d.init as AnyNode | null);
    }
  }
  return null;
};

// The tree of what `component` renders in `code`. Falls back to every element of the file when the component's
// declaration can't be found (a default export of an expression, for example).
export async function elementTree(path: string, code: string, component: string): Promise<TreeNode[]> {
  const program = (await parseModule(code, path)).program as unknown as AnyNode;
  const body = program.body as AnyNode[];
  let root: AnyNode | null = null;
  for (const stmt of body) {
    root = declaresComponent(stmt, component);
    if (root) break;
  }
  const out: TreeNode[] = [];
  collect(code, root ?? program, out);
  return out;
}

// The element at `start` and the elements above it, outermost first, so the tree can open to a selection.
export function pathTo(tree: TreeNode[], start: number): number[] {
  for (const node of tree) {
    if (node.start === start) return [node.start];
    const inner = pathTo(node.children, start);
    if (inner.length) return [node.start, ...inner];
  }
  return [];
}
