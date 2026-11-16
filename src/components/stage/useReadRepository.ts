import { useCallback, useEffect, useRef } from "react";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { pullRepository } from "@/lib/pull";
import { readRepository } from "@/lib/read-repository";
import { useAccount } from "@/store/account";
import { NO_CONNECTION, repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { usePullStatus } from "@/store/pull";
import { useReadStatus } from "@/store/read-status";
import { useProjectsStore } from "@/store/projects";


// Why a repository couldn't be read, in words. Everyone in a team opens the repository with their own GitHub access, so a teammate who has
// none is told what to do.
function readError(conn: GitConnection, err: unknown): string {
  const shared = useProjectsStore.getState().projects.some((p) => p.teamId && p.repo.connection?.owner === conn.owner && p.repo.connection.repo === conn.repo);
  const message = errorMessage(err);
  const hint = shared && /not found/i.test(message) ? " This design system is shared with a team, and each person opens the repository with their own GitHub access: ask a team owner to give you access to it on GitHub, or add an access token in the Git panel." : "";
  return message + hint;
}

// Reads the project's repository again (the scan, and the components brought into the library), reporting how it went
// through the read status.
export function useReadRepository() {
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NO_CONNECTION);
  return useCallback(async () => {
    const conn = useGitStore.getState().connection;
    if (!conn) return null;
    useReadStatus.getState().set({ busy: true, error: null });
    try {
      const analysis = await readRepository(host, conn);
      useReadStatus.getState().set({ busy: false, error: null });
      return analysis;
    } catch (err) {
      useReadStatus.getState().set({ busy: false, error: readError(conn, err) });
      return null;
    }
  }, [host]);
}

// Pull: reads the repository again and takes what it has into Motif (components, and tokens: made into a linked set the first time, merged
// after that), reporting through the pull status. Token values changed in both places wait in `usePullStatus.pending` for the person.
export function usePullRepository() {
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NO_CONNECTION);
  return useCallback(async () => {
    const conn = useGitStore.getState().connection;
    if (!conn || usePullStatus.getState().busy) return null;
    const first = useGitStore.getState().analysis === null;
    usePullStatus.getState().set({ busy: true, notice: null });
    if (first) useReadStatus.getState().set({ busy: true, error: null });
    try {
      const outcome = await pullRepository(host, conn);
      const text = outcome.conflicts ? "The repository changed some token values that were changed here too: choose which to keep." : outcome.notes.length ? outcome.notes.join(" · ") : "Up to date.";
      usePullStatus.getState().set({ busy: false, notice: { text, ok: true }, pending: outcome.conflicts, behind: false });
      if (first) useReadStatus.getState().set({ busy: false, error: null });
      return outcome;
    } catch (err) {
      const message = readError(conn, err);
      usePullStatus.getState().set({ busy: false, notice: { text: message, ok: false } });
      if (first) useReadStatus.getState().set({ busy: false, error: message });
      return null;
    }
  }, [host]);
}

// A project that hasn't been read yet pulls its repository when it is opened, so a new project lands on something that works: its
// components, and its tokens as a set linked to it. (A project read before that existed is linked the first time it is opened.)
// A failure waits for "Try again" (the person may need to sign in first).
export function useAutoRead() {
  const connection = useGitStore((s) => s.connection);
  const analysis = useGitStore((s) => s.analysis);
  const linked = useGitStore((s) => !!s.tokenLink && !!s.connection && s.tokenLink.repo === repoSlug(s.connection));
  const accountStatus = useAccount((s) => s.status);
  const pull = usePullRepository();
  const tried = useRef<string | null>(null);

  const key = connection ? repoSlug(connection) : null;
  // Wait for the sign-in to be known: without it a private repository would be asked for with no token.
  const ready = accountStatus !== "unknown";
  useEffect(() => {
    if (!connection || (analysis && linked) || !ready || tried.current === key) return;
    tried.current = key;
    void pull();
  }, [connection, analysis, linked, ready, key, pull]);
}
