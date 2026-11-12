import { useCallback, useEffect, useMemo, useState } from "react";
import { createGitHubClient, type GitHost } from "@/lib/github";
import type { GitConnection } from "@/store/git";

export function useGitHost(connection: GitConnection): GitHost {
  const { owner, repo, token } = connection;
  return useMemo(() => createGitHubClient({ owner, repo, token }), [owner, repo, token]);
}

export function useBranches(host: GitHost) {
  const [branches, setBranches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    host.listBranches().then(
      (names) => { setBranches(names); setError(null); },
      (err: Error) => setError(err.message)
    );
  }, [host]);

  useEffect(reload, [reload]);
  return { branches, error, reload };
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
