import { useCallback, useEffect, useRef } from "react";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { readRepository } from "@/lib/read-repository";
import { useAccount } from "@/store/account";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { useReadStatus } from "@/store/read-status";
import { useProjectsStore } from "@/store/projects";

const NONE: GitConnection = { owner: "", repo: "", token: "", defaultBranch: "main" };

// Reads the project's repository again (the scan, and the components brought into the library), reporting how it went
// through the read status.
export function useReadRepository() {
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NONE);
  return useCallback(async () => {
    const conn = useGitStore.getState().connection;
    if (!conn) return null;
    useReadStatus.getState().set({ busy: true, error: null });
    try {
      const analysis = await readRepository(host, conn);
      useReadStatus.getState().set({ busy: false, error: null });
      return analysis;
    } catch (err) {
      // Everyone in a team opens the repository with their own GitHub access, so a teammate who has none is told what to do.
      const shared = useProjectsStore.getState().projects.some((p) => p.teamId && p.repo.connection?.owner === conn.owner && p.repo.connection.repo === conn.repo);
      const message = errorMessage(err);
      const hint = shared && /not found/i.test(message) ? " This design system is shared with a team, and each person opens the repository with their own GitHub access: ask a team owner to give you access to it on GitHub, or add an access token in the Git panel." : "";
      useReadStatus.getState().set({ busy: false, error: message + hint });
      return null;
    }
  }, [host]);
}

// A project that hasn't been read yet reads its repository when it is opened, so a new project lands on something that
// works. A failure waits for "Try again" (the person may need to sign in first).
export function useAutoRead() {
  const connection = useGitStore((s) => s.connection);
  const analysis = useGitStore((s) => s.analysis);
  const accountStatus = useAccount((s) => s.status);
  const run = useReadRepository();
  const tried = useRef<string | null>(null);

  const key = connection ? repoSlug(connection) : null;
  // Wait for the sign-in to be known: without it a private repository would be asked for with no token.
  const ready = accountStatus !== "unknown";
  useEffect(() => {
    if (!connection || analysis || !ready || tried.current === key) return;
    tried.current = key;
    void run();
  }, [connection, analysis, ready, key, run]);
}
