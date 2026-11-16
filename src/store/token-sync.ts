import { applyDoc, type TokenSlices } from "@/lib/token-sync/doc";
import { keyPrefixes } from "@/lib/token-sync/keys";
import { applyMerged, themeLabel, type RepoState, type SyncPlan, type TokenLink } from "@/lib/token-sync/flow";
import { resolveTokenMerge } from "@/lib/token-sync/merge";
import { useDesignSystemStore } from "./design-system";
import { useGitStore } from "./git";

export const tokenSlices = (): TokenSlices => {
  const { colors, spacing, radii, shadows } = useDesignSystemStore.getState();
  return { colors, spacing, radii, shadows };
};

// Creates a Motif set for the repository's tokens, one theme per repository theme, and links them.
// With `reuseEmpty`, a project whose only set has no tokens (the one every project starts with) has that set become the repository's, so
// there is no empty set left beside it.
export function importRepoTokens(repo: string, branch: string, state: RepoState, options: { reuseEmpty?: boolean } = {}): TokenLink {
  const ds = useDesignSystemStore.getState();
  const keys = state.analysis.themes.length ? state.analysis.themes : [state.snapshot.baseTheme];

  const only = ds.sets.length === 1 ? ds.sets[0] : null;
  const empty = !!only && [ds.colors, ds.radii, ds.spacing, ds.shadows, ds.typography].every((list) => list.every((t) => t.setId !== only.id));
  let setId: string;
  if (options.reuseEmpty && only && empty) {
    setId = only.id;
    ds.renameSet(setId, repo);
    // The set starts with one theme; the repository's themes replace it below, one by one, starting with that one.
    for (const t of only.themes.slice(1)) ds.deleteThemeFromSet(setId, t.id);
  } else {
    setId = ds.createSet(repo);
  }
  const first = useDesignSystemStore.getState().sets.find((s) => s.id === setId)!.themes[0].id;
  ds.renameTheme(setId, first, themeLabel(keys[0]));
  const themes: Record<string, string> = { [keys[0]]: first };
  for (const key of keys.slice(1)) themes[key] = useDesignSystemStore.getState().addThemeToSet(setId, themeLabel(key));

  const link: TokenLink = { repo, branch, setId, themes, prefixes: keyPrefixes(state.analysis), baseTheme: state.snapshot.baseTheme, base: state.snapshot.doc, staged: null, syncedAt: Date.now() };
  useDesignSystemStore.setState(applyDoc(tokenSlices(), link, state.snapshot.doc, first));
  useGitStore.getState().setTokenLink(link);
  return link;
}

// Takes the repository's changes into Motif (with the chosen side for each conflict) and moves the link forward.
export function applySyncPlan(link: TokenLink, plan: SyncPlan, takeTheirs: number[], state: RepoState): TokenLink {
  const merged = resolveTokenMerge(plan.merge, takeTheirs);

  const themes = { ...link.themes };
  for (const key of state.analysis.themes) {
    if (!(key in themes)) themes[key] = useDesignSystemStore.getState().addThemeToSet(link.setId, themeLabel(key));
  }
  const current = useDesignSystemStore.getState();
  const activeThemeId = current.sets.find((s) => s.id === link.setId)?.activeThemeId ?? Object.values(themes)[0];
  const result = applyMerged({ ...link, themes }, tokenSlices(), merged, state, activeThemeId);

  useDesignSystemStore.setState(result.slices);
  useGitStore.getState().setTokenLink(result.link);
  return result.link;
}
