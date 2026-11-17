"use client";

import { useEffect, useMemo, useRef } from "react";
import { gitBlobSha } from "@/lib/github";
import { mapLimit } from "@/lib/repo-scan/source";
import { editPrBody } from "@/lib/work/body";
import { refreshWork, syncWork, SyncFailed, WorkEnded, type Changed, type WorkState } from "@/lib/work/sync";
import { overlayOf, overlayReader } from "@/lib/work/overlay";
import { advanceLink, changedTokenNames, stageTokens, waitingTokenChanges } from "@/lib/work/tokens";
import { stageDtcgTokens, waitingDtcgChanges } from "@/lib/work/dtcg-tokens";
import { toStored } from "@/lib/tokens/migrate";
import type { TokenChange } from "@/lib/token-sync/merge";
import { readRepoState } from "@/lib/token-sync/flow";
import { tokenSlices } from "@/store/token-sync";
import { snapshotTokens, useDesignSystemStore } from "@/store/design-system";
import { errorMessage, useCanSend, useGitHost } from "@/components/git/hooks";
import { useReadRepository } from "@/components/stage/useReadRepository";
import { changedFiles, editLog, useEditStore, type Base } from "@/store/edit";
import { isDtcgLink, NO_CONNECTION, stylesheetLink, useGitStore, type GitConnection } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { usePullStatus } from "@/store/pull";
import { useWorkRuntime } from "@/store/work";

const REFRESH_EVERY = 60_000;

export const TITLE = "Changes from Motif";

// Motif's tokens in the form that is compared with the design tokens files.
const currentModel = () => toStored(snapshotTokens(useDesignSystemStore.getState()));

const toChanged = (): Changed[] => changedFiles(useEditStore.getState()).map((f) => ({ path: f.path, before: f.before, after: f.after, sha: f.sha }));

// The repository and branch the editor's changes belong to (store/edit.ts `adopt`): the one the library was read from, so
// it is the same wherever changes are put in.
export function editScope(connection: GitConnection): string {
  const source = useLibraryStore.getState().source;
  return source ? `${source.repo}@${source.branch}` : `${connection.owner}/${connection.repo}@${connection.defaultBranch}`;
}

// Edited files that the default branch has changed since they were read. A file made here is stale once the repository
// has one of the same name; another, once it differs.
export async function findStale(host: { readText: (path: string, ref: string) => Promise<string | null> }, branch: string): Promise<string[]> {
  const files = changedFiles(useEditStore.getState());
  // Read together, and listed in the order of the changes.
  const stale = await mapLimit(files, 6, async (f) => {
    const text = await host.readText(f.path, branch).catch(() => null);
    return f.sha === null ? text !== null : text === null || (await gitBlobSha(text)) !== f.sha;
  });
  return files.filter((_, i) => stale[i]).map((f) => f.path);
}

// Gives up the edits to some files, and the components made here that they were.
export function discardChanges(paths: string[]) {
  // Token files that are given up are no longer what Motif's tokens were written to: they are waiting again.
  const link = stylesheetLink(useGitStore.getState().tokenLink);
  if (link?.staged && paths.some((p) => link.staged!.paths.includes(p))) useGitStore.getState().setTokenLink({ ...link, staged: null });
  const files = useGitStore.getState().tokenLink;
  if (isDtcgLink(files) && files.staged && paths.some((p) => files.staged!.paths.includes(p))) useGitStore.getState().setTokenLink({ ...files, staged: null });
  // A rename whose files are given up isn't staged any more (Motif's token keeps the new name until it is renamed back).
  const after = stylesheetLink(useGitStore.getState().tokenLink);
  if (after?.renamed) {
    const kept = Object.fromEntries(Object.entries(after.renamed).filter(([, r]) => !r.paths.some((p) => paths.includes(p))));
    if (Object.keys(kept).length !== Object.keys(after.renamed).length) useGitStore.getState().setTokenLink({ ...after, renamed: Object.keys(kept).length ? kept : undefined });
  }
  useEditStore.getState().discard(paths);
  useLibraryStore.getState().dropDrafts(paths);
}

