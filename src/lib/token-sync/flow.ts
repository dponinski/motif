import type { GitHost, RepoReader } from "../github";
import type { RepoAnalysis } from "../repo-scan/types";
import { readerSource } from "../repo-scan/source";
import { applyDoc, cssName, readMotifTokens, readRepoTokens, type LinkShape, type RepoSnapshot, type SyncDoc, type TokenSlices } from "./doc";
import { changesToRepo, describeChanges, mergeTokens, type TokenChange, type TokenMerge } from "./merge";
import type { FileWrite, TokenPr } from "./pr";
import { generateTokensCss } from "./write";

// The connection between a Motif token set and a repository.
export interface TokenLink extends LinkShape {
  repo: string;
  branch: string;
  // The repository's tokens as of the last sync: the common ancestor for the next merge.
  base: SyncDoc;
  pending: TokenPr | null;
  syncedAt: number;
}

export interface RepoState {
  analysis: RepoAnalysis;
  snapshot: RepoSnapshot;
}

export async function readRepoState(reader: RepoReader, repo: string, branch: string): Promise<RepoState> {
  const { scanRepository } = await import("../repo-scan");
  const analysis = await scanRepository(readerSource(reader, branch), { repo, ref: branch }, { tokensOnly: true });
  return { analysis, snapshot: readRepoTokens(analysis.tokens, analysis.themes) };
}

export interface SyncPlan {
  merge: TokenMerge;
  // What applying the sync changes in Motif, and what a pull request would change in the repository.
  toMotif: TokenChange[];
  toRepo: TokenChange[];
}

export function planSync(link: TokenLink, slices: TokenSlices, repo: RepoState): SyncPlan {
  const mine = readMotifTokens(slices, link);
  const merge = mergeTokens(link.base, mine, repo.snapshot.doc);
  return { merge, toMotif: describeChanges(mine, merge.merged), toRepo: changesToRepo(merge.merged, repo.snapshot.doc) };
}

// Takes the merged tokens into Motif and records the repository as the new common ancestor.
export function applyMerged(link: TokenLink, slices: TokenSlices, merged: SyncDoc, repo: RepoState, activeThemeId: string): { slices: TokenSlices; link: TokenLink } {
  return {
    slices: applyDoc(slices, link, merged, activeThemeId),
    link: { ...link, base: repo.snapshot.doc, syncedAt: Date.now() },
  };
}

export const themeLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

// ── A repository with no tokens ───────────────────────────────────────────────

export function relativeImport(from: string, to: string): string {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  const rest = b.slice(i).join("/");
  return up.length ? `${up.join("/")}/${rest}` : `./${rest}`;
}

// Puts an @import of the tokens file straight after the Tailwind import; null if there is nothing to add it to.
export function addImport(css: string, importPath: string): string | null {
  if (css.includes(importPath)) return css;
  const tailwind = css.match(/^@import\s+["']tailwindcss["'][^;\n]*;[^\n]*$/m);
  if (!tailwind || tailwind.index === undefined) return null;
  const end = tailwind.index + tailwind[0].length;
  return `${css.slice(0, end)}\n@import "${importPath}";${css.slice(end)}`;
}

export function newTokensPath(analysis: RepoAnalysis): string {
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const anchor = analysis.tailwindEntry ?? analysis.styleFiles[0];
  const dir = anchor !== undefined ? dirOf(anchor) : analysis.stack.entryFiles[0]?.startsWith("src/") ? "src/styles" : "styles";
  const name = analysis.styleFiles.includes(`${dir ? dir + "/" : ""}tokens.css`) ? "motif-tokens.css" : "tokens.css";
  return dir ? `${dir}/${name}` : name;
}

export interface ExportPlan {
  link: Omit<TokenLink, "repo" | "branch" | "pending" | "syncedAt">;
  doc: SyncDoc;
  files: Record<string, FileWrite>;
  changes: TokenChange[];
  tokensPath: string;
  // False when no Tailwind entry stylesheet was found to import the file from.
  imported: boolean;
  skipped: { name: string; reason: string }[];
}

// Everything needed to put a Motif token set into a repository that has none.
export async function planExport(
  host: Pick<GitHost, "getFile">,
  repo: RepoState,
  branch: string,
  set: { id: string; themes: { id: string; name: string }[] },
  slices: TokenSlices
): Promise<ExportPlan> {
  const themes: Record<string, string> = {};
  for (const theme of set.themes) {
    let key = cssName(theme.name);
    for (let n = 2; key in themes; n++) key = `${cssName(theme.name)}-${n}`;
    themes[key] = theme.id;
  }
  const baseTheme = Object.keys(themes)[0] ?? "default";
  const link = { setId: set.id, themes, baseTheme, base: {} as SyncDoc };

  const all = readMotifTokens(slices, link);
  // A name can only be one variable; later tokens that reuse it are left out.
  const doc: SyncDoc = {};
  const skipped: { name: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const [name, token] of Object.entries(all)) {
    const invalid = token.kind === "color" && Object.values(token.values).some((v) => !/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v));
    if (invalid) { skipped.push({ name, reason: "Its color isn't a hex value Motif can write" }); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    doc[name] = token;
  }

  const tailwind = repo.analysis.stack.tailwindVersion === 4;
  const tokensPath = newTokensPath(repo.analysis);
  const files: Record<string, FileWrite> = { [tokensPath]: { text: generateTokensCss(doc, { tailwind, baseTheme }), sha: null } };

  let imported = false;
  const entry = repo.analysis.tailwindEntry;
  if (tailwind && entry) {
    const current = await host.getFile(entry, branch);
    const next = current ? addImport(current.text, relativeImport(entry, tokensPath)) : null;
    if (current && next !== null) {
      imported = true;
      if (next !== current.text) files[entry] = { text: next, sha: current.sha };
    }
  }
  return { link, doc, files, changes: describeChanges({}, doc), tokensPath, imported, skipped };
}
