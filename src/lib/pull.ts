import type { GitHost, RepoReader } from "./github";
import { describeUpdate } from "./preview/library";
import { scanBranch } from "./read-repository";
import type { RepoAnalysis } from "./repo-scan/types";
import { readRepoTokens } from "./token-sync/doc";
import { healLink, linkShapeFor, planSync, themeLabel, type RepoState, type SyncPlan, type TokenLink } from "./token-sync/flow";
import { keyPrefixes } from "./token-sync/keys";
import { useDesignSystemStore } from "../store/design-system";
import { repoSlug, useGitStore, type GitConnection } from "../store/git";
import { useLibraryStore } from "../store/library";
import { applySyncPlan, importRepoTokens, tokenSlices } from "../store/token-sync";

// Pull: reading the repository again and taking what it has into Motif, in one step. The first time a repository is connected it also
// makes the link between a Motif set and the repository's tokens (so a token made here can be named by a class and goes out with the
// other changes). After that it brings in what changed in the repository and leaves what was changed here, asking only about a value that
// was changed in both places.

export interface PendingConflicts {
  link: TokenLink;
  plan: SyncPlan;
  state: RepoState;
}

export interface PullOutcome {
  analysis: RepoAnalysis;
  // What came in, in a few words, for a status line.
  notes: string[];
  // Token values changed in both places: nothing of the tokens has been taken yet; the person chooses, then `finishPull`.
  conflicts: PendingConflicts | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function pullTokens(analysis: RepoAnalysis, connection: GitConnection): { notes: string[]; conflicts: PendingConflicts | null } {
  const slug = repoSlug(connection);
  const git = useGitStore.getState();
  const ds = useDesignSystemStore.getState();
  const state: RepoState = { analysis, snapshot: readRepoTokens(analysis.tokens, analysis.themes) };
  const stored = git.tokenLink;
  const link = stored && stored.repo === slug && ds.sets.some((s) => s.id === stored.setId) ? stored : null;

  if (stored && link) {
    // A link to another branch than the one pull requests are made from isn't followed.
    if (link.branch !== connection.defaultBranch) return { notes: [], conflicts: null };
    // A theme of the repository that was deleted from the set here is not mapped to anything any more: it comes back, as the repository has it.
    const live = healLink(link, ds.sets);
    const plan = planSync(live, tokenSlices(), state);
    if (plan.merge.conflicts.length > 0) return { notes: [], conflicts: { link: live, plan, state } };
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

  // A repository with no tokens: the first set that has some (else the first set) is the one that goes into it, with Push.
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

  const tokens = pullTokens(analysis, connection);
  notes.push(...tokens.notes);
  return { analysis, notes, conflicts: tokens.conflicts };
}

// The tokens after the person has chosen a side for each value changed in both places (the indexes of the ones that take the repository's).
export function finishPull(pending: PendingConflicts, takeTheirs: number[]): string {
  const { link, plan, state } = pending;
  applySyncPlan(link, plan, takeTheirs, state);
  const n = plan.toMotif.length + plan.merge.conflicts.length;
  return `${plural(n, "token change")} taken, ${takeTheirs.length} of the ${plural(plan.merge.conflicts.length, "clash", "clashes")} in favour of the repository`;
}
