import { keyName, lineOf, nameOf, parseModule, staticString, unwrap, type AnyNode } from "./ast";
import { isColorValue } from "./summary";
import type { RepoToken, RepoTokenKind, TokenContainer } from "./types";

export const BASE = "base";

export interface TokenFile {
  path: string;
  text: string;
}

export interface TokenAccumulator {
  tokens: Map<string, RepoToken>;
  aliases: { tailwind: string; target: string; file: string; line: number; value: string }[];
}

export const newAccumulator = (): TokenAccumulator => ({ tokens: new Map(), aliases: [] });

const NAMESPACES: [RegExp, RepoTokenKind][] = [
  [/^color-/, "color"],
  [/^font-(weight|size|style|variant)/, "other"],
  [/^font-/, "font"],
  [/^radius(-|$)/, "radius"],
  [/^(shadow|inset-shadow|drop-shadow)-/, "shadow"],
  [/^spacing(-|$)/, "spacing"],
];

const namespaceKind = (name: string): RepoTokenKind | null => NAMESPACES.find(([re]) => re.test(name))?.[1] ?? null;


function kindOf(name: string, value: string): RepoTokenKind {
  const n = name.toLowerCase();
  const fromNamespace = namespaceKind(n);
  if (fromNamespace) return fromNamespace;
  if (/(^|-)(radius|rounded)(-|$)/.test(n)) return "radius";
  if (/shadow/.test(n)) return "shadow";
  if (/^font(-family)?(-|$)/.test(n) && !/-(size|weight|style|variant)/.test(n)) return "font";
  if (/^(space|spacing|gap)(-|$)/.test(n)) return "spacing";
  return isColorValue(value) ? "color" : "other";
}

