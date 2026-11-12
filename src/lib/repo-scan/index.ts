import { rateSupport, scanComponentFile, type ScannedComponent } from "./components";
import { detectStack, type PackageJson } from "./detect";
import { Resolver, normalize } from "./model";
import { isIgnoredPath, isLibraryPath, mapLimit } from "./source";
import { finalizeTokens, newAccumulator, scanCss, scanTailwindConfig, scanTokenJson } from "./tokens";
import type { RepoAnalysis, RepoSource, StylingSystem } from "./types";

export type { RepoAnalysis, RepoComponent, RepoSource, RepoToken } from "./types";
export { memoryReader, memorySource, readerSource } from "./source";

const MAX_PACKAGES = 25;
const MAX_CSS_FILES = 60;
const MAX_COMPONENT_FILES = 400;
const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx"];

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

function exportStrings(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (depth > 3 || typeof value !== "object" || value === null) return [];
  const obj = value as Record<string, unknown>;
  const root = "." in obj ? obj["."] : obj;
  return typeof root === "object" && root !== null
    ? Object.values(root as Record<string, unknown>).flatMap((v) => exportStrings(v, depth + 1))
    : exportStrings(root, depth + 1);
}

function findEntries(packages: { path: string; json: PackageJson }[], paths: Set<string>): string[] {
  const entries = new Set<string>();
  for (const { path, json } of packages) {
    const dir = dirOf(path);
    const join = (p: string) => normalize(`${dir}/${p}`);
    const declared = [json.module, json.main, json.types, ...exportStrings(json.exports)].filter((p): p is string => typeof p === "string");
    let found = false;
    for (const d of declared) {
      const full = join(d);
      const stem = full.replace(/\.(d\.ts|[cm]?[jt]sx?)$/, "");
      const candidates = [full, ...SOURCE_EXT.map((e) => stem + e), ...SOURCE_EXT.map((e) => stem.replace(/^((?:.*\/)?)(dist|build|lib)\//, "$1src/") + e)];
      const hit = candidates.find((c) => paths.has(c));
      if (hit) { entries.add(hit); found = true; }
    }
    if (!found) {
      const conventional = ["src/index", "index"].flatMap((b) => SOURCE_EXT.map((e) => join(b + e))).find((c) => paths.has(c));
      if (conventional) entries.add(conventional);
    }
  }
  return [...entries];
}

async function publicExports(entries: string[], resolver: Resolver): Promise<Set<string>> {
  const pub = new Set<string>();
  const visited = new Set<string>();
  const visit = async (path: string, wanted: Set<string> | "*", depth: number): Promise<void> => {
    if (depth > 8) return;
    const key = `${path}::${wanted === "*" ? "*" : [...wanted].sort().join(",")}`;
    if (visited.has(key)) return;
    visited.add(key);
    const model = await resolver.model(path);
    if (!model) return;
    for (const [exported, local] of model.exports) {
      if (wanted !== "*" && !wanted.has(exported)) continue;
      const binding = model.imports.get(local);
      if (binding && !model.consts.has(local) && !model.functions.has(local)) {
        const target = resolver.resolve(path, binding.source);
        if (target) await visit(target, new Set([binding.imported]), depth + 1);
        continue;
      }
      pub.add(`${path}::${local}`);
    }
    for (const re of model.reexports) {
      const target = resolver.resolve(path, re.source);
      if (!target) continue;
      if (re.names === "*") await visit(target, wanted, depth + 1);
      else {
        const names = re.names.filter((n) => wanted === "*" || wanted.has(n.exported));
        if (names.length) await visit(target, new Set(names.map((n) => n.imported)), depth + 1);
      }
    }
  };
  for (const entry of entries) await visit(entry, "*", 0);
  return pub;
}

export async function scanRepository(
  source: RepoSource,
  meta: { repo: string; ref: string },
  options: { tokensOnly?: boolean } = {}
): Promise<RepoAnalysis> {
  let reads = 0;
  const counted: RepoSource = {
    listFiles: () => source.listFiles(),
    readText: async (path) => {
      const text = await source.readText(path);
      if (text !== null) reads++;
      return text;
    },
  };
  const warnings: string[] = [];

  const listing = await counted.listFiles();
  if (listing.truncated) warnings.push("GitHub returned only part of this repository's file list, so some files were not scanned");
  const paths = listing.paths.filter((p) => !isIgnoredPath(p));
  const pathSet = new Set(paths);

  const packageFiles = paths.filter((p) => /(^|\/)package\.json$/.test(p)).slice(0, MAX_PACKAGES);
  const packages = (
    await mapLimit(packageFiles, 6, async (path) => {
      const text = await counted.readText(path);
      if (text === null) return null;
      try {
        return { path, json: JSON.parse(text) as PackageJson };
      } catch {
        warnings.push(`Could not read ${path}`);
        return null;
      }
    })
  ).filter((p): p is { path: string; json: PackageJson } => p !== null);

  const cssPaths = paths.filter((p) => p.endsWith(".css")).slice(0, MAX_CSS_FILES);
  if (paths.filter((p) => p.endsWith(".css")).length > MAX_CSS_FILES) warnings.push(`Only the first ${MAX_CSS_FILES} stylesheets were read for tokens`);
  const cssFiles = (await mapLimit(cssPaths, 8, async (path) => ({ path, text: await counted.readText(path) })))
    .filter((f): f is { path: string; text: string } => f.text !== null);

  const entries = findEntries(packages, pathSet);
  const baseInput = { packages, paths, cssTexts: cssFiles.map((f) => f.text), entryFiles: entries };
  const early = detectStack({ ...baseInput, usage: {}, libraryFiles: 0 });

  // Tokens
  const acc = newAccumulator();
  await scanCss(cssFiles, acc, warnings);
  for (const path of paths.filter((p) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(p))) {
    const text = await counted.readText(path);
    if (text !== null) await scanTailwindConfig({ path, text }, acc, warnings);
  }
  const tokenJson = paths.filter((p) => /(^|\/)(design-)?tokens?(\.[\w-]+)*\.json$|(^|\/)tokens\/[^/]+\.json$/.test(p)).slice(0, 10);
  for (const path of tokenJson) {
    const text = await counted.readText(path);
    if (text !== null) scanTokenJson({ path, text }, acc, warnings);
  }
  const { themes, tokens } = finalizeTokens(acc);

  // Components
  const resolver = new Resolver(counted, pathSet, warnings);
  const scanned: ScannedComponent[] = [];
  const usage: Partial<Record<StylingSystem, number>> = {};
  let libraryFiles = 0;

  const readComponents = !options.tokensOnly;
  if (readComponents && early.supported) {
    const all = paths.filter((p) => /\.[jt]sx$/.test(p) && isLibraryPath(p));
    if (all.length > MAX_COMPONENT_FILES) warnings.push(`Only the first ${MAX_COMPONENT_FILES} of ${all.length} component files were read`);
    const results = await mapLimit(all.slice(0, MAX_COMPONENT_FILES), 8, async (path) => {
      const model = await resolver.model(path);
      return model ? scanComponentFile(model, resolver) : null;
    });
    for (const result of results) {
      if (!result || result.components.length === 0) continue;
      libraryFiles++;
      scanned.push(...result.components);
      for (const u of result.usage) {
        const system: StylingSystem = u === "class-strings" ? (early.tailwindVersion ? "tailwind" : "plain-css") : u;
        usage[system] = (usage[system] ?? 0) + 1;
      }
    }
  } else if (readComponents) {
    warnings.push(
      early.framework
        ? `Components are not read yet: ${early.framework.name} repositories are not supported, only React`
        : "Components are not read: no React dependency was found"
    );
  }

  const stack = detectStack({ ...baseInput, usage, libraryFiles });
  if (stack.styling.primary === "sass" || paths.some((p) => /\.s[ac]ss$/.test(p))) warnings.push("Sass variables are not read as tokens yet");

  const publicSet = entries.length && !options.tokensOnly ? await publicExports(entries, resolver) : null;
  const components = scanned
    .map(({ local, classKinds, ...c }) => ({
      ...c,
      public: publicSet ? publicSet.has(`${c.file}::${local}`) : null,
      support: rateSupport(classKinds, stack.styling.primary),
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return {
    repo: meta.repo,
    ref: meta.ref,
    scannedAt: Date.now(),
    stack,
    themes,
    tokens,
    components,
    styleFiles: cssPaths,
    tailwindEntry: cssFiles.find((f) => /@import\s+["']tailwindcss["']/.test(f.text))?.path ?? null,
    warnings: [...new Set(warnings)],
    stats: { filesInRepo: listing.paths.length, filesRead: reads, truncated: listing.truncated },
  };
}
