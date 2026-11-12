import { keyName, nameOf, parseModule, staticString, unwrap, type AnyNode } from "./ast";
import type { RepoSource, StylingSystem } from "./types";

export interface CvaGroup {
  name: string;
  options: string[];
  default: string | null;
}

export interface CvaInfo {
  name: string;
  groups: CvaGroup[];
}

export interface StyledComponent {
  name: string;
  node: AnyNode;
  root: string | null;
}

export interface FileModel {
  path: string;
  code: string;
  imports: Map<string, { source: string; imported: string }>;
  consts: Map<string, AnyNode>;
  declarators: Map<string, AnyNode>;
  functions: Map<string, AnyNode>;
  types: Map<string, AnyNode>;
  cvas: Map<string, CvaInfo>;
  lookups: Map<string, string[]>;
  exports: Map<string, string>;
  reexports: { source: string; names: { imported: string; exported: string }[] | "*" }[];
  cssModuleImports: Set<string>;
  styled: Map<string, StyledComponent>;
  stylingUsage: Set<StylingSystem>;
  // Every module this file imports or re-exports from, in order, including side-effect imports.
  sources: string[];
}

const CSS_MODULE = /\.module\.(css|scss|sass|less)$/;

function objectProp(obj: AnyNode, name: string): AnyNode | null {
  const prop = (obj.properties as AnyNode[]).find((p) => p.type === "ObjectProperty" && keyName(p) === name);
  return unwrap(prop?.value as AnyNode | undefined);
}

const scalar = (node: AnyNode | null): string | null => {
  if (!node) return null;
  if (node.type === "StringLiteral" || node.type === "NumericLiteral" || node.type === "BooleanLiteral") return String(node.value);
  return null;
};

function parseCva(call: AnyNode, name: string, tailwindVariants: boolean): CvaInfo {
  const args = call.arguments as AnyNode[];
  const config = unwrap(tailwindVariants ? args[0] : args[1]);
  const groups: CvaGroup[] = [];
  if (config?.type === "ObjectExpression") {
    const variants = objectProp(config, "variants");
    const defaults = objectProp(config, "defaultVariants");
    if (variants?.type === "ObjectExpression") {
      for (const group of variants.properties as AnyNode[]) {
        const groupName = group.type === "ObjectProperty" ? keyName(group) : null;
        const options = unwrap(group.value as AnyNode);
        if (!groupName || options?.type !== "ObjectExpression") continue;
        const names = (options.properties as AnyNode[]).map((o) => (o.type === "ObjectProperty" ? keyName(o) : null)).filter((n): n is string => n !== null);
        const fallback = defaults?.type === "ObjectExpression"
          ? scalar(objectProp(defaults, groupName))
          : null;
        groups.push({ name: groupName, options: names, default: fallback });
      }
    }
  }
  return { name, groups };
}

function lookupKeys(init: AnyNode): string[] | null {
  const obj = unwrap(init);
  if (obj?.type !== "ObjectExpression") return null;
  const props = obj.properties as AnyNode[];
  if (props.length === 0) return null;
  const keys: string[] = [];
  for (const p of props) {
    const key = p.type === "ObjectProperty" ? keyName(p) : null;
    if (key === null || staticString(p.value as AnyNode, new Map()) === null) return null;
    keys.push(key);
  }
  return keys;
}

function rootOfStyled(node: AnyNode): { local: string; tag: string | null } | null {
  // styled.div`...`, styled(Button)`...`, styled.div<Props>`...`, styled.div({...}), styled(Button)({...})
  let cur: AnyNode | null = node;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.type === "TaggedTemplateExpression") cur = cur.tag as AnyNode;
    else if (cur.type === "CallExpression") {
      const callee = cur.callee as AnyNode;
      if (callee.type === "Identifier") return { local: callee.name as string, tag: nameOf((cur.arguments as AnyNode[])[0]) };
      cur = callee;
    } else if (cur.type === "MemberExpression") {
      const object = cur.object as AnyNode;
      if (object.type === "Identifier") return { local: object.name as string, tag: nameOf(cur.property) };
      cur = object;
    } else return null;
  }
  return null;
}

