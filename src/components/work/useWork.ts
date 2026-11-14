"use client";

import { useEffect, useMemo, useRef } from "react";
import { gitBlobSha } from "@/lib/github";
import { editPrBody } from "@/lib/work/body";
import { refreshWork, syncWork, SyncFailed, WorkEnded, type Changed, type WorkState } from "@/lib/work/sync";
import { errorMessage, useCanSend, useGitHost } from "@/components/git/hooks";
import { useReadRepository } from "@/components/stage/useReadRepository";
import { changedFiles, editLog, useEditStore, type Base } from "@/store/edit";
import { useGitStore, type GitConnection } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { useWorkRuntime } from "@/store/work";

const NONE: GitConnection = { owner: "", repo: "", token: "", defaultBranch: "main" };
const REFRESH_EVERY = 60_000;

export const TITLE = "Changes from Motif";

const toChanged = (): Changed[] => changedFiles(useEditStore.getState()).map((f) => ({ path: f.path, before: f.before, after: f.after, sha: f.sha }));

// Edited files that the default branch has changed since they were read. A file made here is stale once the repository
// has one of the same name; another, once it differs.
export async function findStale(host: { readText: (path: string, ref: string) => Promise<string | null> }, branch: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of changedFiles(useEditStore.getState())) {
    const text = await host.readText(f.path, branch).catch(() => null);
    if (f.sha === null ? text !== null : text === null || (await gitBlobSha(text)) !== f.sha) out.push(f.path);
  }
  return out;
}

// Gives up the edits to some files, and the components made here that they were.
export function discardChanges(paths: string[]) {
  useEditStore.getState().discard(paths);
  useLibraryStore.getState().dropDrafts(paths);
}

// The one place that talks to GitHub about the project's pull request: sending what is waiting, checking how the pull
// request is doing, and finishing the cycle when it was merged or closed.
export function useWorkActions() {
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NONE);
  const canSend = useCanSend(connection ?? NONE);
  const readRepository = useReadRepository();
  const busy = useRef(false);

  return useMemo(() => {
    const runtime = useWorkRuntime.getState;
    const setWork = (work: WorkState | null) => useGitStore.getState().setWork(work);

    // The pull request was merged: what it merged is the repository's now, so it becomes the files' starting point, the
    // components made here are the repository's, and what is edited from here on is a new set of changes.
    const finishMerged = async (work: WorkState) => {
      const conn = useGitStore.getState().connection;
      if (!conn) return;
      // The component being worked on stays open: it is read from the repository now, with the same changes in it.
      const open = useLibraryStore.getState().activeId;
      const bases: Record<string, Base> = {};
      for (const path of Object.keys(work.pushed)) {
        const file = await host.getFile(path, conn.defaultBranch).catch(() => null);
        if (file) bases[path] = { text: file.text, sha: file.sha };
      }
      useEditStore.getState().rebase(bases);
      // A file that isn't on the default branch (merged away, or never) can't be a starting point: it is let go.
      const gone = Object.keys(work.pushed).filter((p) => !(p in bases) && p in useEditStore.getState().bases);
      if (gone.length > 0) discardChanges(gone);
      setWork(null);
      runtime().set({ refreshed: null, note: "", error: null, notice: `Pull request #${work.pr?.number} was merged. The repository has your changes now.` });
      await readRepository();
      if (open && useLibraryStore.getState().components.some((c) => c.id === open)) useLibraryStore.getState().setActive(open);
    };

    const finishClosed = (work: WorkState) => {
      setWork(null);
      runtime().set({ refreshed: null, error: null, notice: `Pull request #${work.pr?.number} was closed without being merged. Your changes are kept; the next sync opens a new pull request.` });
    };

    const refresh = async () => {
      const work = useGitStore.getState().work ?? null;
      if (!work?.pr || busy.current || !canSend) return;
      runtime().set({ checking: true });
      try {
        const r = await refreshWork(host, work);
        if (r.state === "merged") { busy.current = true; try { await finishMerged(work); } finally { busy.current = false; } return; }
        if (r.state === "closed") { finishClosed(work); return; }
        runtime().set({ refreshed: r });
      } catch {
        // Not being able to ask isn't something to alarm about: the next check tries again.
      } finally {
        runtime().set({ checking: false });
      }
    };

    const sync = async () => {
      const conn = useGitStore.getState().connection;
      if (!conn || busy.current) return;
      busy.current = true;
      runtime().set({ syncing: true, error: null, notice: null });
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const work = useGitStore.getState().work ?? null;
          // Looked at again now: the repository may have changed since the editor last looked.
          const stale = await findStale(host, conn.defaultBranch).catch(() => runtime().stale);
          runtime().set({ stale });
          // A file that the default branch has changed isn't sent for the first time; one that is in the pull request
          // already stays there.
          const changed = toChanged().filter((f) => !stale.includes(f.path) || (work && f.path in work.pushed));
          const edits = useEditStore.getState();
          try {
            const result = await syncWork({
              host, base: conn.defaultBranch, work, changed, title: TITLE, note: runtime().note,
              body: (paths, note) => editPrBody(paths, editLog(edits), note),
              message: (n) => `Update ${n} file${n === 1 ? "" : "s"} from Motif`,
            });
            setWork(result.work);
            runtime().set({ refreshed: result.work?.pr ? { state: "open", mergeableState: "unknown" } : null });
            break;
          } catch (err) {
            if (err instanceof WorkEnded && work) {
              if (err.merged) { await finishMerged(work); break; }
              finishClosed(work);
              runtime().set({ notice: null });
              continue;
            }
            if (err instanceof SyncFailed) setWork(err.work);
            runtime().set({ error: errorMessage(err) });
            break;
          }
        }
      } finally {
        busy.current = false;
        runtime().set({ syncing: false });
      }
      void refresh();
    };

    const updateBranch = async () => {
      const work = useGitStore.getState().work;
      if (!work?.pr) return;
      runtime().set({ error: null });
      try {
        await host.updateBranch(work.pr.number);
        runtime().set({ refreshed: { state: "open", mergeableState: "unknown" } });
        setTimeout(() => void refresh(), 3000);
      } catch (err) {
        runtime().set({ error: errorMessage(err) });
      }
    };

    return { sync, refresh, updateBranch, canSend };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, canSend, readRepository]);
}

// Mounted once while a project is open: checks the pull request now and then, and which of the edited files the
// default branch has changed since.
export function useWorkWatcher() {
  const actions = useWorkActions();
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NONE);
  const pr = useGitStore((s) => s.work?.pr?.number ?? null);
  const history = useEditStore((s) => s.history);
  const index = useEditStore((s) => s.index);
  const bases = useEditStore((s) => s.bases);
  const latest = useRef(actions);
  latest.current = actions;

  // A different pull request (or none) starts from what is known: nothing.
  useEffect(() => {
    useWorkRuntime.getState().set({ refreshed: null });
    if (pr === null) return;
    void latest.current.refresh();
    const timer = setInterval(() => void latest.current.refresh(), REFRESH_EVERY);
    const onFocus = () => void latest.current.refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [pr]);

  // Edited files that the default branch changed after they were read.
  const key = useMemo(() => changedFiles({ history, index, bases }).map((f) => `${f.path}:${f.sha}`).join("|"), [history, index, bases]);
  useEffect(() => {
    if (!connection) return;
    let alive = true;
    findStale(host, connection.defaultBranch).then((out) => { if (alive) useWorkRuntime.getState().set({ stale: out }); });
    return () => { alive = false; };
  }, [host, connection, key]);
}