// The one place that talks to GitHub about the project's pull request: sending what is waiting, checking how the pull
// request is doing, and finishing the cycle when it was merged or closed.
export function useWorkActions() {
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NO_CONNECTION);
  const canSend = useCanSend(connection ?? NO_CONNECTION);
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
      // Which tokens the pull request changed, while the editor still holds its changes.
      const link = stylesheetLink(useGitStore.getState().tokenLink);
      let touched: string[] = [];
      if (link && link.repo === `${conn.owner}/${conn.repo}`) {
        try {
          const planned = await readRepoState(overlayReader(host, overlayOf(useEditStore.getState())), link.repo, link.branch);
          touched = changedTokenNames(planned.snapshot.doc, link.base);
        } catch { /* the tokens' base then stays as it was, which only leaves the badge up */ }
      }
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
      // What the pull request merged is the repository's: the files are as Motif wrote them, so nothing of the tokens is waiting.
      const files = useGitStore.getState().tokenLink;
      // The files' starting point becomes what the pull request carried (not what the repository has now: a change someone else made since is
      // still to be pulled).
      if (isDtcgLink(files) && files.staged) { const { convert: _converted, renamed: _renamed, ...done } = files; void _converted; void _renamed; useGitStore.getState().setTokenLink({ ...done, base: files.staged.files, staged: null, syncedAt: Date.now() }); }
      const current = stylesheetLink(useGitStore.getState().tokenLink);
      if (current && link && current.repo === link.repo) {
        let merged = {} as Awaited<ReturnType<typeof readRepoState>>["snapshot"]["doc"];
        if (touched.length > 0) merged = await readRepoState(host, current.repo, current.branch).then((r) => r.snapshot.doc).catch(() => ({}));
        useGitStore.getState().setTokenLink(advanceLink(current, touched, merged));
      }
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
      runtime().set({ syncing: true, error: null, notice: null, tokenNote: null });
      try {
        // Token changes made in Motif become file changes first, so they go in the same commit as everything else.
        const link = stylesheetLink(useGitStore.getState().tokenLink);
        if (link && link.branch === conn.defaultBranch && waitingTokenChanges(link, tokenSlices()).length > 0) {
          const set = useDesignSystemStore.getState().sets.find((x) => x.id === link.setId);
          if (set) {
            try {
              const staged = await stageTokens({ host, link, slices: tokenSlices(), set, overlay: overlayOf(useEditStore.getState()), scope: editScope(conn) });
              useGitStore.getState().setTokenLink(staged.link);
              runtime().set({ tokenNote: staged.attention });
            } catch (err) {
              runtime().set({ tokenNote: `The tokens couldn't be added to the pull request: ${errorMessage(err)}` });
            }
          }
        }
        const dtcg = useGitStore.getState().tokenLink;
        // (Tokens that are still variables in the stylesheets move into files with the first push, whatever it is for.)
        if (isDtcgLink(dtcg) && dtcg.branch === conn.defaultBranch && (waitingDtcgChanges(dtcg, currentModel()).length > 0 || (!!dtcg.convert && !dtcg.staged))) {
          try {
            const staged = await stageDtcgTokens({ host, link: dtcg, model: currentModel(), overlay: overlayOf(useEditStore.getState()), scope: editScope(conn) });
            useGitStore.getState().setTokenLink(staged.link);
            runtime().set({ tokenNote: staged.attention });
          } catch (err) {
            runtime().set({ tokenNote: `The tokens couldn't be added to the pull request: ${errorMessage(err)}` });
          }
        }
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
  }, [host, canSend, readRepository]);
}

// Token changes in Motif that aren't in the editor's files yet (no request: see lib/work/tokens.ts and lib/work/dtcg-tokens.ts).
export function useTokenChanges(): TokenChange[] {
  const link = useGitStore((s) => stylesheetLink(s.tokenLink));
  const files = useGitStore((s) => (isDtcgLink(s.tokenLink) ? s.tokenLink : null));
  const colors = useDesignSystemStore((s) => s.colors);
  const spacing = useDesignSystemStore((s) => s.spacing);
  const radii = useDesignSystemStore((s) => s.radii);
  const shadows = useDesignSystemStore((s) => s.shadows);
  const sets = useDesignSystemStore((s) => s.sets);
  const typography = useDesignSystemStore((s) => s.typography);
  const numbers = useDesignSystemStore((s) => s.numbers);
  const strings = useDesignSystemStore((s) => s.strings);
  const compositions = useDesignSystemStore((s) => s.compositions);
  const connection = useGitStore((s) => s.connection);
  return useMemo(() => {
    // A link to a branch other than the one the pull request is from isn't sent, so nothing waits for it.
    if (files) {
      if (connection && files.branch !== connection.defaultBranch) return [];
      return waitingDtcgChanges(files, currentModel()).map((c) => ({ ...c, kind: "color" as const }));
    }
    if (!link || (connection && link.branch !== connection.defaultBranch)) return [];
    return waitingTokenChanges(link, { colors, spacing, radii, shadows });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, files, connection, colors, spacing, radii, shadows, sets, typography, numbers, strings, compositions]);
}

// Mounted once while a project is open: checks the pull request now and then, and which of the edited files the
// default branch has changed since.
export function useWorkWatcher() {
  const actions = useWorkActions();
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NO_CONNECTION);
  const pr = useGitStore((s) => s.work?.pr?.number ?? null);
  const history = useEditStore((s) => s.history);
  const index = useEditStore((s) => s.index);
  const bases = useEditStore((s) => s.bases);
  const latest = useRef(actions);
  latest.current = actions;

  // What a sync said about the tokens is out of date once the link has moved (the person applied the repository's changes).
  const syncedAt = useGitStore((s) => s.tokenLink?.syncedAt ?? null);
  useEffect(() => { useWorkRuntime.getState().set({ tokenNote: null }); }, [syncedAt]);

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

// Whether the repository's default branch has moved since it was read (a merge, someone else's push): looked at now and then and when the
// page is looked at again, with one request. Pull is what takes it in.
export function useBehindWatcher() {
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NO_CONNECTION);
  const pulledSha = useGitStore((s) => s.pulledSha ?? null);
  useEffect(() => {
    if (!connection || pulledSha === null) { usePullStatus.getState().set({ behind: false }); return; }
    let alive = true;
    const check = async () => {
      const head = await host.getRef(connection.defaultBranch).catch(() => null);
      if (alive && head) usePullStatus.getState().set({ behind: head !== useGitStore.getState().pulledSha });
    };
    void check();
    const timer = setInterval(() => void check(), REFRESH_EVERY);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [host, connection, pulledSha]);
}

