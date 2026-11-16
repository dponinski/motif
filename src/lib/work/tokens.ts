import type { GitHost, RepoReader } from "../github";
import { planExport, planSync, readRepoState, type TokenLink } from "../token-sync/flow";
import { readMotifTokens, type SyncDoc, type TokenSlices } from "../token-sync/doc";
import { keyPrefixes } from "../token-sync/keys";
import { changesToRepo, describeChanges } from "../token-sync/merge";
import { tokenSummary } from "../token-sync/pr";
import { applyEdits, filesNeeded } from "../token-sync/write";
import { overlayReader, type Overlay } from "./overlay";
import { stageFiles } from "./stage";

// Putting Motif's token changes among the editor's changes, so that Sync sends them with everything else. The plan is
// made against the repository as the pull request will have it (the default branch with the editor's changes in it),
// and the merge against what the repository really has, so a token the repository changed is still found.

export interface TokenStageResult {
  link: TokenLink;
  // How many token changes were put in.
  staged: number;
  // Something the person has to look at, said after the sync: the repository has token changes Motif hasn't taken, or
  // some changes couldn't be written.
  attention: string | null;
}

// What is waiting to be staged, without asking the repository: Motif's tokens against what was staged last (or, if
// nothing was, against the last merged state).
export function waitingTokenChanges(link: TokenLink | null, slices: TokenSlices) {
  if (!link) return [];
  return describeChanges(link.staged?.doc ?? link.base, readMotifTokens(slices, link));
}

export async function stageTokens(input: {
  host: GitHost & RepoReader;
  link: TokenLink;
  slices: TokenSlices;
  set: { id: string; themes: { id: string; name: string }[] };
  overlay: Overlay;
  scope: string;
}): Promise<TokenStageResult> {
  const { host, link, slices, set, overlay } = input;
  const branch = link.branch;
  const oh = overlayReader(host, overlay);

  const [real, planned] = await Promise.all([readRepoState(host, link.repo, branch), readRepoState(oh, link.repo, branch)]);
  const plan = planSync(link, slices, real);
  if (plan.merge.conflicts.length > 0 || plan.toMotif.length > 0 || plan.merge.restored.length > 0) {
    return { link, staged: 0, attention: "The repository has token changes that Motif hasn't taken yet. Open Tokens to bring them in; the tokens are not in the pull request until then." };
  }

  const mine = readMotifTokens(slices, link);
  const done = (files: string[]) => ({ ...link, prefixes: keyPrefixes(planned.analysis), staged: { doc: mine, paths: [...new Set([...(link.staged?.paths ?? []), ...files])] } });

  // A repository with no token files (a new design system, or the file was given up): the stylesheet is made.
  if (planned.analysis.tokens.length === 0) {
    const exported = await planExport(oh, planned, branch, set, slices);
    if (Object.keys(exported.doc).length === 0) return { link: done([]), staged: 0, attention: null };
    const files = Object.fromEntries(Object.entries(exported.files).map(([p, f]) => [p, f.text]));
    await stageFiles({ host, branch, scope: input.scope, files, summary: tokenSummary(exported.changes, exported.skipped.map((s) => ({ ...s, theme: null })), { generated: true }) });
    return {
      link: { ...done(Object.keys(files)), base: link.base },
      staged: exported.changes.length,
      attention: exported.skipped.length ? `${exported.skipped.length} token${exported.skipped.length === 1 ? " was" : "s were"} left out: ${exported.skipped[0].reason}.` : null,
    };
  }

  const toRepo = changesToRepo(plan.merge.merged, planned.snapshot.doc);
  if (toRepo.length === 0) return { link: done([]), staged: 0, attention: null };

  const texts: Record<string, string> = {};
  for (const path of filesNeeded(planned.analysis)) {
    const file = await oh.getFile(path, branch);
    if (file) texts[path] = file.text;
  }
  const result = await applyEdits(texts, planned.analysis, planned.snapshot, toRepo, { original: real.snapshot });
  const changedPaths = Object.keys(result.files);
  const left = new Set(result.skipped.map((s) => `${s.name}/${s.theme ?? ""}`));
  const written = toRepo.filter((c) => !left.has(`${c.name}/${c.theme}`) && !left.has(`${c.name}/`));
  const attention = result.skipped.length ? `${result.skipped.length} token change${result.skipped.length === 1 ? "" : "s"} couldn't be written: ${result.skipped[0].reason}` : null;
  if (changedPaths.length === 0) return { link, staged: 0, attention: attention ?? "There is nothing Motif could write." };

  await stageFiles({ host, branch, scope: input.scope, files: result.files, summary: tokenSummary(written, result.skipped, { generated: false }) });
  return { link: done(changedPaths), staged: written.length, attention };
}

const same = (a: SyncDoc[string] | undefined, b: SyncDoc[string] | undefined) => {
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a.values), ...Object.keys(b.values)]);
  return a.kind === b.kind && [...keys].every((k) => a.values[k] === b.values[k]);
};

// The tokens the pull request changes: what the repository would have with the editor's changes in it, against the link's
// last agreed state.
export const changedTokenNames = (withChanges: SyncDoc, base: SyncDoc) => Object.keys(withChanges).filter((n) => !same(withChanges[n], base[n]));

// After a merge: the tokens the pull request changed take the values the repository now has, and nothing else moves, so a
// change the repository made on its own still shows up as coming from it. (Moving everything would make Motif's older
// value look like a new edit, and send it back over the repository's.)
export function advanceLink(link: TokenLink, touched: string[], merged: SyncDoc, now = Date.now()): TokenLink {
  const base = { ...link.base };
  for (const name of touched) if (merged[name]) base[name] = merged[name];
  // What was renamed is renamed in the repository now.
  for (const old of Object.keys(link.renamed ?? {})) delete base[old];
  return { ...link, base, staged: null, renamed: undefined, syncedAt: now };
}
