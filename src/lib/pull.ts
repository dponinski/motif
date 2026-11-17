import type { GitHost, RepoReader } from "./github";
import { describeUpdate } from "./preview/library";
import { scanBranch } from "./read-repository";
import type { RepoAnalysis } from "./repo-scan/types";
import { convertAnalysis } from "./dtcg/convert";
import { readRepoTokenFiles, type RepoTokenFiles } from "./dtcg/repo";
import { planDtcgSync, resolveDtcg, takeDtcg, type DtcgLink, type DtcgPlan } from "./dtcg/sync";
import type { DtcgFiles } from "./dtcg/types";
import { fromStored, toStored } from "./tokens/migrate";
import { readRepoTokens } from "./token-sync/doc";
import { healLink, linkShapeFor, newTokensPath, planSync, themeLabel, type RepoState, type SyncPlan, type TokenLink } from "./token-sync/flow";
import { tokensDirFor } from "./dtcg/export";
import { keyPrefixes } from "./token-sync/keys";
import { snapshotTokens, useDesignSystemStore } from "../store/design-system";
import { isDtcgLink, repoSlug, stylesheetLink, useGitStore, type GitConnection } from "../store/git";
import { useLibraryStore } from "../store/library";
import { applySyncPlan, importRepoTokens, tokenSlices } from "../store/token-sync";

// Pull: reading the repository again and taking what it has into Motif, in one step. The first time a repository is connected it also
// makes the link between a Motif set and the repository's tokens (so a token made here can be named by a class and goes out with the
// other changes). After that it brings in what changed in the repository and leaves what was changed here, asking only about a value that
// was changed in both places.

// What a pull waits to be told: the clashes of a repository whose tokens are in its stylesheets, or of one whose tokens are design tokens files.
export type PendingConflicts =
  | { format: "stylesheet"; link: TokenLink; plan: SyncPlan; state: RepoState }
  | { format: "dtcg"; link: DtcgLink; plan: DtcgPlan; theirs: DtcgFiles };