export function buildModel(path: string, code: string, program: AnyNode[]): FileModel {
  const m: FileModel = {
    path, code,
    imports: new Map(), consts: new Map(), declarators: new Map(), functions: new Map(), types: new Map(),
    cvas: new Map(), lookups: new Map(), exports: new Map(), reexports: [],
    cssModuleImports: new Set(), styled: new Map(), stylingUsage: new Set(), sources: [],
  };
  const addSource = (source: string | null) => {
    if (source && !m.sources.includes(source)) m.sources.push(source);
  };
  const styledLocals = new Set<string>();

  const declare = (stmt: AnyNode): string[] => {
    switch (stmt.type) {
      case "FunctionDeclaration": {
        const name = nameOf(stmt.id);
        if (!name) return [];
        m.functions.set(name, stmt);
        return [name];
      }
      case "ClassDeclaration": {
        const name = nameOf(stmt.id);
        return name ? [name] : [];
      }
      case "VariableDeclaration": {
        const names: string[] = [];
        for (const d of stmt.declarations as AnyNode[]) {
          const name = d.id && (d.id as AnyNode).type === "Identifier" ? nameOf(d.id) : null;
          if (!name || !d.init) continue;
          m.consts.set(name, d.init as AnyNode);
          m.declarators.set(name, d);
          names.push(name);
        }
        return names;
      }
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration": {
        const name = nameOf(stmt.id);
        if (!name) return [];
        m.types.set(name, stmt);
        return [name];
      }
      default:
        return [];
    }
  };

  for (const stmt of program) {
    if (stmt.type === "ImportDeclaration") {
      const source = nameOf(stmt.source) ?? "";
      addSource(source);
      for (const spec of stmt.specifiers as AnyNode[]) {
        const local = nameOf(spec.local);
        if (!local) continue;
        const imported = spec.type === "ImportDefaultSpecifier" ? "default" : spec.type === "ImportNamespaceSpecifier" ? "*" : (nameOf(spec.imported) ?? local);
        m.imports.set(local, { source, imported });
        if (CSS_MODULE.test(source)) m.cssModuleImports.add(local);
        if ((source === "styled-components" || source === "@emotion/styled") && (imported === "default" || imported === "styled")) styledLocals.add(local);
      }
      if (CSS_MODULE.test(source)) m.stylingUsage.add("css-modules");
    } else if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) {
        for (const name of declare(stmt.declaration as AnyNode)) m.exports.set(name, name);
      } else if (stmt.source) {
        addSource(nameOf(stmt.source));
        const names = (stmt.specifiers as AnyNode[])
          .filter((s) => s.type === "ExportSpecifier")
          .map((s) => ({ imported: nameOf(s.local) ?? "", exported: nameOf(s.exported) ?? "" }))
          .filter((n) => n.imported && n.exported);
        m.reexports.push({ source: nameOf(stmt.source) ?? "", names });
      } else {
        for (const s of stmt.specifiers as AnyNode[]) {
          if (s.type !== "ExportSpecifier") continue;
          const local = nameOf(s.local);
          const exported = nameOf(s.exported);
          if (local && exported) m.exports.set(exported, local);
        }
      }
    } else if (stmt.type === "ExportAllDeclaration") {
      addSource(nameOf(stmt.source));
      if (!stmt.exported) m.reexports.push({ source: nameOf(stmt.source) ?? "", names: "*" });
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration as AnyNode;
      if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
        const [name] = declare(decl);
        if (name) m.exports.set("default", name);
        else if (decl.type === "FunctionDeclaration") {
          m.functions.set("default", decl);
          m.exports.set("default", "default");
        }
      } else if (decl.type === "Identifier") {
        m.exports.set("default", decl.name as string);
      } else {
        m.consts.set("default", decl);
        m.exports.set("default", "default");
      }
    } else {
      declare(stmt);
    }
  }

  for (const [name, init] of m.consts) {
    const node = unwrap(init);
    if (node?.type === "CallExpression" && (node.callee as AnyNode).type === "Identifier") {
      const callee = nameOf(node.callee);
      const source = callee ? m.imports.get(callee)?.source : undefined;
      if (callee === "cva" || (source === "class-variance-authority")) m.cvas.set(name, parseCva(node, name, false));
      else if (callee === "tv" || source === "tailwind-variants") m.cvas.set(name, parseCva(node, name, true));
    }
    const keys = node ? lookupKeys(node) : null;
    if (keys) m.lookups.set(name, keys);

    const styled = node && rootOfStyled(node);
    if (styled && styledLocals.has(styled.local)) {
      const source = m.imports.get(styled.local)?.source;
      m.stylingUsage.add(source === "styled-components" ? "styled-components" : "emotion");
      if (/^[A-Z]/.test(name)) m.styled.set(name, { name, node, root: styled.tag });
    }
  }
  return m;
}

