import type { GitHost, PrHost } from "../github";
import { hashText } from "../sync/payload";

// Sending a project's unsent changes to the repository: one working branch, one pull request that keeps updating.
//
// What is sent is a state, not a series of patches. The editor holds every changed file as its full text; the working
// branch should hold exactly the default branch's files with those texts put in. So a sync sends whatever differs from
// what was sent last time, and puts the original back for any file that isn't changed any more (or takes it away, if
// it was made here). That is what keeps undo, revert and sending again simple.

export interface PushedFile {
  // A hash of the text that is on the working branch.
  hash: string;
  // What the file was on the default branch: its text, and its sha (null for a file made here).
  original: { text: string; sha: string | null };
}

export interface WorkState {
  branch: string;
  // Null until the first sync has opened it (or when opening it failed after the files were sent).
  pr: { number: number; url: string } | null;
  pushed: Record<string, PushedFile>;
  // What the person wants said at the top of the pull request.
  note: string;
  syncedAt: number | null;
}

// A changed file as the editor holds it (store/edit.ts `ChangedFile`).
export interface Changed {
  path: string;
  before: string;
  after: string;
  sha: string | null;
}

export interface Plan {
  // Changed since they were last sent (or never sent).
  push: { path: string; text: string; original: PushedFile["original"] }[];
  // Sent before and not changed any more: their original goes back (text null: the file was made here, so it goes).
  restore: { path: string; text: string | null }[];
  // Sent, and unchanged since.
  inPr: string[];
}

export function plan(changed: Changed[], work: Pick<WorkState, "pushed"> | null): Plan {
  const pushed = work?.pushed ?? {};
  const out: Plan = { push: [], restore: [], inPr: [] };
  const now = new Set<string>();
  for (const f of changed) {
    now.add(f.path);
    const before = pushed[f.path];
    if (before && before.hash === hashText(f.after)) out.inPr.push(f.path);
    else out.push.push({ path: f.path, text: f.after, original: before?.original ?? { text: f.before, sha: f.sha } });
  }
  for (const [path, file] of Object.entries(pushed)) {
    if (!now.has(path)) out.restore.push({ path, text: file.original.sha === null ? null : file.original.text });
  }
  return out;
}

export const waitingCount = (p: Plan) => p.push.length + p.restore.length;

export const branchName = (now = Date.now()) => `motif/changes-${now.toString(36)}`;

// The pull request the work was in has ended: it was merged, or closed without being.
export class WorkEnded extends Error {
  constructor(public merged: boolean) {
    super(merged ? "The pull request was merged." : "The pull request was closed without being merged.");
  }
}

// A sync that got part of the way: what the repository has now is in `work`, so nothing has to be sent twice.
export class SyncFailed extends Error {
  constructor(message: string, public work: WorkState | null) {
    super(message);
  }
}

export interface SyncInput {
  host: GitHost & PrHost;
  // The default branch: what the working branch starts from and the pull request goes into.
  base: string;
  work: WorkState | null;
  changed: Changed[];
  title: string;
  // The pull request's description, from the files that are in it.
  body: (paths: string[], note: string) => string;
  message: (waiting: number) => string;
  // What the person wants said at the top of the pull request.
  note?: string;
  now?: number;
}

export interface SyncResult {
  work: WorkState | null;
  // The files sent, and put back, in this sync; empty when there was nothing to do.
  sent: string[];
  restored: string[];
  createdPr: boolean;
}