export interface PullOutcome {
  analysis: RepoAnalysis;
  // What came in, in a few words, for a status line.
  notes: string[];
  // Token values changed in both places: nothing of the tokens has been taken yet; the person chooses, then `finishPull`.
  conflicts: PendingConflicts | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Design tokens files in Motif: the tokens as the files say, with the link moved forward to the files as the repository has them.
function applyDtcg(link: DtcgLink, files: DtcgFiles, theirs: DtcgFiles): number {
  const model = toStored(snapshotTokens(useDesignSystemStore.getState()));
  const taken = takeDtcg(files, model);
  useDesignSystemStore.getState().replaceTokenData(fromStored(taken.data));
  useGitStore.getState().setTokenLink({ ...link, base: theirs, syncedAt: Date.now() });
  return taken.data.tokens.length + taken.data.compositions.length;
}

const hasTokens = () => {
  const ds = useDesignSystemStore.getState();
  return [ds.colors, ds.typography, ds.spacing, ds.radii, ds.shadows, ds.numbers, ds.strings, ds.compositions].some((list) => list.length > 0);
};

// A repository whose tokens are design tokens files: merged with Motif's tokens as a whole (every set), and asking only about a value that
// was changed in both places. The first time, an empty project takes the repository's tokens as they are.
// A repository whose tokens are variables in its stylesheets is read the same way, as the files they come to (lib/dtcg/convert.ts): nothing is
// asked and nothing is written to the repository until the first push.
async function pullDtcg(host: GitHost & RepoReader, connection: GitConnection, analysis: RepoAnalysis): Promise<{ notes: string[]; conflicts: PendingConflicts | null }> {
  const slug = repoSlug(connection);
  const git = useGitStore.getState();
  const stored = isDtcgLink(git.tokenLink) && git.tokenLink.repo === slug ? git.tokenLink : null;
  // A link to another branch than the one pull requests are made from isn't followed.
  if (stored && stored.branch !== connection.defaultBranch) return { notes: [], conflicts: null };
  const real = await readRepoTokenFiles(host, connection.defaultBranch);

  let found: RepoTokenFiles | null = real;
  let convert: DtcgLink["convert"];
  if (!real && (!stored || stored.convert)) {
    const conv = convertAnalysis(analysis, slug.split("/").pop() ?? slug);
    if (conv) {
      const configPath = `${conv.dir}/tokens.config.json`;
      found = { configPath, dir: conv.dir, config: JSON.parse(conv.files[configPath]), files: conv.files };
      convert = { converted: conv.converted, containers: conv.containers, selectors: conv.selectors, left: conv.left };
    }
  }
  // (A link that has never sent anything is waiting for the first push: there is nothing to have gone.)
  if (!found) return { notes: stored && !stored.convert && Object.keys(stored.base).length > 0 ? ["The design tokens files aren't in the repository any more"] : [], conflicts: null };

  const first: DtcgLink = { format: "dtcg", repo: slug, branch: connection.defaultBranch, dir: found.dir, files: found.config.files, output: found.config.output, tailwind: found.config.tailwind, base: {}, ...(convert ? { convert } : {}), syncedAt: Date.now() };
  if (!stored) {
    if (hasTokens()) return { notes: [convert ? "The repository's tokens are in its stylesheets, but this project already has tokens of its own, so they weren't brought in. Use a project with no tokens to bring them in." : "The repository has design tokens files, but this project already has tokens of its own, so they weren't brought in. Use a project with no tokens to bring them in."], conflicts: null };
    const n = applyDtcg(first, found.files, found.files);
    return { notes: [`${plural(n, "token")} brought in`], conflicts: null };
  }

  // The files are really there now (the pull request that converted the stylesheets was merged), or still only what the stylesheets come to.
  const { convert: _gone, ...rest } = stored;
  void _gone;
  const link: DtcgLink = { ...rest, dir: found.dir, files: found.config.files, output: found.config.output, tailwind: found.config.tailwind, ...(convert ? { convert } : {}) };
  const plan = planDtcgSync(link, toStored(snapshotTokens(useDesignSystemStore.getState())), found.files);
  if (plan.merge.conflicts.length > 0) return { notes: [], conflicts: { format: "dtcg", link, plan, theirs: found.files } };
  if (plan.toMotif.length > 0 || plan.merge.restored.length > 0) {
    applyDtcg(link, plan.merge.files, found.files);
    return { notes: [`${plural(plan.toMotif.length, "token change")} from the repository`], conflicts: null };
  }
  // Nothing to take: what has changed in the repository since is Motif's to send, so the link moves on to the files as they are.
  if (JSON.stringify(link.base) !== JSON.stringify(found.files) || JSON.stringify(stored.convert) !== JSON.stringify(link.convert)) git.setTokenLink({ ...link, base: found.files, syncedAt: Date.now() });
  return { notes: [], conflicts: null };
}

function pullTokens(analysis: RepoAnalysis, connection: GitConnection): { notes: string[]; conflicts: PendingConflicts | null } {
  const slug = repoSlug(connection);
  const git = useGitStore.getState();
  const ds = useDesignSystemStore.getState();
  const state: RepoState = { analysis, snapshot: readRepoTokens(analysis.tokens, analysis.themes) };
  const stored = stylesheetLink(git.tokenLink);
  const link = stored && stored.repo === slug && ds.sets.some((s) => s.id === stored.setId) ? stored : null;

  if (stored && link) {
    // A link to another branch than the one pull requests are made from isn't followed.
    if (link.branch !== connection.defaultBranch) return { notes: [], conflicts: null };
    // A theme of the repository that was deleted from the set here is not mapped to anything any more: it comes back, as the repository has it.
    const live = healLink(link, ds.sets);
    const plan = planSync(live, tokenSlices(), state);
    if (plan.merge.conflicts.length > 0) return { notes: [], conflicts: { format: "stylesheet", link: live, plan, state } };
    const prefixes = keyPrefixes(analysis);
    // (Only for a theme that was deleted here: any other theme the repository has is brought in with its values, as a change.)
    const back = live !== link ? analysis.themes.filter((key) => !(key in live.themes)) : [];
    if (plan.toMotif.length > 0 || plan.merge.restored.length > 0 || back.length > 0) {
      applySyncPlan(live, plan, [], state);
      const changes = plan.toMotif.length + plan.merge.restored.length;
      return { notes: [back.length > 0 ? `${plural(back.length, "theme")} brought back: ${back.map(themeLabel).join(", ")}` : `${plural(changes, "token change")} from the repository`], conflicts: null };
    }
    // Nothing to take; the link only learns how this repository names its tokens.
    if (JSON.stringify(link.prefixes) !== JSON.stringify(prefixes)) git.setTokenLink({ ...link, prefixes });
    return { notes: [], conflicts: null };
  }

  const total = Object.keys(state.snapshot.doc).length;
  if (total > 0) {
    importRepoTokens(slug, connection.defaultBranch, state, { reuseEmpty: true });
    return { notes: [`${plural(total, "token")} brought in`], conflicts: null };
  }

  // A repository with no tokens (and not Tailwind 3, which keeps its stylesheet sync): every set goes into it as design tokens files, with Push.
  if (analysis.stack.tailwindVersion !== 3) {
    const output = newTokensPath(analysis);
    git.setTokenLink({ format: "dtcg", repo: slug, branch: connection.defaultBranch, dir: tokensDirFor(output), files: "single", output, tailwind: analysis.stack.tailwindVersion === 4, base: {}, syncedAt: Date.now() });
    return { notes: [], conflicts: null };
  }

  // A Tailwind 3 repository with no tokens: the first set that has some (else the first set) is the one that goes into it, with Push.
  const has = (id: string) => [ds.colors, ds.radii, ds.spacing, ds.shadows].some((list) => list.some((t) => t.setId === id));
  const set = ds.sets.find((s) => has(s.id)) ?? ds.sets[0];
  if (!set) return { notes: [], conflicts: null };
  git.setTokenLink({
    ...linkShapeFor(set), prefixes: keyPrefixes(analysis), repo: slug, branch: connection.defaultBranch, base: {}, staged: null, syncedAt: Date.now(),
  });
  return { notes: [], conflicts: null };
}

export async function pullRepository(host: GitHost & RepoReader, connection: GitConnection): Promise<PullOutcome> {
  const slug = repoSlug(connection);
  const branch = connection.defaultBranch;
  const head = await host.getRef(branch).catch(() => null);
  const analysis = await scanBranch(host, slug, branch);
  const git = useGitStore.getState();
  git.setAnalysis(analysis);
  git.setPulledSha(head);

  const notes: string[] = [];
  const library = useLibraryStore.getState();
  if (library.source?.repo === slug) {
    const summary = library.updateComponents(analysis);
    const said = describeUpdate(summary);
    if (said !== "Up to date") notes.push(`components: ${said}`);
  } else {
    library.importComponents(analysis);
  }

  // Design tokens files in the repository (and no link to its stylesheets) are what the tokens are; else the stylesheets are.
  const sheet = stylesheetLink(git.tokenLink);
  const dtcg = !(sheet && sheet.repo === slug) ? await pullDtcg(host, connection, analysis) : null;
  const tokens = dtcg && (dtcg.notes.length > 0 || dtcg.conflicts || isDtcgLink(useGitStore.getState().tokenLink)) ? dtcg : pullTokens(analysis, connection);
  notes.push(...tokens.notes);
  return { analysis, notes, conflicts: tokens.conflicts };
}

// The tokens after the person has chosen a side for each value changed in both places (the indexes of the ones that take the repository's).
export function finishPull(pending: PendingConflicts, takeTheirs: number[]): string {
  if (pending.format === "dtcg") {
    const { link, plan, theirs } = pending;
    applyDtcg(link, resolveDtcg(plan.merge, takeTheirs), theirs);
    const n = plan.toMotif.length + plan.merge.conflicts.length;
    return `${plural(n, "token change")} taken, ${takeTheirs.length} of the ${plural(plan.merge.conflicts.length, "clash", "clashes")} in favour of the repository`;
  }
  const { link, plan, state } = pending;
  applySyncPlan(link, plan, takeTheirs, state);
  const n = plan.toMotif.length + plan.merge.conflicts.length;
  return `${plural(n, "token change")} taken, ${takeTheirs.length} of the ${plural(plan.merge.conflicts.length, "clash", "clashes")} in favour of the repository`;
}