// ── Resolver ──────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 300_000;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export class Resolver {
  private models = new Map<string, Promise<FileModel | null>>();

  constructor(private source: RepoSource, private paths: Set<string>, private warnings: string[]) {}

  model(path: string): Promise<FileModel | null> {
    let entry = this.models.get(path);
    if (!entry) {
      entry = this.load(path);
      this.models.set(path, entry);
    }
    return entry;
  }

  private async load(path: string): Promise<FileModel | null> {
    const text = await this.source.readText(path);
    if (text === null) return null;
    if (text.length > MAX_FILE_BYTES) {
      this.warnings.push(`Skipped ${path}: file is larger than ${MAX_FILE_BYTES / 1000} KB`);
      return null;
    }
    try {
      const ast = await parseModule(text, path);
      return buildModel(path, text, ast.program.body as AnyNode[]);
    } catch (err) {
      this.warnings.push(`Could not parse ${path}: ${err instanceof Error ? err.message.split("\n")[0] : "syntax error"}`);
      return null;
    }
  }

  resolve(from: string, spec: string): string | null {
    const bases: string[] = [];
    if (spec.startsWith(".")) bases.push(normalize(`${dirname(from)}/${spec}`));
    else if (spec.startsWith("@/") || spec.startsWith("~/")) bases.push(normalize(`src/${spec.slice(2)}`), normalize(spec.slice(2)));
    else return null;
    for (const base of bases) {
      for (const ext of EXTENSIONS) {
        if (this.paths.has(base + ext)) return base + ext;
      }
    }
    return null;
  }

  // Follows an exported name through re-exports to the file that declares it.
  async findExport(path: string, name: string, depth = 0, seen = new Set<string>()): Promise<{ model: FileModel; local: string } | null> {
    if (depth > 6 || seen.has(`${path}::${name}`)) return null;
    seen.add(`${path}::${name}`);
    const model = await this.model(path);
    if (!model) return null;
    const local = model.exports.get(name);
    if (local !== undefined) {
      const binding = model.imports.get(local);
      if (binding && !model.consts.has(local) && !model.functions.has(local) && !model.types.has(local)) {
        const target = this.resolve(path, binding.source);
        return target ? this.findExport(target, binding.imported, depth + 1, seen) : null;
      }
      return { model, local };
    }
    for (const re of model.reexports) {
      const names = re.names === "*" ? [{ imported: name, exported: name }] : re.names.filter((n) => n.exported === name);
      if (names.length === 0) continue;
      const target = this.resolve(path, re.source);
      if (!target) continue;
      for (const n of names) {
        const found = await this.findExport(target, n.imported, depth + 1, seen);
        if (found) return found;
      }
    }
    return null;
  }

  // Looks a top-level symbol up in a file, following an import of it into another file.
  async lookup<T>(model: FileModel, name: string, pick: (m: FileModel, local: string) => T | undefined): Promise<{ model: FileModel; value: T } | null> {
    const direct = pick(model, name);
    if (direct !== undefined) return { model, value: direct };
    const binding = model.imports.get(name);
    if (!binding) return null;
    const target = this.resolve(model.path, binding.source);
    if (!target) return null;
    const found = await this.findExport(target, binding.imported);
    if (!found) return null;
    const value = pick(found.model, found.local);
    return value === undefined ? null : { model: found.model, value };
  }
}