// Sends what is waiting: one commit on the working branch, and the pull request opened or its description brought up
// to date. Nothing waiting means no requests.
export async function syncWork(input: SyncInput): Promise<SyncResult> {
  const { host, base, changed } = input;
  const now = input.now ?? Date.now();
  let work = input.work;

  // A pull request that has ended ends the cycle: nothing is added to it.
  if (work?.pr) {
    const info = await host.getPullRequest(work.pr.number);
    if (info.state !== "open") throw new WorkEnded(info.merged);
  }

  let p = plan(changed, work);
  if (waitingCount(p) === 0 && (!work || work.pr)) return { work, sent: [], restored: [], createdPr: false };

  // The branch: made on the first sync, and again if someone took it away.
  let branch = work?.branch ?? branchName(now);
  if (!work || (await host.getRef(branch)) === null) {
    if (work) { work = { ...work, pushed: {} }; p = plan(changed, work); }
    await host.createBranch(branch, base);
  }
  const state: WorkState = work ? { ...work, branch, pushed: { ...work.pushed } } : { branch, pr: null, pushed: {}, note: "", syncedAt: null };
  if (input.note !== undefined) state.note = input.note;

  if (waitingCount(p) > 0) {
    const files = [...p.push.map((f) => ({ path: f.path, text: f.text as string | null })), ...p.restore];
    try {
      await host.commitFiles({ branch, message: input.message(files.length), files });
    } catch (err) {
      // The branch is there even if nothing is on it yet, so the next sync goes on with it.
      throw new SyncFailed(err instanceof Error ? err.message : "The changes couldn't be sent", state);
    }
    for (const f of p.push) state.pushed[f.path] = { hash: hashText(f.text), original: f.original };
    for (const f of p.restore) delete state.pushed[f.path];
    state.syncedAt = now;
  }

  const paths = changed.map((f) => f.path);
  try {
    if (state.pr) {
      await host.updatePullRequest(state.pr.number, { body: input.body(paths, state.note) });
      return { work: state, sent: p.push.map((f) => f.path), restored: p.restore.map((f) => f.path), createdPr: false };
    }
    const pr = await host.createPullRequest({ title: input.title, body: input.body(paths, state.note), head: branch, base });
    state.pr = { number: pr.number, url: pr.url };
    return { work: state, sent: p.push.map((f) => f.path), restored: p.restore.map((f) => f.path), createdPr: true };
  } catch (err) {
    // The files are on the branch; the next sync only has the pull request left to do.
    throw new SyncFailed(err instanceof Error ? err.message : "The pull request couldn't be updated", state);
  }
}

export type PrState = "none" | "open" | "merged" | "closed";

export interface Refreshed {
  state: PrState;
  // "behind": the default branch has moved on. "dirty": it conflicts with it. Null while GitHub works it out.
  mergeableState: string | null;
}

export async function refreshWork(host: PrHost, work: WorkState | null): Promise<Refreshed> {
  if (!work?.pr) return { state: "none", mergeableState: null };
  const info = await host.getPullRequest(work.pr.number);
  return { state: info.state === "open" ? "open" : info.merged ? "merged" : "closed", mergeableState: info.mergeableState ?? null };
}

// ── What to say about it ──────────────────────────────────────────────────────

export type StatusKind = "none" | "waiting" | "syncing" | "synced" | "attention";

export interface Status {
  kind: StatusKind;
  text: string;
  waiting: number;
  // Why it needs attention, when it does.
  reason?: "behind" | "conflict" | "closed" | "error" | "stale";
}

export function statusOf(input: { changed: Changed[]; work: WorkState | null; refreshed: Refreshed | null; syncing: boolean; error: string | null; stale: number }): Status {
  const p = plan(input.changed, input.work);
  const waiting = waitingCount(p);
  const pr = input.work?.pr;
  const open = input.refreshed?.state === "open" || (!input.refreshed && !!pr);

  if (input.syncing) return { kind: "syncing", text: "Syncing…", waiting };
  if (input.error) return { kind: "attention", text: input.error, waiting, reason: "error" };
  if (input.refreshed?.state === "closed") return { kind: "attention", text: `Pull request #${pr?.number} was closed without being merged. The next sync opens a new one.`, waiting, reason: "closed" };
  if (open && input.refreshed?.mergeableState === "dirty") return { kind: "attention", text: `Pull request #${pr?.number} conflicts with the default branch. Resolve it on GitHub.`, waiting, reason: "conflict" };
  if (input.stale > 0) return { kind: "attention", text: `${input.stale} file${input.stale === 1 ? " has" : "s have"} changed in the repository since you edited ${input.stale === 1 ? "it" : "them"}.`, waiting, reason: "stale" };
  if (open && input.refreshed?.mergeableState === "behind") return { kind: "attention", text: `Pull request #${pr?.number} is behind the default branch. Update the branch to bring it up to date.`, waiting, reason: "behind" };
  if (waiting > 0) return { kind: "waiting", text: `${waiting} file${waiting === 1 ? "" : "s"} waiting to sync`, waiting };
  if (pr && open) return { kind: "synced", text: `In sync with pull request #${pr.number}`, waiting: 0 };
  return { kind: "none", text: "Nothing to sync", waiting: 0 };
}
