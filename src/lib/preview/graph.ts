import type { RepoReader } from "../github";
import { Resolver, type FileModel } from "../repo-scan/model";
import { isIgnoredPath, mapLimit, readerSource } from "../repo-scan/source";
import { instrument } from "../edit/instrument";
import { isJson, isScript, transformModule } from "./transform";
import { findTailwindConfig, isTailwind3Module } from "./tailwind3";

// Everything the sandbox needs to run one component: its module and the modules it imports, the global
// stylesheets, and the packages to load from the CDN.

export interface GraphModule {
  code: string;
  // Import specifier -> path of another module in the graph. A null target is an import with no value
  // (a stylesheet). Specifiers not listed are packages.
  imports: Record<string, string | null>;
}

export interface ModuleGraph {
  entry: string;
  modules: Record<string, GraphModule>;
  css: { path: string; text: string }[];
  // The Tailwind 3 config the page runs to build its stylesheet (a module of the graph), when the repository has one.
  tailwindConfig: string | null;
  // Package name -> version range from the repository's package.json.
  deps: Record<string, string>;
  // Bare specifiers used, with subpaths ("react/jsx-runtime", "lucide-react").
  bare: string[];
  // Reasons a preview can't work; when present the component should not be run.
  unsupported: string[];
  warnings: string[];
}

export interface GraphInput {
  reader: RepoReader;
  repo: string;
  ref: string;
  entry: string;
  // More modules to run besides the entry, e.g. several examples that share one page.
  extraEntries?: string[];
  // Files that exist only for this graph (examples), or replace the repository's version (edits), by path.
  overlay?: Record<string, string>;
  // Mark every HTML element with where it is in the source, so a click in the preview can name the element.
  instrument?: boolean;
  // All file paths in the repository at `ref`.
  paths: string[];
  tailwindEntry: string | null;
  tailwindVersion: 3 | 4 | null;
  styleFiles: string[];
  limits?: { files?: number; bytes?: number };
}

