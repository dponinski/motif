"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GitBranch, Loader2, Plus, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { createGitHubClient, gitBlobSha, type GitHost } from "@/lib/github";
import { readerSource } from "@/lib/repo-scan/source";
import { stackLine, stylingLine, supportCounts } from "@/lib/repo-scan/summary";
import { finishMerge, pull, push, type GitLink, type PendingMerge, type SyncOutcome } from "@/lib/git-sync";
import { DOCUMENT_EXTENSION, serializeDocument, type MotifDocument } from "@/lib/motif-document";
import { useCanvasStore } from "@/store/canvas";
import { loadOpenDocument, snapshotOpenDocument } from "@/store/open-document";
import { toDocument, useFilesStore, type DesignFile } from "@/store/files";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import GitConnectForm from "@/components/git/GitConnectForm";
import { errorMessage, useBranches, useGitHost } from "@/components/git/hooks";

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";

const btnPrimary = "h-7 px-3 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";
const btnSecondary = "h-7 px-3 border border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-subtle disabled:opacity-50 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";
const fieldLabel = "text-2xs text-text-tertiary";

// ── Track an untracked file ───────────────────────────────────────────────────

function TrackForm({ file, connection, host }: { file: DesignFile; connection: GitConnection; host: GitHost }) {
  const { branches, error } = useBranches(host);
  const [branch, setBranch] = useState(connection.defaultBranch);
  const [path, setPath] = useState(
    [connection.dir, slugify(file.name) + DOCUMENT_EXTENSION].filter(Boolean).join("/")
  );

  const track = () => {
    const clean = path.trim().replace(/^\/+/, "");
    if (!clean) return;
    useFilesStore.getState().setGitLink(file.id, { repo: repoSlug(connection), branch, path: clean, baseSha: null });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-secondary leading-relaxed">
        This file only exists in this browser. Track it to save it to a branch.
      </p>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Branch</span>
        <select className="input-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
          {[...new Set([connection.defaultBranch, ...branches])].map((b) => <option key={b}>{b}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Path in repository</span>
        <input className="input-sm font-mono" value={path} onChange={(e) => setPath(e.target.value)} />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button className={btnPrimary} onClick={track}>Track file</button>
    </div>
  );
}

// ── Conflict resolution ───────────────────────────────────────────────────────

function ConflictValue({ value, other }: { value: unknown; other: unknown }) {
  if (value === undefined) return <span className="italic">{typeof other === "object" ? "Deleted" : "None"}</span>;
  if (typeof value === "object") return <span className="italic">Edited</span>;
  const text = String(value);
  return (
    <span className="flex items-center gap-1 min-w-0">
      {/^#[0-9a-f]{3,8}$/i.test(text) && (
        <span className="w-2.5 h-2.5 rounded-sm border border-surface-border flex-shrink-0" style={{ backgroundColor: text }} />
      )}
      <span className="truncate font-mono">{text}</span>
    </span>
  );
}

function ConflictResolver({
  pending, busy, onApply, onCancel,
}: {
  pending: PendingMerge; busy: boolean; onApply: (takeTheirs: number[]) => void; onCancel: () => void;
}) {
  const { conflicts } = pending.result;
  const [theirs, setTheirs] = useState<Set<number>>(new Set());

  const choose = (index: number, side: "mine" | "theirs") => {
    const next = new Set(theirs);
    if (side === "theirs") next.add(index);
    else next.delete(index);
    setTheirs(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium text-text-primary">
          {conflicts.length} conflicting change{conflicts.length === 1 ? "" : "s"}
        </p>
        <p className="text-2xs text-text-tertiary leading-relaxed mt-0.5">
          You and the branch changed the same thing. Everything else was merged automatically.
        </p>
      </div>
      <div className="flex gap-2">
        <button className={cn(btnSecondary, "flex-1")} onClick={() => setTheirs(new Set())}>Keep all mine</button>
        <button className={cn(btnSecondary, "flex-1")} onClick={() => setTheirs(new Set(conflicts.map((_, i) => i)))}>Take all theirs</button>
      </div>
      <div className="flex flex-col gap-2">
        {conflicts.map((conflict, i) => (
          <div key={conflict.path.join("/")} className="border border-surface-border rounded-md p-2">
            <p className="text-xs text-text-primary mb-1.5 break-words">{conflict.label}</p>
            <div className="grid grid-cols-2 gap-1">
              {(["mine", "theirs"] as const).map((side) => {
                const selected = theirs.has(i) === (side === "theirs");
                return (
                  <button
                    key={side}
                    onClick={() => choose(i, side)}
                    aria-pressed={selected}
                    className={cn(
                      "flex flex-col items-start gap-0.5 px-2 py-1 rounded text-2xs text-left min-w-0 border transition-colors",
                      selected
                        ? "border-accent bg-accent/10 text-text-primary"
                        : "border-transparent bg-surface-subtle text-text-secondary hover:text-text-primary"
                    )}
                  >
                    <span className="uppercase tracking-wider text-text-tertiary">{side}</span>
                    <ConflictValue
                      value={side === "mine" ? conflict.mine : conflict.theirs}
                      other={side === "mine" ? conflict.theirs : conflict.mine}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button className={cn(btnSecondary, "flex-1")} onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={cn(btnPrimary, "flex-1")} onClick={() => onApply([...theirs])} disabled={busy}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          {pending.message === undefined ? "Apply merge" : "Merge and push"}
        </button>
      </div>
    </div>
  );
}

// ── Tracked file ──────────────────────────────────────────────────────────────

type Notice = { kind: "ok" | "info" | "error"; text: string; href?: string };

function SyncPanel({ file, link, host }: { file: DesignFile; link: GitLink; host: GitHost }) {
  const { branches, error: branchError, reload } = useBranches(host);
  const [busy, setBusy] = useState<"pull" | "push" | "merge" | "branch" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<{ merge: PendingMerge; localText: string } | null>(null);
  const [message, setMessage] = useState("");
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [dirty, setDirty] = useState<boolean | null>(null);

  const { setGitLink, saveFile, applyDocument } = useFilesStore.getState();

  useEffect(() => {
    let stale = false;
    gitBlobSha(serializeDocument(toDocument(file))).then((sha) => {
      if (!stale) setDirty(sha !== link.baseSha);
    });
    return () => { stale = true; };
  }, [file, link.baseSha]);

  const applyDoc = (doc: MotifDocument) => {
    applyDocument(file.id, doc);
    loadOpenDocument(doc, useCanvasStore.getState().activeComponentId);
  };

  const handle = (outcome: SyncOutcome, at: GitLink, local: MotifDocument) => {
    switch (outcome.status) {
      case "conflicts":
        setPending({ merge: outcome.pending, localText: serializeDocument(local) });
        return;
      case "no-remote":
        setNotice({ kind: "info", text: `This file is not on ${at.branch} yet. Push to add it.` });
        return;
      case "up-to-date":
        setGitLink(file.id, { ...at, baseSha: outcome.baseSha });
        setNotice({ kind: "ok", text: `Up to date with ${at.branch}` });
        return;
      case "pulled":
        applyDoc(outcome.doc);
        setGitLink(file.id, { ...at, baseSha: outcome.baseSha });
        setNotice(
          outcome.pushError
            ? { kind: "error", text: `Merged into this file, but the push failed: ${outcome.pushError}` }
            : { kind: "ok", text: `Pulled the latest from ${at.branch}` }
        );
        return;
      case "pushed":
        if (outcome.doc) applyDoc(outcome.doc);
        setGitLink(file.id, { ...at, baseSha: outcome.baseSha });
        setNotice({ kind: "ok", text: `Pushed to ${at.branch}`, href: outcome.commitUrl });
        setMessage("");
        return;
    }
  };

  const run = async (kind: "pull" | "push" | "merge", at: GitLink, action: (doc: MotifDocument) => Promise<SyncOutcome>) => {
    setBusy(kind);
    setNotice(null);
    try {
      // Flush edits the debounced auto-save has not written yet.
      saveFile(file.id, snapshotOpenDocument());
      const local = toDocument(useFilesStore.getState().files.find((f) => f.id === file.id)!);
      handle(await action(local), at, local);
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const doPull = (at = link) => run("pull", at, (doc) => pull(host, at, doc));
  const doPush = () => run("push", link, (doc) => push(host, link, doc, message.trim() || `Update ${file.name}`));

  const resolve = (takeTheirs: number[]) => {
    const { merge, localText } = pending!;
    run("merge", link, async (local) => {
      // The merge was computed from an earlier snapshot; applying it now would drop newer edits.
      if (serializeDocument(local) !== localText) {
        throw new Error("This file changed while you were resolving conflicts. Pull or push again to redo the merge.");
      }
      return finishMerge(host, link, merge, takeTheirs);
    }).then(() => setPending(null));
  };

  const switchBranch = (branch: string) => {
    const at = { ...link, branch };
    setGitLink(file.id, at);
    doPull(at);
  };

  const createBranch = async () => {
    const name = newBranch?.trim();
    if (!name) return;
    setBusy("branch");
    setNotice(null);
    try {
      await host.createBranch(name, link.branch);
      setGitLink(file.id, { ...link, branch: name });
      setNotice({ kind: "ok", text: `Created ${name} from ${link.branch}` });
      setNewBranch(null);
      reload();
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  if (pending) {
    return <ConflictResolver pending={pending.merge} busy={busy === "merge"} onApply={resolve} onCancel={() => setPending(null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className={fieldLabel}>Branch</span>
        {newBranch === null ? (
          <div className="flex gap-1">
            <div className="relative flex-1 min-w-0">
              <GitBranch size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              <select
                className="input-sm !pl-6"
                value={link.branch}
                disabled={busy !== null}
                onChange={(e) => switchBranch(e.target.value)}
                aria-label="Branch"
              >
                {[...new Set([link.branch, ...branches])].map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
            <button className="tool-btn flex-shrink-0 !w-7 !h-7 border border-surface-border" title="New branch" onClick={() => setNewBranch("")}>
              <Plus size={12} />
            </button>
          </div>
        ) : (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); createBranch(); }}>
            <input
              className="input-sm font-mono flex-1 min-w-0"
              placeholder={`new branch from ${link.branch}`}
              value={newBranch}
              autoFocus
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setNewBranch(null); }}
            />
            <button type="submit" className={btnSecondary} disabled={busy !== null || !newBranch.trim()}>Create</button>
          </form>
        )}
        {branchError && <p className="text-xs text-red-400">{branchError}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <span className={fieldLabel}>Path</span>
        <p className="text-xs font-mono text-text-secondary break-all">{link.path}</p>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", dirty ? "bg-amber-500" : "bg-emerald-500", dirty === null && "invisible")} />
        {dirty === null ? "" : link.baseSha === null ? "Not pushed yet" : dirty ? "Local changes not pushed" : "No local changes"}
      </div>

      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Commit message</span>
        <input className="input-sm" placeholder={`Update ${file.name}`} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>

      <div className="flex gap-2">
        <button className={cn(btnSecondary, "flex-1")} onClick={() => doPull()} disabled={busy !== null}>
          {busy === "pull" ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
          Pull
        </button>
        <button className={cn(btnPrimary, "flex-1")} onClick={doPush} disabled={busy !== null}>
          {busy === "push" ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
          Push
        </button>
      </div>

      {notice && (
        <p className={cn("text-xs leading-relaxed", notice.kind === "error" ? "text-red-400" : notice.kind === "ok" ? "text-emerald-500" : "text-text-secondary")} role="status">
          {notice.text}
          {notice.href && (
            <>
              {" · "}
              <a href={notice.href} target="_blank" rel="noreferrer" className="underline">View commit</a>
            </>
          )}
        </p>
      )}

      <button
        className="self-start text-2xs text-text-tertiary hover:text-text-primary underline"
        onClick={() => setGitLink(file.id, undefined)}
      >
        Stop tracking this file
      </button>
    </div>
  );
}

// ── Read the repository ───────────────────────────────────────────────────────

function ScanSection({ connection, host, initialBranch, onOpenReport }: {
  connection: GitConnection;
  host: ReturnType<typeof useGitHost>;
  initialBranch: string;
  onOpenReport: () => void;
}) {
  const { branches } = useBranches(host);
  const analysis = useGitStore((s) => s.analysis);
  const setAnalysis = useGitStore((s) => s.setAnalysis);
  const [branch, setBranch] = useState(initialBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = analysis?.repo === repoSlug(connection) ? analysis : null;

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const { scanRepository } = await import("@/lib/repo-scan");
      setAnalysis(await scanRepository(readerSource(host, branch), { repo: repoSlug(connection), ref: branch }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const counts = result ? supportCounts(result.components) : null;

  return (
    <div className="flex flex-col gap-2">
      <span className={fieldLabel}>Components and tokens</span>
      <div className="flex gap-1">
        <select className="input-sm flex-1 min-w-0" aria-label="Branch to scan" value={branch} disabled={busy} onChange={(e) => setBranch(e.target.value)}>
          {[...new Set([branch, connection.defaultBranch, ...branches])].map((b) => <option key={b}>{b}</option>)}
        </select>
        <button className={btnSecondary} onClick={scan} disabled={busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
          {result ? "Rescan" : "Scan"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && counts && (
        <div className="flex flex-col gap-1 rounded-md border border-surface-border p-2.5" role="status">
          <p className="text-xs text-text-primary">{stackLine(result.stack)}</p>
          <p className="text-xs text-text-secondary">{stylingLine(result.stack)}</p>
          <p className="text-xs text-text-secondary">{result.tokens.length} tokens · {result.components.length} components</p>
          {result.components.length > 0 && (
            <p className="text-2xs text-text-tertiary">{counts.editable} editable · {counts.partial} partly editable · {counts["view-only"]} view only</p>
          )}
          <p className="text-2xs text-text-tertiary">
            Scanned {result.ref}
            {result.warnings.length > 0 && <span className="text-amber-500"> · {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</span>}
          </p>
          <button className={cn(btnPrimary, "mt-1")} onClick={onOpenReport}>Open report</button>
        </div>
      )}
    </div>
  );
}

// ── Saving needs a token ──────────────────────────────────────────────────────

function AddToken({ connection }: { connection: GitConnection }) {
  const connect = useGitStore((s) => s.connect);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const { canPush } = await createGitHubClient({ owner: connection.owner, repo: connection.repo, token: value }).getRepo();
      if (!canPush) throw new Error("This token can read the repository but not write to it. It needs Contents read and write.");
      connect({ ...connection, token: value });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <p className="text-xs text-text-secondary leading-relaxed">
        Saving this design file to the repository needs an access token with Contents read and write. It is stored in this browser only.
      </p>
      <input className="input-sm font-mono" type="password" placeholder="github_pat_…" aria-label="Access token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="submit" className={btnPrimary} disabled={busy || !token.trim()}>
        {busy && <Loader2 size={12} className="animate-spin" />}
        Add token
      </button>
    </form>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function Connected({ file, connection, onOpenReport }: { file: DesignFile; connection: GitConnection; onOpenReport: () => void }) {
  const host = useGitHost(connection);
  const disconnect = useGitStore((s) => s.disconnect);
  const link = file.git?.repo === repoSlug(connection) ? file.git : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <a
          href={`https://github.com/${repoSlug(connection)}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-text-primary hover:underline truncate flex-1"
        >
          {repoSlug(connection)}
        </a>
        <button className="text-2xs text-text-tertiary hover:text-text-primary underline flex-shrink-0" onClick={disconnect}>
          Disconnect
        </button>
      </div>
      <ScanSection connection={connection} host={host} initialBranch={link?.branch ?? connection.defaultBranch} onOpenReport={onOpenReport} />
      <div className="border-t border-surface-border" />
      {!connection.token
        ? <AddToken connection={connection} />
        : link
          ? <SyncPanel file={file} link={link} host={host} />
          : <TrackForm file={file} connection={connection} host={host} />}
    </div>
  );
}

export default function GitView({ fileId, onOpenReport }: { fileId: string; onOpenReport: () => void }) {
  const connection = useGitStore((s) => s.connection);
  const file = useFilesStore((s) => s.files.find((f) => f.id === fileId));
  if (!file) return null;

  return (
    <div className="flex-1 overflow-y-auto p-3 select-text">
      {connection ? <Connected file={file} connection={connection} onOpenReport={onOpenReport} /> : <GitConnectForm />}
    </div>
  );
}
