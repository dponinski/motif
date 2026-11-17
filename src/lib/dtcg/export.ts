import type { GitHost } from "../github";
import type { RepoAnalysis } from "../repo-scan/types";
import { addImport, newTokensPath, relativeImport } from "../token-sync/flow";
import type { FileWrite } from "../token-sync/pr";
import type { StoredTokenData } from "../tokens/model";
import { generateCss } from "./generate";
import { CONFIG_FILE, patchPackageJson, styleDictionaryConfig } from "./scaffold";
import { describeDtcgChanges, type DtcgChange, type DtcgLink } from "./sync";
import type { Skipped } from "./types";
import { writeDtcg } from "./write";

// Everything needed to put Motif's tokens into a repository that has none, as design tokens files: the files and their config, the
// stylesheet they come to, the Style Dictionary config and script to build it again, and the stylesheet imported where the styles start.

export interface DtcgExport {
  link: Pick<DtcgLink, "dir" | "files" | "output" | "tailwind" | "base">;
  files: Record<string, FileWrite>;
  changes: DtcgChange[];
  skipped: Skipped[];
  // False when no Tailwind entry stylesheet was found to import the stylesheet from.
  imported: boolean;
  // Said after the sync: what couldn't be done.
  notes: string[];
}

// The files go beside the stylesheet: `src/styles/tokens.css` is built from `src/tokens`, and so is `src/tokens.css`.
export const tokensDirFor = (output: string): string => {
  const parts = output.split("/").slice(0, -1);
  if (parts[parts.length - 1] === "styles" || parts[parts.length - 1] === "css") parts.pop();
  return [...parts, "tokens"].join("/");
};

// Marks the Style Dictionary config as Motif's, so one the repository wrote itself is never replaced.
const OURS = "// Builds the stylesheet from the design tokens files in ";

export async function planDtcgExport(
  host: Pick<GitHost, "getFile">,
  analysis: RepoAnalysis,
  branch: string,
  model: StoredTokenData,
  options: { files?: "single" | "per-set"; selectors?: Record<string, string>; output?: string; skipImport?: boolean } = {}
): Promise<DtcgExport> {
  const tailwind = analysis.stack.tailwindVersion === 4;
  const output = options.output ?? newTokensPath(analysis);
  const dir = tokensDirFor(output);
  const written = writeDtcg(model, { files: options.files ?? "single", dir, output, tailwind, selectors: options.selectors });
  const notes: string[] = [];
  const files: Record<string, FileWrite> = {};

  for (const [path, text] of Object.entries(written.files)) files[path] = { text, sha: null };
  files[output] = { text: generateCss(written.files), sha: null };

  // The build: Style Dictionary's config and the script and dependency, unless the repository has its own.
  const config = await host.getFile(CONFIG_FILE, branch);
  if (!config || config.text.startsWith(OURS)) files[CONFIG_FILE] = { text: styleDictionaryConfig(dir), sha: config?.sha ?? null };
  else notes.push(`${CONFIG_FILE} is the repository's own, so it was left as it is: it needs to build ${output} from ${dir}.`);
  const pkg = await host.getFile("package.json", branch);
  const patched = pkg ? patchPackageJson(pkg.text) : null;
  if (pkg && patched !== null && patched !== pkg.text) files["package.json"] = { text: patched, sha: pkg.sha };
  else if (pkg && patched === null) notes.push("package.json couldn't be read, so the tokens:build script and style-dictionary weren't added to it.");
  // A repository with no package.json gets one with just what the build needs (a framework added next goes into it).
  else if (!pkg) files["package.json"] = { text: patchPackageJson(JSON.stringify({ name: (analysis.repo ?? "").split("/").pop() || "design-system", version: "0.0.0", private: true, type: "module" }, null, 2))!, sha: null };

  let imported = false;
  const entry = analysis.tailwindEntry;
  if (tailwind && entry && !options.skipImport) {
    const current = await host.getFile(entry, branch);
    const next = current ? addImport(current.text, relativeImport(entry, output)) : null;
    if (current && next !== null) {
      imported = true;
      if (next !== current.text) files[entry] = { text: next, sha: current.sha };
    }
  }

  const base = { ...written.files };
  return {
    link: { dir, files: written.config.files, output, tailwind, base },
    files,
    changes: describeDtcgChanges({}, base),
    skipped: written.skipped,
    imported,
    notes,
  };
}
