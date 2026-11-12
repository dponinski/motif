import { gitBlobSha, GitHostError, type GitHost } from "./github";
import {
  mergeDocuments,
  parseDocument,
  resolveConflicts,
  serializeDocument,
  type MergeResult,
  type MotifDocument,
} from "./motif-document";

export interface GitLink {
  repo: string;
  branch: string;
  path: string;
  // Blob sha of the version this file was last pulled from or pushed as; the merge base.
  baseSha: string | null;
}

export interface PendingMerge {
  result: MergeResult;
  remoteSha: string;
  // Set when the merge was started by a push, which resumes once conflicts are resolved.
  message?: string;
}

export type SyncOutcome =
  | { status: "up-to-date"; baseSha: string }
  | { status: "no-remote" }
  | { status: "pulled"; doc: MotifDocument; baseSha: string; pushError?: string }
  | { status: "pushed"; doc?: MotifDocument; baseSha: string; commitUrl: string }
  | { status: "conflicts"; pending: PendingMerge };

type Remote =
  | { kind: "absent" }
  | { kind: "identical"; sha: string }
  | { kind: "unchanged"; sha: string }
  | { kind: "ahead"; sha: string; doc: MotifDocument }
  | { kind: "diverged"; sha: string; result: MergeResult };

async function compare(host: GitHost, link: GitLink, local: MotifDocument) {
  const localText = serializeDocument(local);
  const [localSha, file] = await Promise.all([gitBlobSha(localText), host.getFile(link.path, link.branch)]);

  let remote: Remote;
  if (!file) {
    remote = { kind: "absent" };
  } else if (file.sha === localSha) {
    remote = { kind: "identical", sha: file.sha };
  } else if (file.sha === link.baseSha) {
    remote = { kind: "unchanged", sha: file.sha };
  } else {
    const theirs = parseDocument(file.text);
    if (theirs.id !== local.id) {
      throw new Error(`A different design already lives at ${link.path} on ${link.branch}`);
    }
    if (localSha === link.baseSha) {
      remote = { kind: "ahead", sha: file.sha, doc: theirs };
    } else {
      const baseText = link.baseSha ? await host.getBlob(link.baseSha) : null;
      const base = baseText ? parseDocument(baseText) : null;
      remote = { kind: "diverged", sha: file.sha, result: mergeDocuments(base, local, theirs) };
    }
  }
  return { remote, localText };
}

async function pushMerged(host: GitHost, link: GitLink, doc: MotifDocument, remoteSha: string, message: string): Promise<SyncOutcome> {
  try {
    const put = await host.putFile({ path: link.path, branch: link.branch, text: serializeDocument(doc), message, sha: remoteSha });
    return { status: "pushed", doc, baseSha: put.sha, commitUrl: put.commitUrl };
  } catch (err) {
    // The merge is still a valid local state on top of remoteSha, so keep it rather than redo it.
    return { status: "pulled", doc, baseSha: remoteSha, pushError: err instanceof Error ? err.message : String(err) };
  }
}

export async function pull(host: GitHost, link: GitLink, local: MotifDocument): Promise<SyncOutcome> {
  const { remote } = await compare(host, link, local);
  switch (remote.kind) {
    case "absent":
      return { status: "no-remote" };
    case "identical":
    case "unchanged":
      return { status: "up-to-date", baseSha: remote.sha };
    case "ahead":
      return { status: "pulled", doc: remote.doc, baseSha: remote.sha };
    case "diverged":
      return remote.result.conflicts.length
        ? { status: "conflicts", pending: { result: remote.result, remoteSha: remote.sha } }
        : { status: "pulled", doc: remote.result.merged, baseSha: remote.sha };
  }
}

export async function push(host: GitHost, link: GitLink, local: MotifDocument, message: string): Promise<SyncOutcome> {
  const { remote, localText } = await compare(host, link, local);
  switch (remote.kind) {
    case "identical":
      return { status: "up-to-date", baseSha: remote.sha };
    case "ahead":
      return { status: "pulled", doc: remote.doc, baseSha: remote.sha };
    case "diverged":
      return remote.result.conflicts.length
        ? { status: "conflicts", pending: { result: remote.result, remoteSha: remote.sha, message } }
        : pushMerged(host, link, remote.result.merged, remote.sha, message);
    case "absent":
    case "unchanged":
      try {
        const sha = remote.kind === "unchanged" ? remote.sha : undefined;
        const put = await host.putFile({ path: link.path, branch: link.branch, text: localText, message, sha });
        return { status: "pushed", baseSha: put.sha, commitUrl: put.commitUrl };
      } catch (err) {
        if (err instanceof GitHostError && err.isStale) {
          throw new Error("The branch changed while pushing. Push again to merge the new changes.");
        }
        throw err;
      }
  }
}

export async function finishMerge(host: GitHost, link: GitLink, pending: PendingMerge, takeTheirs: number[]): Promise<SyncOutcome> {
  const doc = resolveConflicts(pending.result, takeTheirs);
  if (pending.message === undefined) return { status: "pulled", doc, baseSha: pending.remoteSha };
  return pushMerged(host, link, doc, pending.remoteSha, pending.message);
}
