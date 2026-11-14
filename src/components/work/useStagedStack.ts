"use client";

import { useEffect, useMemo } from "react";
import { memoReader } from "@/lib/github";
import { hashText } from "@/lib/sync/payload";
import { readRepoState } from "@/lib/token-sync/flow";
import { overlayOf, overlayReader } from "@/lib/work/overlay";
import { useGitHost } from "@/components/git/hooks";
import { useEditStore } from "@/store/edit";
import { NO_CONNECTION, useGitStore } from "@/store/git";
import { useLibraryStore } from "@/store/library";

const relevant = (path: string) => path === "package.json" || path.endsWith(".css");

// The stack the preview and new components build on (is Tailwind there, which stylesheets) follows the editor's changes: a
// Tailwind add-on that is in the pull request but not merged yet already works, and goes back if it is given up. Once the
// repository is read again (after a merge) it is the repository's own.
export function useStagedStack() {
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NO_CONNECTION);
  const sourceKey = useLibraryStore((s) => (s.source ? `${s.source.repo}@${s.source.branch}#${s.source.importedAt}` : null));
  const history = useEditStore((s) => s.history);
  const index = useEditStore((s) => s.index);
  const bases = useEditStore((s) => s.bases);
  // Only changes that can alter the stack matter, and only their content.
  const key = useMemo(
    () => Object.entries(overlayOf({ history, index, bases }).texts).filter(([p]) => relevant(p)).map(([p, t]) => `${p}:${hashText(t)}`).join("|"),
    [history, index, bases]
  );

  // The repository's files are the same between one edit and the next: only the editor's changes put over them differ, so the
  // files are read once for as long as the repository's read stays the same (a new read of it starts again).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceKey is what says the repository was read again
  const reader = useMemo(() => memoReader(host), [host, sourceKey]);

  useEffect(() => {
    const source = useLibraryStore.getState().source;
    if (!source || !connection) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const overlay = overlayOf(useEditStore.getState());
        const staged = Object.keys(overlay.texts).some(relevant);
        // Without relevant changes the stack is the repository's: what the last read found.
        const analysis = staged
          ? (await readRepoState(overlayReader(reader, overlay), source.repo, source.branch)).analysis
          : useGitStore.getState().analysis;
        if (!alive || !analysis) return;
        useLibraryStore.getState().setStack({ tailwindVersion: analysis.stack.tailwindVersion, tailwindEntry: analysis.tailwindEntry, styleFiles: analysis.styleFiles });
      } catch { /* the stack stays as it was */ }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [reader, connection, sourceKey, key]);
}
