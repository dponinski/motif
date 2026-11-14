"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { diffLines } from "@/lib/edit/diff";
import { plan, statusOf, type Changed } from "@/lib/work/sync";
import { changedFiles, useEditStore, type ChangedFile } from "@/store/edit";
import { useGitStore } from "@/store/git";
import { useWorkRuntime } from "@/store/work";
import { discardChanges, useWorkActions } from "@/components/work/useWork";

// A new file is all additions: there is no empty line before it to show as taken away.
function diffOf(f: ChangedFile) {
  if (!f.isNew) return diffLines(f.before, f.after);
  const lines = f.after.replace(/\n$/, "").split("\n");
  return { hunks: [lines.map((text) => ({ type: "+" as const, text }))], added: lines.length, removed: 0 };
}

function FileRow({ file, stale, onDiscard }: { file: ChangedFile; stale: boolean; onDiscard: () => void }) {
  const [open, setOpen] = useState(false);
  const diff = useMemo(() => (open ? diffOf(file) : null), [open, file]);
  return (
    <div className="overflow-hidden rounded-md border border-surface-border">
      <div className="flex items-center gap-1 bg-surface-subtle px-1.5 py-1">
        <button className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Changes to ${file.path}`}>
          {open ? <ChevronDown size={11} className="flex-shrink-0 text-text-tertiary" /> : <ChevronRight size={11} className="flex-shrink-0 text-text-tertiary" />}
          <span className="truncate font-mono text-2xs text-text-secondary" title={file.path}>{file.path}</span>
          {file.isNew && <span className="rounded bg-emerald-500/15 px-1 text-2xs text-emerald-500">new</span>}
          {stale && <span className="rounded bg-amber-500/15 px-1 text-2xs text-amber-500">changed in repo</span>}
        </button>
        <button className="rounded p-1 text-text-tertiary hover:bg-surface-raised hover:text-text-primary" onClick={onDiscard} title="Give up these changes" aria-label={`Discard changes to ${file.path}`}>
          <Undo2 size={11} />
        </button>
      </div>
      {diff && (
        <pre className="max-h-[200px] overflow-auto py-1 font-mono text-2xs leading-relaxed" aria-label={`Diff of ${file.path}`}>
          {diff.hunks.map((hunk, i) => (
            <div key={i} className={cn(i > 0 && "mt-1 border-t border-dashed border-surface-border pt-1")}>
              {hunk.map((l, j) => (
                <div key={j} className={cn("whitespace-pre px-2", l.type === "+" && "bg-emerald-500/10 text-emerald-500", l.type === "-" && "bg-red-400/10 text-red-400", l.type === " " && "text-text-tertiary")}>
                  {l.type === " " ? "  " : `${l.type} `}{l.text}
                </div>
              ))}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

const DOT: Record<string, string> = { none: "bg-surface-border", waiting: "bg-amber-500", syncing: "bg-accent", synced: "bg-emerald-500", attention: "bg-red-400" };

// The project's one working branch and pull request: what is waiting to be sent, what is in it, and what needs attention.
export default function SyncView() {
  const connection = useGitStore((s) => s.connection);
  const work = useGitStore((s) => s.work ?? null);
  const history = useEditStore((s) => s.history);
  const index = useEditStore((s) => s.index);
  const bases = useEditStore((s) => s.bases);
  const files = useMemo(() => changedFiles({ history, index, bases }), [history, index, bases]);
  const runtime = useWorkRuntime();
  const { sync, updateBranch, canSend } = useWorkActions();
  const [confirming, setConfirming] = useState(false);

  const changed: Changed[] = useMemo(() => files.map((f) => ({ path: f.path, before: f.before, after: f.after, sha: f.sha })), [files]);
  const status = statusOf({ changed, work, refreshed: runtime.refreshed, syncing: runtime.syncing, error: runtime.error, stale: runtime.stale.filter((p) => !(work && p in work.pushed)).length });
  const p = useMemo(() => plan(changed, work), [changed, work]);
  const waitingPaths = new Set([...p.push.map((f) => f.path)]);
  const waiting = files.filter((f) => waitingPaths.has(f.path));
  const inPr = files.filter((f) => p.inPr.includes(f.path));
  const reverted = p.restore;

  if (!connection) return <p className="p-3 text-xs text-text-tertiary">Connect a repository to sync changes to it.</p>;

  const canSync = canSend && !runtime.syncing && (p.push.length + p.restore.length > 0 || (!!work && !work.pr));
  const behind = status.reason === "behind";

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 select-text">
      <div className="flex items-start gap-2" role="status" aria-label="Sync status">
        <span className={cn("mt-1 h-2 w-2 flex-shrink-0 rounded-full", DOT[status.kind])} />
        <p className="text-xs leading-relaxed text-text-primary">{status.text}</p>
      </div>

      {runtime.notice && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-500">{runtime.notice}</p>}
      {!canSend && <p className="text-xs text-amber-500">Syncing needs you to sign in with GitHub, or an access token with Contents and Pull requests read and write. Either is in the Git panel.</p>}

      {work?.pr && (
        <a href={work.pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent hover:underline">
          Open pull request #{work.pr.number} <ExternalLink size={10} />
        </a>
      )}

      {(waiting.length > 0 || reverted.length > 0) && (
        <section className="flex flex-col gap-1.5" aria-label="Waiting to sync">
          <h3 className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">Waiting ({waiting.length + reverted.length})</h3>
          {waiting.map((f) => <FileRow key={f.path} file={f} stale={runtime.stale.includes(f.path)} onDiscard={() => discardChanges([f.path])} />)}
          {reverted.map((r) => (
            <div key={r.path} className="rounded-md border border-surface-border px-2 py-1 font-mono text-2xs text-text-tertiary" title="Was sent before and isn't changed any more: syncing puts the original back">
              {r.path} <span className="font-sans">{r.text === null ? "(removed from the pull request)" : "(back to the original)"}</span>
            </div>
          ))}
        </section>
      )}

      {inPr.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label="In the pull request">
          <h3 className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">In the pull request ({inPr.length})</h3>
          {inPr.map((f) => <FileRow key={f.path} file={f} stale={false} onDiscard={() => discardChanges([f.path])} />)}
        </section>
      )}

      {files.length === 0 && reverted.length === 0 && !work && <p className="text-xs leading-relaxed text-text-tertiary">Changes you make to components are kept here until you press Sync. The first sync opens one pull request; every later one adds to it.</p>}

      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Note for the pull request description (optional)</span>
        <textarea className="input-sm min-h-[48px]" aria-label="Pull request note" value={runtime.note} onChange={(e) => runtime.set({ note: e.target.value })} />
      </label>

      {runtime.error && <p role="alert" className="break-words text-xs text-red-400">{runtime.error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          onClick={() => void sync()}
          disabled={!canSync}
        >
          {runtime.syncing && <Loader2 size={12} className="animate-spin" />}
          Sync now
        </button>
        {behind && (
          <button className="flex h-7 items-center gap-1.5 rounded-md border border-surface-border px-3 text-xs text-text-secondary hover:bg-surface-subtle" onClick={() => void updateBranch()}>
            <RefreshCw size={11} /> Update branch
          </button>
        )}
        {files.length > 0 && !confirming && (
          <button className="h-7 rounded-md border border-surface-border px-3 text-xs text-text-secondary hover:bg-surface-subtle" onClick={() => setConfirming(true)}>Discard changes</button>
        )}
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="Discard all changes" className="flex flex-col gap-2 rounded-md border border-red-400/30 bg-red-400/10 p-2">
          <p className="text-xs text-text-primary">Give up all {files.length} changed file{files.length === 1 ? "" : "s"}? The next sync puts back the originals in the pull request.</p>
          <div className="flex gap-2">
            <button className="h-6 rounded bg-red-400 px-2 text-xs font-medium text-white" onClick={() => { discardChanges(files.map((f) => f.path)); setConfirming(false); }}>Discard all</button>
            <button className="h-6 rounded border border-surface-border px-2 text-xs text-text-secondary" onClick={() => setConfirming(false)}>Keep</button>
          </div>
        </div>
      )}
    </div>
  );
}
