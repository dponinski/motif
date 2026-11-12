import type { RepoReader } from "../github";
import { Resolver } from "../repo-scan/model";
import { isIgnoredPath, readerSource } from "../repo-scan/source";
import { isJson, isScript, transformModule } from "./transform";

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
  // Files that exist only for this graph (examples), by path. They may import the repository's modules.
  overlay?: Record<string, string>;
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
  const resolver = new Resolver({ ...base, readText: async (p) => (p in overlay ? overlay[p] : base.readText(p)) }, pathSet, warnings);
  const read = (p: string) => reader.readText(p, ref).catch(() => null);

  const versions = await readVersions(reader, ref, entry);
  const modules: Record<string, GraphModule> = {};
  const bare = new Set<string>();
  const cssPaths: string[] = [];
  let bytes = 0;

  const rawUrl = (path: string) =>
    `https://raw.githubusercontent.com/${input.repo}/${ref.split("/").map(encodeURIComponent).join("/")}/${path.split("/").map(encodeURIComponent).join("/")}`;

  const starts = [entry, ...(input.extraEntries ?? [])];
  const queue: string[] = [...starts];
  const seen = new Set<string>(starts);
  const enqueue = (p: string) => { if (!seen.has(p)) { seen.add(p); queue.push(p); } };

  while (queue.length) {
    const path = queue.shift()!;
    if (Object.keys(modules).length >= limits.files) throw new Error(`This component pulls in more than ${limits.files} files, which is more than a preview can run`);

    if (ASSET.test(path)) {
      modules[path] = { code: `module.exports = ${JSON.stringify(rawUrl(path))};`, imports: {} };
      continue;
    }
    if (isJson(path)) {
      const text = await read(path);
      if (text === null) { warnings.push(`Couldn't read ${path}`); continue; }
      modules[path] = { code: await transformModule(path, text), imports: {} };
      continue;
    }

    const model = await resolver.model(path);
    // A script the preview needs but can't read or parse can't be run around, so say why.
    if (!model) throw new Error(warnings.find((w) => w.includes(path)) ?? `Couldn't read ${path}`);
    bytes += model.code.length;
    if (bytes > limits.bytes) throw new Error(`This component pulls in more than ${Math.round(limits.bytes / 1000)} KB of code, which is more than a preview can run`);

    const imports: Record<string, string | null> = {};
    for (const spec of model.sources) {
      if (!isLocal(spec)) {
        if (NODE_BUILTINS.has(spec) || spec.startsWith("node:")) unsupported.add(`${path} uses Node's \`${spec}\`, which isn't available in a browser`);
        else if (packageName(spec) === "next") unsupported.add(`${path} imports \`${spec}\`; Next.js modules can't be previewed yet`);
        bare.add(spec);
        continue;
      }
      const target = resolver.resolve(path, spec);
      if (!target) {
        // A stylesheet that doesn't resolve (the file name is the only clue) is a stylesheet, not a missing module.
        if (STYLESHEET.test(spec)) imports[spec] = null;
        else warnings.push(`Couldn't find ${spec} imported by ${path}`);
        continue;
      }
      if (STYLESHEET.test(target)) {
        imports[spec] = null;
        if (/\.module\.[a-z]+$/i.test(target)) unsupported.add("CSS modules can't be previewed yet");
        else if (!/\.css$/i.test(target)) unsupported.add(`${target.split(".").pop()?.toUpperCase()} stylesheets can't be previewed yet`);
        else if (!cssPaths.includes(target)) cssPaths.push(target);
        continue;
      }
      imports[spec] = target;
      enqueue(target);
    }
    if (isScript(path)) modules[path] = { code: await transformModule(path, model.code), imports };
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

  return { entry, modules, css, deps, bare: [...bare].sort(), unsupported: [...unsupported], warnings: [...new Set(warnings)] };
}