function put(acc: TokenAccumulator, token: { name: string; theme: string; value: string; file: string; line: number; container: TokenContainer; tailwind?: string | null; kind?: RepoTokenKind }) {
  const location = { file: token.file, line: token.line, container: token.container };
  const existing = acc.tokens.get(token.name);
  if (existing) {
    existing.values[token.theme] = token.value;
    existing.locations[token.theme] = location;
    return;
  }
  acc.tokens.set(token.name, {
    name: token.name,
    kind: token.kind ?? kindOf(token.name, token.value),
    values: { [token.theme]: token.value },
    locations: { [token.theme]: location },
    tailwind: token.tailwind ?? null,
    file: token.file,
    line: token.line,
  });
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const THEME_ATTR = /\[data-(?:theme|mode|color-scheme|color-mode)\s*[~|^$*]?=\s*["']?([\w-]+)["']?\]/i;

export function themeOfSelector(selector: string): string | null {
  const themes = new Set<string>();
  for (const raw of selector.split(",")) {
    const sel = raw.trim().replace(/:not\([^)]*\)/g, "").replace(/:where\(([^)]*)\)/g, "$1");
    if (!sel) continue;
    if (/\.(dark|theme-dark|dark-theme|dark-mode)\b/.test(sel)) { themes.add("dark"); continue; }
    const attr = sel.match(THEME_ATTR);
    if (attr) { themes.add(attr[1].toLowerCase() === "light" ? BASE : attr[1]); continue; }
    const cls = sel.match(/\.(?:theme|mode)-([\w-]+)\b/);
    if (cls) { themes.add(cls[1] === "light" ? BASE : cls[1]); continue; }
    if (/^(:root|html|body|:host|\*|\.light)$/.test(sel)) themes.add(BASE);
  }
  if (themes.has(BASE)) return BASE;
  return themes.values().next().value ?? null;
}

interface PostcssNode {
  type: string;
  selector?: string;
  name?: string;
  params?: string;
  parent?: PostcssNode;
}

export async function scanCss(files: TokenFile[], acc: TokenAccumulator, warnings: string[]): Promise<void> {
  const { parse } = await import("postcss");
  for (const file of files) {
    let root;
    try {
      root = parse(file.text, { from: file.path });
    } catch (err) {
      warnings.push(`Could not read ${file.path}: ${err instanceof Error ? err.message.split("\n")[0] : "invalid CSS"}`);
      continue;
    }
    root.walkDecls((decl) => {
      if (!decl.prop.startsWith("--") || decl.prop.startsWith("--tw-")) return;
      const value = decl.value.trim();
      if (!value) return;
      const name = decl.prop.slice(2);
      const line = decl.source?.start?.line ?? 0;

      let inTheme = false;
      let darkMedia = false;
      let selectorTheme: string | null | undefined;
      for (let node = decl.parent as PostcssNode | undefined; node; node = node.parent) {
        if (node.type === "atrule" && node.name === "theme") inTheme = true;
        else if (node.type === "atrule" && node.name === "media" && /prefers-color-scheme:\s*dark/.test(node.params ?? "")) darkMedia = true;
        else if (node.type === "rule" && selectorTheme === undefined) selectorTheme = themeOfSelector(node.selector ?? "");
      }

      if (inTheme) {
        const target = value.match(/^var\(\s*--([\w-]+)/)?.[1];
        if (target) acc.aliases.push({ tailwind: name, target, file: file.path, line, value });
        else put(acc, { name, theme: BASE, value, file: file.path, line, container: "theme", tailwind: name });
        return;
      }
      if (!selectorTheme) return;
      put(acc, { name, theme: darkMedia && selectorTheme === BASE ? "dark" : selectorTheme, value, file: file.path, line, container: "css-var" });
    });
  }
}

// ── Tailwind v3 config ────────────────────────────────────────────────────────

const V3_SECTIONS: Record<string, RepoTokenKind> = {
  colors: "color", borderRadius: "radius", boxShadow: "shadow", fontFamily: "font", spacing: "spacing",
};
const V3_PREFIX: Record<string, string> = {
  colors: "color", borderRadius: "radius", boxShadow: "shadow", fontFamily: "font", spacing: "spacing",
};

function literalValue(node: AnyNode | null, consts: Map<string, AnyNode>): string | null {
  const n = unwrap(node);
  if (!n) return null;
  const str = staticString(n, consts);
  if (str !== null) return str;
  if (n.type === "NumericLiteral") return String(n.value);
  if (n.type === "ArrayExpression") {
    const parts = (n.elements as AnyNode[]).map((e) => literalValue(e, consts));
    return parts.every((p) => p !== null) ? parts.join(", ") : null;
  }
  return null;
}

function objectOf(node: AnyNode | null, consts: Map<string, AnyNode>, depth = 0): AnyNode | null {
  const n = unwrap(node);
  if (!n || depth > 4) return null;
  if (n.type === "ObjectExpression") return n;
  if (n.type === "Identifier") return objectOf(consts.get(n.name as string) ?? null, consts, depth + 1);
  if (n.type === "CallExpression") return objectOf((n.arguments as AnyNode[])[0] ?? null, consts, depth + 1);
  return null;
}

const property = (obj: AnyNode, name: string) =>
  (obj.properties as AnyNode[]).find((p) => p.type === "ObjectProperty" && keyName(p) === name)?.value as AnyNode | undefined;

export async function scanTailwindConfig(file: TokenFile, acc: TokenAccumulator, warnings: string[]): Promise<void> {
  let ast;
  try {
    ast = await parseModule(file.text, file.path);
  } catch {
    warnings.push(`Could not read ${file.path}`);
    return;
  }
  const consts = new Map<string, AnyNode>();
  let exported: AnyNode | null = null;
  for (const stmt of ast.program.body as AnyNode[]) {
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations as AnyNode[]) if (nameOf(d.id) && d.init) consts.set(nameOf(d.id)!, d.init as AnyNode);
    } else if (stmt.type === "ExportDefaultDeclaration") {
      exported = stmt.declaration as AnyNode;
    } else if (stmt.type === "ExpressionStatement") {
      const e = stmt.expression as AnyNode;
      const left = e.type === "AssignmentExpression" ? (e.left as AnyNode) : null;
      if (left?.type === "MemberExpression" && nameOf(left.object) === "module") exported = e.right as AnyNode;
    }
  }
  const config = objectOf(exported, consts);
  const theme = config && objectOf(property(config, "theme") ?? null, consts);
  if (!theme) return;

  const collect = (section: AnyNode | null, key: string) => {
    const root = objectOf(section, consts);
    if (!root) return;
    const visit = (obj: AnyNode, path: string[]) => {
      for (const prop of obj.properties as AnyNode[]) {
        if (prop.type !== "ObjectProperty") continue;
        const k = keyName(prop);
        if (k === null) continue;
        const next = k === "DEFAULT" ? path : [...path, k];
        const value = prop.value as AnyNode;
        const nested = unwrap(value)?.type === "ObjectExpression" ? unwrap(value)! : null;
        if (nested) { visit(nested, next); continue; }
        const text = literalValue(value, consts);
        if (text === null || next.length === 0) continue;
        const name = `${V3_PREFIX[key]}-${next.join("-")}`;
        put(acc, { name, theme: BASE, value: text, file: file.path, line: lineOf(prop), container: "config", tailwind: name, kind: V3_SECTIONS[key] });
      }
    };
    visit(root, []);
  };

  const extend = objectOf(property(theme, "extend") ?? null, consts);
  for (const key of Object.keys(V3_SECTIONS)) {
    collect(property(theme, key) ?? null, key);
    if (extend) collect(property(extend, key) ?? null, key);
  }
}

