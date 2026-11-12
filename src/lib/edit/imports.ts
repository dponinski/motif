import { nameOf, parseModule, type AnyNode } from "../repo-scan/ast";
import type { Edit } from "./patch";

// Making sure a file imports a component it is about to use, in the file's own style.

export interface ImportSpec {
  name: string;
  // The repository path of the module that exports it.
  file: string;
  exported: "named" | "default";
}

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// A module path without its extension, and without a trailing /index, so two spellings of one module compare equal.
const stem = (path: string) => normalize(path).replace(/\.(tsx?|jsx?|mjs)$/, "").replace(/\/index$/, "");

// The specifier to write from one file to another: "../components/Button".
export function relativeSpecifier(from: string, to: string): string {
  const a = dirname(from).split("/").filter(Boolean);
  const b = stem(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  const rest = b.slice(i);
  const spec = [...up, ...rest].join("/");
  return spec.startsWith(".") ? spec : `./${spec}`;
}

export async function importEdits(path: string, code: string, imp: ImportSpec): Promise<{ edits: Edit[]; local: string }> {
  const program = (await parseModule(code, path)).program as unknown as AnyNode;
  const body = program.body as AnyNode[];
  const target = stem(imp.file);

  // Names this file already uses at the top level, so a clash is caught instead of shadowed.
  const taken = new Set<string>();
  const imports = body.filter((s) => s.type === "ImportDeclaration" && s.importKind !== "type");
  for (const stmt of body) {
    if (stmt.type === "ImportDeclaration") for (const spec of stmt.specifiers as AnyNode[]) { const n = nameOf(spec.local); if (n) taken.add(n); }
    const decl = (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : stmt) as AnyNode | null;
    if (decl && (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id) taken.add(nameOf(decl.id)!);
    if (decl?.type === "VariableDeclaration") for (const d of decl.declarations as AnyNode[]) { const n = nameOf(d.id); if (n) taken.add(n); }
  }

  for (const decl of imports) {
    const source = (decl.source as AnyNode).value as string;
    if (!source.startsWith(".") || stem(`${dirname(path)}/${source}`) !== target) continue;
    const specs = decl.specifiers as AnyNode[];
    const have = specs.find((s) => (imp.exported === "default" ? s.type === "ImportDefaultSpecifier" : s.type === "ImportSpecifier" && nameOf(s.imported) === imp.name));
    if (have) return { edits: [], local: nameOf(have.local)! };
    if (imp.exported === "named") {
      const named = specs.filter((s) => s.type === "ImportSpecifier");
      if (named.length) {
        if (taken.has(imp.name)) throw new Error(`${imp.name} is already used in this file for something else`);
        const last = named[named.length - 1];
        return { edits: [{ start: last.end as number, end: last.end as number, text: `, ${imp.name}` }], local: imp.name };
      }
    }
  }

  if (taken.has(imp.name)) throw new Error(`${imp.name} is already used in this file for something else`);
  const first = imports[0];
  const quote = first ? code[(first.source as AnyNode).start as number] : '"';
  const semi = first ? code.slice(first.start as number, first.end as number).trimEnd().endsWith(";") : true;
  const spec = relativeSpecifier(path, imp.file);
  const line = `import ${imp.exported === "default" ? imp.name : `{ ${imp.name} }`} from ${quote}${spec}${quote}${semi ? ";" : ""}`;
  const last = imports[imports.length - 1];
  return last
    ? { edits: [{ start: last.end as number, end: last.end as number, text: `\n${line}` }], local: imp.name }
    : { edits: [{ start: 0, end: 0, text: `${line}\n\n` }], local: imp.name };
}
