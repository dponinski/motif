import type { RepoReader } from "../github";
import { filesOf } from "./generate";
import type { DtcgConfig, DtcgFiles } from "./types";

// Finding and reading the design tokens files of a repository: wherever `tokens.config.json` is, and every JSON file beside it.

export interface RepoTokenFiles {
  configPath: string;
  dir: string;
  config: DtcgConfig;
  files: DtcgFiles;
}

const isConfig = (c: unknown): c is DtcgConfig =>
  typeof c === "object" && c !== null && !Array.isArray(c) && ((c as DtcgConfig).files === "single" || (c as DtcgConfig).files === "per-set") && Array.isArray((c as DtcgConfig).sets);

// The tokens config nearest the top of the repository (a repository could have several: the first is the design system's).
export function configPathIn(paths: string[]): string | null {
  return paths.filter((p) => p === "tokens.config.json" || p.endsWith("/tokens.config.json")).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0] ?? null;
}

export async function readRepoTokenFiles(reader: Pick<RepoReader, "listTree" | "readText">, ref: string): Promise<RepoTokenFiles | null> {
  const { paths } = await reader.listTree(ref);
  const configPath = configPathIn(paths);
  if (!configPath) return null;
  const configText = await reader.readText(configPath, ref);
  let config: unknown;
  try { config = configText === null ? null : JSON.parse(configText); } catch { return null; }
  if (!isConfig(config)) return null;

  const dir = configPath.includes("/") ? configPath.slice(0, configPath.lastIndexOf("/")) : ".";
  const files: DtcgFiles = { [configPath]: configText as string };
  // The files the config describes: the base values, and a file for each theme with its own selector.
  const wanted = [null, ...Object.keys(config.selectors ?? {})].flatMap((theme) => filesOf(config, dir === "." ? "" : dir, theme).map((p) => p.replace(/^\//, "")));
  for (const path of wanted.filter((p) => paths.includes(p))) {
    const text = await reader.readText(path, ref);
    if (text !== null) files[path] = text;
  }
  return { configPath, dir: dir === "." ? "" : dir, config, files };
}