// ── Token JSON (Style Dictionary / DTCG) ──────────────────────────────────────

export function scanTokenJson(file: TokenFile, acc: TokenAccumulator, warnings: string[]): void {
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch {
    warnings.push(`Could not read ${file.path}`);
    return;
  }
  const visit = (node: unknown, path: string[], inheritedType: string | null) => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return;
    const obj = node as Record<string, unknown>;
    const type = typeof obj.$type === "string" ? obj.$type : typeof obj.type === "string" ? obj.type : inheritedType;
    const raw = "$value" in obj ? obj.$value : "value" in obj && typeof obj.value !== "object" ? obj.value : undefined;
    if (raw !== undefined && path.length > 0) {
      if (typeof raw !== "string" && typeof raw !== "number") return;
      const value = String(raw);
      const name = path.join("-");
      const kind: RepoTokenKind =
        type === "color" ? "color" : type === "shadow" ? "shadow" : type === "fontFamily" ? "font"
        : /^(radius|radii|borderRadius)$/i.test(path[0]) ? "radius"
        : /^(space|spacing|size)$/i.test(path[0]) ? "spacing"
        : kindOf(name, value);
      put(acc, { name, theme: BASE, value, file: file.path, line: 0, container: "json", kind });
      return;
    }
    for (const [key, child] of Object.entries(obj)) {
      if (!key.startsWith("$")) visit(child, [...path, key], type);
    }
  };
  visit(json, [], null);
}

// ── Result ────────────────────────────────────────────────────────────────────

export function finalizeTokens(acc: TokenAccumulator): { themes: string[]; tokens: RepoToken[] } {
  for (const alias of acc.aliases) {
    const target = acc.tokens.get(alias.target);
    const kind = namespaceKind(alias.tailwind);
    if (target) {
      target.tailwind = alias.tailwind;
      if (target.kind === "other" && kind) target.kind = kind;
    } else if (!acc.tokens.has(alias.tailwind)) {
      put(acc, { name: alias.tailwind, theme: BASE, value: alias.value, file: alias.file, line: alias.line, container: "theme", tailwind: alias.tailwind });
    }
  }

  const keys = new Set<string>();
  for (const t of acc.tokens.values()) for (const k of Object.keys(t.values)) keys.add(k);
  const baseKey = keys.has("dark") ? "light" : "default";
  const rename = (k: string) => (k === BASE ? baseKey : k);

  const tokens = [...acc.tokens.values()].map((t) => ({
    ...t,
    values: Object.fromEntries(Object.entries(t.values).map(([k, v]) => [rename(k), v])),
    locations: Object.fromEntries(Object.entries(t.locations).map(([k, v]) => [rename(k), v])),
  }));
  const others = [...keys].filter((k) => k !== BASE).sort((a, b) => (a === "dark" ? -1 : b === "dark" ? 1 : a.localeCompare(b)));
  return { themes: [baseKey, ...others].filter((k) => keys.has(k === baseKey ? BASE : k)), tokens };
}

