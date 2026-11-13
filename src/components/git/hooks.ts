import { useCallback, useEffect, useMemo, useState } from "react";
import { createGitHubClient, type GitHost, type PrHost, type RepoReader } from "@/lib/github";
import { appTokenSource, useAccount } from "@/store/account";
import type { GitConnection } from "@/store/git";

// A client for a repository. A token typed in is used as it is; without one, the signed-in account's token, if
// there is one, is asked for when a request is made.
export const clientFor = (c: Pick<GitConnection, "owner" | "repo" | "token">) =>
  createGitHubClient({ owner: c.owner, repo: c.repo, token: c.token, source: c.token ? undefined : appTokenSource });

export function useGitHost(connection: GitConnection): GitHost & RepoReader & PrHost {
  const { owner, repo, token } = connection;
  return useMemo(() => clientFor({ owner, repo, token }), [owner, repo, token]);
}

// Whether something can be sent to the repository: there is an access token, or this browser is signed in.
export function useCanSend(connection: Pick<GitConnection, "token">): boolean {
  const signedIn = useAccount((s) => s.status === "signed-in");
  return connection.token.length > 0 || signedIn;
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