const DEFAULT_LIMITS = { files: 150, bytes: 1_500_000 };
const ASSET = /\.(svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i;
const STYLESHEET = /\.(css|scss|sass|less)$/i;
const NODE_BUILTINS = new Set(["fs", "path", "os", "crypto", "child_process", "http", "https", "net", "stream", "zlib", "util", "url", "assert", "buffer", "events", "tty", "vm", "worker_threads"]);

// An edit builds the graph again, and all but one file in it are as they were: what was parsed and compiled is kept, by
// the text it came from.
const parsed = new Map<string, FileModel>();
const compiled = new Map<string, string>();
const COMPILED_MAX = 400;

async function compile(path: string, code: string, marked: boolean): Promise<string> {
  const key = `${marked ? 1 : 0}\0${path}\0${code}`;
  const known = compiled.get(key);
  if (known !== undefined) return known;
  // An element that can't be marked is still shown; it just can't be picked.
  const source = marked ? await instrument(path, code).catch(() => code) : code;
  const out = await transformModule(path, source);
  if (compiled.size >= COMPILED_MAX) compiled.delete(compiled.keys().next().value!);
  compiled.set(key, out);
  return out;
}

// How many files are read and compiled at once.
const PARALLEL = 6;

const isLocal = (spec: string) => spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("~/");

export function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (a: string, b: string) => {
  const out: string[] = [];
  for (const part of `${a}/${b}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
};

// Versions from the package.json files above the component, nearest first.
async function readVersions(reader: RepoReader, ref: string, entry: string): Promise<Record<string, string>> {
  const dirs: string[] = [];
  for (let dir = dirname(entry); ; dir = dirname(dir)) {
    dirs.push(dir);
    if (dir === "") break;
  }
  const versions: Record<string, string> = {};
  for (const dir of dirs.reverse()) {
    const text = await reader.readText(dir ? `${dir}/package.json` : "package.json", ref).catch(() => null);
    if (!text) continue;
    try {
      const json = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
      Object.assign(versions, json.peerDependencies, json.devDependencies, json.dependencies);
    } catch { /* an unreadable package.json is not fatal */ }
  }
  return versions;
}

// Tailwind's browser build can't fetch files, so a stylesheet's own relative imports are put inline.
async function inlineImports(text: string, path: string, read: (p: string) => Promise<string | null>, depth = 0): Promise<string> {
  if (depth > 5) return text;
  const re = /@import\s+(?:url\(\s*)?["'](\.[^"']+)["']\s*\)?([^;]*);/g;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    const target = join(dirname(path), m[1]);
    const body = await read(target);
    out += text.slice(last, m.index);
    out += body === null ? m[0] : await inlineImports(body, target, read, depth + 1);
    last = m.index! + m[0].length;
  }
  return out + text.slice(last);
}

export async function buildGraph(input: GraphInput): Promise<ModuleGraph> {
  const { reader, ref, entry } = input;
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const warnings: string[] = [];
  const unsupported = new Set<string>();
  const overlay = input.overlay ?? {};
  const paths = [...input.paths.filter((p) => !isIgnoredPath(p)), ...Object.keys(overlay)];
  const pathSet = new Set(paths);
  const base = readerSource(reader, ref);
  const resolver = new Resolver({ ...base, readText: async (p) => (p in overlay ? overlay[p] : base.readText(p)) }, pathSet, warnings, parsed);
  // Files made or changed in the editor and not sent yet are read as they are now, stylesheets included.
  const read = (p: string) => (p in overlay ? Promise.resolve<string | null>(overlay[p]) : reader.readText(p, ref).catch(() => null));

  const versions = await readVersions(reader, ref, entry);
  const modules: Record<string, GraphModule> = {};
  const bare = new Set<string>();
  const cssPaths: string[] = [];
  let bytes = 0;

  const rawUrl = (path: string) =>
    `https://raw.githubusercontent.com/${input.repo}/${ref.split("/").map(encodeURIComponent).join("/")}/${path.split("/").map(encodeURIComponent).join("/")}`;

  // A Tailwind 3 page builds its stylesheet from the repository's config, which is run like any other module.
  const tailwindConfig = input.tailwindVersion === 3 ? findTailwindConfig(paths) : null;
  const starts = [entry, ...(input.extraEntries ?? []), ...(tailwindConfig ? [tailwindConfig] : [])];
  const queue: string[] = [...starts];
  const seen = new Set<string>(starts);
  const enqueue = (p: string) => { if (!seen.has(p)) { seen.add(p); queue.push(p); } };

  // What one file contributes to the graph. Files are read and compiled several at a time, a level of imports at a time, but
  // what they contribute is added in the order they were found, so the graph is the same as when they were done one by one.
  interface Visit {
    path: string;
    module?: GraphModule;
    codeLength: number;
    warnings: string[];
    unsupported: string[];
    bare: string[];
    css: string[];
    next: string[];
    error?: Error;
  }
  const visit = async (path: string): Promise<Visit> => {
    const out: Visit = { path, codeLength: 0, warnings: [], unsupported: [], bare: [], css: [], next: [] };
    try {
      if (ASSET.test(path)) {
        out.module = { code: `module.exports = ${JSON.stringify(rawUrl(path))};`, imports: {} };
        return out;
      }
      if (isJson(path)) {
        const text = await read(path);
        if (text === null) { out.warnings.push(`Couldn't read ${path}`); return out; }
        out.module = { code: await transformModule(path, text), imports: {} };
        return out;
      }

      const model = await resolver.model(path);
      // A script the preview needs but can't read or parse can't be run around, so say why.
      if (!model) throw new Error(warnings.find((w) => w.includes(path)) ?? `Couldn't read ${path}`);
      out.codeLength = model.code.length;

      const imports: Record<string, string | null> = {};
      for (const spec of model.sources) {
        if (!isLocal(spec)) {
          // What the Tailwind 3 bundle provides to a config isn't a package to load.
          if (path === tailwindConfig && isTailwind3Module(spec)) continue;
          if (NODE_BUILTINS.has(spec) || spec.startsWith("node:")) out.unsupported.push(`${path} uses Node's \`${spec}\`, which isn't available in a browser`);
          else if (packageName(spec) === "next") out.unsupported.push(`${path} imports \`${spec}\`; Next.js modules can't be previewed yet`);
          out.bare.push(spec);
          continue;
        }
        const target = resolver.resolve(path, spec);
        if (!target) {
          // A stylesheet that doesn't resolve (the file name is the only clue) is a stylesheet, not a missing module.
          if (STYLESHEET.test(spec)) imports[spec] = null;
          else out.warnings.push(`Couldn't find ${spec} imported by ${path}`);
          continue;
        }
        if (STYLESHEET.test(target)) {
          imports[spec] = null;
          if (/\.module\.[a-z]+$/i.test(target)) out.unsupported.push("CSS modules can't be previewed yet");
          else if (!/\.css$/i.test(target)) out.unsupported.push(`${target.split(".").pop()?.toUpperCase()} stylesheets can't be previewed yet`);
          else out.css.push(target);
          continue;
        }
        imports[spec] = target;
        out.next.push(target);
      }
      if (isScript(path)) out.module = { code: await compile(path, model.code, !!input.instrument), imports };
    } catch (err) {
      out.error = err instanceof Error ? err : new Error(String(err));
    }
    return out;
  };

  while (queue.length) {
    const level = queue.splice(0, queue.length);
    // Reading and compiling the files of a level is what takes the time; the limits are checked as they are added.
    const visits = await mapLimit(level, PARALLEL, visit);
    for (const v of visits) {
      if (Object.keys(modules).length >= limits.files) throw new Error(`This component pulls in more than ${limits.files} files, which is more than a preview can run`);
      if (v.error) throw v.error;
      bytes += v.codeLength;
      if (bytes > limits.bytes) throw new Error(`This component pulls in more than ${Math.round(limits.bytes / 1000)} KB of code, which is more than a preview can run`);
      warnings.push(...v.warnings);
      for (const u of v.unsupported) unsupported.add(u);
      for (const b of v.bare) bare.add(b);
      for (const c of v.css) if (!cssPaths.includes(c)) cssPaths.push(c);
      if (v.module) modules[v.path] = v.module;
      for (const n of v.next) enqueue(n);
    }
  }

  // Global stylesheets: Tailwind's entry first, then what the graph imports, then (without Tailwind) the rest.
  const stylesheets: string[] = [];
  const addCss = (p: string | null | undefined) => { if (p && !stylesheets.includes(p) && pathSet.has(p) && !/\.module\./.test(p)) stylesheets.push(p); };
  addCss(input.tailwindEntry);
  for (const p of cssPaths) addCss(p);
  if (!input.tailwindVersion) for (const p of input.styleFiles.slice(0, 10)) addCss(p);

  const css: { path: string; text: string }[] = [];
  for (const path of stylesheets) {
    const text = await read(path);
    if (text !== null) css.push({ path, text: await inlineImports(text, path, read) });
  }

  const deps: Record<string, string> = {};
  for (const spec of [...bare, "react", "react-dom"]) {
    const name = packageName(spec);
    if (!(name in deps)) deps[name] = versions[name] ?? "latest";
  }

  return { entry, modules, css, tailwindConfig, deps, bare: [...bare].sort(), unsupported: [...unsupported], warnings: [...new Set(warnings)] };
}

// Reading files is the slow part of building a graph, and an edit builds one again, so what was read is kept.
export function cachedReader(reader: RepoReader): RepoReader {
  const texts = new Map<string, Promise<string | null>>();
  return {
    listTree: (ref) => reader.listTree(ref),
    readText: (path, ref) => {
      const key = `${ref}:${path}`;
      if (!texts.has(key)) texts.set(key, reader.readText(path, ref).catch(() => null));
      return texts.get(key)!;
    },
  };
}
