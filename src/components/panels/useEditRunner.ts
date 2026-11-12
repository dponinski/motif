"use client";

import { useCallback, useMemo, useState } from "react";
import { gitBlobSha } from "@/lib/github";
import type { EditResult } from "@/lib/edit/element";
import { readerFor } from "@/components/stage/reader";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { currentText, useEditStore } from "@/store/edit";
import type { GitConnection } from "@/store/git";
import type { LibrarySource } from "@/store/library";

// Runs an edit on a file as it is now (with earlier edits) and records it, with the file's original text and
// sha the first time it is changed so a pull request can be made from it.
export function useEditRunner(source: LibrarySource, connection: GitConnection) {
  const host = useGitHost(connection);
  const reader = useMemo(() => readerFor(source, host), [source, host]);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (path: string, op: (code: string) => Promise<EditResult | null>): Promise<boolean> => {
      setError(null);
      try {
        const code = currentText(useEditStore.getState(), path) ?? (await reader.readText(path, source.branch));
        if (code === null) throw new Error(`Couldn't read ${path}`);
        const result = await op(code);
        if (!result || result.code === code) return false;
        const store = useEditStore.getState();
        const base = store.bases[path] ? undefined : { text: code, sha: await gitBlobSha(code) };
        // Offsets in the file have moved, so nothing stays selected.
        store.change(path, result.code, null, result.summary, base);
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      }
    },
    [reader, source.branch]
  );

  return { run, error, clearError: () => setError(null), reader };
}
