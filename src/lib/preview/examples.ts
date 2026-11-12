import type { RepoReader } from "../github";
import { nameOf, parseModule, walk, unwrap, type AnyNode } from "../repo-scan/ast";
import { Resolver } from "../repo-scan/model";
import { isIgnoredPath, readerSource } from "../repo-scan/source";

// Examples: how a repository itself uses its components, taken from its demo, story and example files.
// Each one is a piece of JSX from one of those files, made self-contained so it can be rendered on its
// own: values that only exist while the demo runs (state, props, local variables) are left out.

export interface RepoExample {
  id: string;
  title: string;
  // The file it was taken from and where.
  file: string;
  line: number;
  // A virtual module, placed next to `file` so the relative imports in it still resolve.
  path: string;
  code: string;
  // What was left out, so the preview is honest about not being the demo itself.
  notes: string[];
}

// Examples by component, keyed "file::name" (see componentId).
export type ExampleIndex = Record<string, RepoExample[]>;

export interface ExampleInput {
  reader: RepoReader;
  ref: string;
  paths: string[];
  components: { file: string; name: string }[];
  limits?: { files?: number; perComponent?: number; bytes?: number };
}

const DEFAULTS = { files: 40, perComponent: 8, bytes: 120_000, example: 8_000 };

const EXAMPLE_PATH = /(^|\/)(demo|demos|example|examples|stories|story|playground|docs?)\/|\.(stories|story)\.[jt]sx$/;
const TEST_PATH = /(^|\/)(__tests__|__mocks__|e2e|cypress)\/|\.(test|spec)\.[jt]sx?$/;
const OPEN_LIKE = new Set(["open", "isOpen", "opened", "visible", "show", "expanded"]);
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

export const isExamplePath = (path: string) => /\.[jt]sx$/.test(path) && !isIgnoredPath(path) && EXAMPLE_PATH.test(path) && !TEST_PATH.test(path);

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const isUpper = (name: string) => /^[A-Z]/.test(name);

function patternNames(node: AnyNode | null | undefined, out: Set<string>) {
  if (!node) return;
  switch (node.type) {
    case "Identifier": out.add(node.name as string); break;
    case "ObjectPattern": for (const p of node.properties as AnyNode[]) patternNames(p.type === "RestElement" ? p : (p.value as AnyNode), out); break;
    case "ArrayPattern": for (const e of node.elements as (AnyNode | null)[]) patternNames(e, out); break;
    case "AssignmentPattern": patternNames(node.left as AnyNode, out); break;
    case "RestElement": patternNames(node.argument as AnyNode, out); break;
    case "TSParameterProperty": patternNames(node.parameter as AnyNode, out); break;
  }
}

function isReference(id: AnyNode, parent: AnyNode | null): boolean {
  if (!parent) return true;
  if (parent.type.startsWith("TS")) return false;
  if ((parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && parent.property === id && !parent.computed) return false;
  if ((parent.type === "ObjectProperty" || parent.type === "ObjectMethod" || parent.type === "ClassProperty" || parent.type === "ClassMethod") && parent.key === id && !parent.computed) return false;
  if (parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") return false;
  return true;
}

// Names a piece of code uses that it doesn't declare itself. Scoping is approximate: a name declared anywhere
// inside counts as declared everywhere inside, which is enough for the small JSX pieces this is used on.
export function freeNames(root: AnyNode): Set<string> {
  const bound = new Set<string>();
  const used = new Set<string>();
  walk(root, (node, parent) => {
    if (FUNCTIONS.has(node.type) || node.type === "FunctionDeclaration") {
      for (const p of node.params as AnyNode[]) patternNames(p, bound);
      if (node.id) patternNames(node.id as AnyNode, bound);
    } else if (node.type === "VariableDeclarator") patternNames(node.id as AnyNode, bound);
    else if (node.type === "CatchClause") patternNames(node.param as AnyNode | null, bound);
    else if (node.type === "Identifier") { if (isReference(node, parent)) used.add(node.name as string); }
    else if (node.type === "JSXIdentifier") {
      const name = node.name as string;
      const tag = parent && (parent.type === "JSXOpeningElement" || parent.type === "JSXClosingElement" || (parent.type === "JSXMemberExpression" && parent.object === node));
      if (tag && isUpper(name)) used.add(name);
    }
  });
  for (const name of bound) used.delete(name);
  return used;
}

interface TopLevel {
  node: AnyNode;
  // The statement to copy, without `export`.
  decl: AnyNode;
}

interface ImportBinding {
  decl: AnyNode;
  spec: AnyNode | null;
  source: string;
  imported: string;
}

const slice = (code: string, node: AnyNode) => code.slice(node.start as number, node.end as number);

function apply(code: string, offset: number, edits: { start: number; end: number; text: string }[]): string {
  let out = code;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start - offset) + e.text + out.slice(e.end - offset);
  return out;
}

// Short description of an element for a heading: its plain attributes, or the text it contains.
function describe(el: AnyNode): string {
  const open = el.openingElement as AnyNode;
  const parts: string[] = [];
  for (const attr of open.attributes as AnyNode[]) {
    if (attr.type !== "JSXAttribute") continue;
    const name = nameOf(attr.name);
    if (!name || ["className", "style", "key", "ref", "aria-label"].includes(name) || /^on[A-Z]/.test(name)) continue;
    const value = attr.value as AnyNode | null;
    if (value === null) parts.push(name);
    else if (value.type === "StringLiteral") parts.push(`${name}: ${value.value as string}`);
    else if (value.type === "JSXExpressionContainer") {
      const expr = unwrap(value.expression as AnyNode);
      if (expr && (expr.type === "NumericLiteral" || expr.type === "BooleanLiteral" || expr.type === "StringLiteral")) parts.push(`${name}: ${String(expr.value)}`);
    }
  }
  if (parts.length) return parts.slice(0, 3).join(", ");
  const text = (el.children as AnyNode[]).find((c) => c.type === "JSXText" && String(c.value).trim());
  if (text) {
    const value = String(text.value).replace(/\s+/g, " ").trim();
    return value.length > 28 ? `${value.slice(0, 27)}…` : value;
  }
  return "";
}

interface Occurrence {
  key: string;
  root: AnyNode;
  file: string;
}

export async function findExamples(input: ExampleInput): Promise<ExampleIndex> {
  const { reader, ref } = input;
  const limits = { ...DEFAULTS, ...input.limits };
  const warnings: string[] = [];
  const paths = input.paths.filter((p) => !isIgnoredPath(p));
  const resolver = new Resolver(readerSource(reader, ref), new Set(paths), warnings);
  const wanted = new Set(input.components.map((c) => `${c.file}::${c.name}`));
  const index: ExampleIndex = {};
  const seenIds = new Map<string, Set<string>>();

  for (const file of paths.filter(isExamplePath).slice(0, limits.files)) {
    const code = await reader.readText(file, ref).catch(() => null);
    if (code === null || code.length > limits.bytes) continue;
    let program: AnyNode;
    try { program = (await parseModule(code, file)).program as unknown as AnyNode; } catch { continue; }
    const body = program.body as AnyNode[];

    // What the file imports and declares at the top level.
    const imports = new Map<string, ImportBinding>();
    const topLevel = new Map<string, TopLevel>();
    for (const stmt of body) {
      if (stmt.type === "ImportDeclaration") {
        if (stmt.importKind === "type") continue;
        const source = stmt.source && (stmt.source as AnyNode).value as string;
        for (const spec of stmt.specifiers as AnyNode[]) {
          if (spec.importKind === "type") continue;
          const local = nameOf(spec.local);
          if (!local) continue;
          const imported = spec.type === "ImportDefaultSpecifier" ? "default" : spec.type === "ImportNamespaceSpecifier" ? "*" : nameOf(spec.imported) ?? local;
          imports.set(local, { decl: stmt, spec, source, imported });
        }
        continue;
      }
      const decl = (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : stmt) as AnyNode | null;
      if (!decl) continue;
      if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id) topLevel.set(nameOf(decl.id)!, { node: stmt, decl });
      else if (decl.type === "VariableDeclaration") {
        const names = new Set<string>();
        for (const d of decl.declarations as AnyNode[]) patternNames(d.id as AnyNode, names);
        for (const n of names) topLevel.set(n, { node: stmt, decl });
      }
    }

    // Which imported names are components from the design system.
    const library = new Map<string, string>();
    for (const [local, binding] of imports) {
      if (binding.imported === "*") continue;
      const target = resolver.resolve(file, binding.source);
      if (!target) continue;
      const found = await resolver.findExport(target, binding.imported);
      const key = found ? `${found.model.path}::${found.local}` : null;
      if (key && wanted.has(key)) library.set(local, key);
    }
    if (library.size === 0) continue;

    const parents = new Map<AnyNode, AnyNode | null>();
    const elements: AnyNode[] = [];
    walk(program, (node, parent) => {
      parents.set(node, parent);
      if (node.type === "JSXElement") elements.push(node);
    });

    const tagOf = (el: AnyNode): string | null => {
      const name = (el.openingElement as AnyNode).name as AnyNode;
      return name.type === "JSXIdentifier" ? (name.name as string) : null;
    };
    const topStatementOf = (node: AnyNode): AnyNode | null => {
      let cur: AnyNode | null = node;
      while (cur && parents.get(cur) !== program) cur = parents.get(cur) ?? null;
      return cur;
    };

    // The element to show for a usage: the usage itself, or for parts of a compound component (TabsTrigger)
    // the outermost parent from the same file (Tabs), since a part alone has nothing to render in.
    const occurrences: Occurrence[] = [];
    for (const el of elements) {
      const tag = tagOf(el);
      const key = tag ? library.get(tag) : undefined;
      if (!key) continue;
      const declaring = key.slice(0, key.indexOf("::"));
      let root = el;
      for (let cur = parents.get(el) ?? null; cur; cur = parents.get(cur) ?? null) {
        if (cur.type === "FunctionDeclaration" || cur.type === "Program") break;
        if (cur.type !== "JSXElement") continue;
        const parentKey = library.get(tagOf(cur) ?? "");
        if (parentKey && parentKey.slice(0, parentKey.indexOf("::")) === declaring) root = cur;
      }
      occurrences.push({ key, root, file });
    }

    const built = new Map<AnyNode, RepoExample | null>();
    let counter = 0;
    const ext = file.endsWith(".jsx") ? ".jsx" : ".tsx";

    const build = (root: AnyNode): RepoExample | null => {
      if (!built.has(root)) built.set(root, make(root));
      return built.get(root)!;
    };

    const make = (root: AnyNode): RepoExample | null => {
      const rootStart = root.start as number;
      const rootEnd = root.end as number;
      if (rootEnd - rootStart > limits.example) return null;
      const enclosing = topStatementOf(root);
      const enclosingDecls = new Set<AnyNode>();
      for (const t of topLevel.values()) if (t.node === enclosing) enclosingDecls.add(t.node);

      // Declared inside whatever the example sits in: state, props, loop variables.
      const locals = new Set<string>();
      if (enclosing) {
        walk(enclosing, (n) => {
          if (FUNCTIONS.has(n.type) || n.type === "FunctionDeclaration") for (const p of n.params as AnyNode[]) patternNames(p, locals);
          else if (n.type === "VariableDeclarator") patternNames(n.id as AnyNode, locals);
        });
      }
      // Declared inside the example itself (a map callback's parameter), so they travel with it.
      const inner = new Set<string>();
      walk(root, (n) => {
        if (FUNCTIONS.has(n.type)) for (const p of n.params as AnyNode[]) patternNames(p, inner);
        else if (n.type === "VariableDeclarator") patternNames(n.id as AnyNode, inner);
      });
      const kind = (name: string): "import" | "module" | "local" | "global" => {
        if (inner.has(name)) return "global";
        if (imports.has(name)) return "import";
        const top = topLevel.get(name);
        if (top) return enclosingDecls.has(top.node) ? "local" : "module";
        return locals.has(name) ? "local" : "global";
      };
      const isLocal = (node: AnyNode) => [...freeNames(node)].some((n) => kind(n) === "local");

      const edits: { start: number; end: number; text: string }[] = [];
      const notes = new Set<string>();
      walk(root, (node) => {
        if (node.type === "JSXAttribute" && (node.value as AnyNode | null)?.type === "JSXExpressionContainer") {
          const name = nameOf(node.name) ?? "";
          const expr = unwrap((node.value as AnyNode).expression as AnyNode);
          if (!expr || expr.type === "JSXEmptyExpression") return;
          const container = node.value as AnyNode;
          if (FUNCTIONS.has(expr.type)) {
            if (/^on[A-Z]/.test(name)) {
              edits.push({ start: container.start as number, end: container.end as number, text: "{() => {}}" });
              return false;
            }
            if (isLocal(expr)) {
              edits.push({ start: container.start as number, end: container.end as number, text: "{() => null}" });
              notes.add(`${name} left empty`);
              return false;
            }
            return;
          }
          // JSX passed as a prop (footer={<>...</>}) is kept, and what is inside it is cleaned in turn.
          if (expr.type === "JSXElement" || expr.type === "JSXFragment") {
            let needsLocal = false;
            walk(expr, (n) => {
              if (n.type === "JSXOpeningElement" && (n.name as AnyNode).type === "JSXIdentifier" && isUpper((n.name as AnyNode).name as string) && kind((n.name as AnyNode).name as string) === "local") needsLocal = true;
            });
            if (!needsLocal) return;
            edits.push({ start: node.start as number, end: node.end as number, text: "" });
            notes.add(`${name} uses a component defined in the demo`);
            return false;
          }
          if (isLocal(expr)) {
            if (OPEN_LIKE.has(name)) edits.push({ start: container.start as number, end: container.end as number, text: "{true}" });
            else {
              edits.push({ start: node.start as number, end: node.end as number, text: "" });
              notes.add(`${name} comes from the demo's state`);
            }
            return false;
          }
          return;
        }
        if (node.type === "JSXSpreadAttribute" && isLocal(node.argument as AnyNode)) {
          edits.push({ start: node.start as number, end: node.end as number, text: "" });
          notes.add("props spread from the demo's state");
          return false;
        }
        if (node.type === "JSXExpressionContainer") {
          const parent = parents.get(node);
          if (parent && (parent.type === "JSXElement" || parent.type === "JSXFragment")) {
            const expr = node.expression as AnyNode;
            if (expr.type !== "JSXEmptyExpression" && isLocal(expr)) {
              edits.push({ start: node.start as number, end: node.end as number, text: "" });
              notes.add("content that comes from the demo's state");
              return false;
            }
          }
        }
      });

      // A component the demo defines inside itself can't be reproduced, unless that part was left out anyway.
      let unusable = false;
      walk(root, (node) => {
        if (node.type !== "JSXOpeningElement") return;
        const name = node.name as AnyNode;
        const start = node.start as number;
        if (name.type === "JSXIdentifier" && isUpper(name.name as string) && kind(name.name as string) === "local" && !edits.some((e) => e.start <= start && start < e.end)) unusable = true;
      });
      if (unusable) return null;

      const jsx = apply(code.slice(rootStart, rootEnd), rootStart, edits);

      // Top-level helpers the example uses (a Section wrapper, a list of swatches), with theirs in turn.
      const included = new Map<AnyNode, string>();
      const needed = new Set<string>();
      const gather = (node: AnyNode) => {
        for (const name of freeNames(node)) {
          const top = topLevel.get(name);
          if (kind(name) === "import") needed.add(name);
          else if (top && kind(name) === "module" && !included.has(top.node)) {
            if (included.size >= 10) continue;
            included.set(top.node, slice(code, top.decl));
            gather(top.decl);
          }
        }
      };
      gather(root);

      // Only imports the example uses, so an unrelated import in the demo can't break it.
      const importLines: string[] = [];
      const byDecl = new Map<AnyNode, ImportBinding[]>();
      for (const [local, b] of imports) if (needed.has(local)) byDecl.set(b.decl, [...(byDecl.get(b.decl) ?? []), b]);
      for (const stmt of body) {
        if (stmt.type !== "ImportDeclaration") continue;
        const used = byDecl.get(stmt);
        const source = (stmt.source as AnyNode).value as string;
        if (!used) {
          // `import "./demo.css"`: the demo's own styles still apply.
          if ((stmt.specifiers as AnyNode[]).length === 0 && /\.css$/.test(source) && source.startsWith(".")) importLines.push(slice(code, stmt));
          continue;
        }
        const def = used.find((u) => u.spec?.type === "ImportDefaultSpecifier");
        const ns = used.find((u) => u.spec?.type === "ImportNamespaceSpecifier");
        const named = used.filter((u) => u.spec?.type === "ImportSpecifier").map((u) => slice(code, u.spec!));
        const clauses = [def && nameOf(def.spec!.local), ns && `* as ${nameOf(ns.spec!.local)}`, named.length ? `{ ${named.join(", ")} }` : null].filter(Boolean);
        importLines.push(`import ${clauses.join(", ")} from ${JSON.stringify(source)};`);
      }

      const line = (root.loc as { start: { line: number } }).start.line;
      const path = `${dirname(file)}${dirname(file) ? "/" : ""}__motif_example_${counter++}${ext}`;
      const rootTag = tagOf(root) ?? "Example";
      const detail = describe(root);
      const module = [
        importLines.join("\n"),
        [...included.values()].join("\n\n"),
        `export default function MotifExample() {\n  return (\n    ${jsx}\n  );\n}\n`,
      ].filter(Boolean).join("\n\n");
      return { id: `${file}:${line}`, title: detail ? `${rootTag} · ${detail}` : rootTag, file, line, path, code: module, notes: [...notes] };
    };

    for (const occ of occurrences) {
      const example = build(occ.root);
      if (!example) continue;
      const ids = seenIds.get(occ.key) ?? new Set<string>();
      seenIds.set(occ.key, ids);
      const list = (index[occ.key] ??= []);
      // The same demo piece can be reached from several usages of one component.
      if (ids.has(example.id) || ids.has(`code:${example.code}`) || list.length >= limits.perComponent) continue;
      ids.add(example.id);
      ids.add(`code:${example.code}`);
      list.push(example);
    }
  }
  return index;
}
