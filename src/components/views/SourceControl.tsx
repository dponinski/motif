"use client";

import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, ScanSearch, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { diffLines } from "@/lib/edit/diff";
import { stackLine, stylingLine, supportCounts } from "@/lib/repo-scan/summary";
import { scanBranch } from "@/lib/read-repository";
import { planExport, readRepoState } from "@/lib/token-sync/flow";
import { changeLine, tokenSummary } from "@/lib/token-sync/pr";
import { overlayOf, overlayReader } from "@/lib/work/overlay";
import { stageFiles } from "@/lib/work/stage";
import { plan, statusOf, type Changed } from "@/lib/work/sync";
import { changedFiles, useEditStore, type ChangedFile } from "@/store/edit";
import { NO_CONNECTION, repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { useAccount } from "@/store/account";
import { useDesignSystemStore } from "@/store/design-system";
import { usePullStatus } from "@/store/pull";
import { firstProblem, storageProblem } from "@/store/storage-problem";
import { tokenSlices } from "@/store/token-sync";
import { useWorkRuntime } from "@/store/work";
import FirstCommit from "@/components/git/FirstCommit";
import { SignInButton } from "@/components/git/AccountControls";
import { clientFor, errorMessage, useBranches, useGitHost } from "@/components/git/hooks";
import { usePullRepository } from "@/components/stage/useReadRepository";
import { discardChanges, editScope, useTokenChanges, useWorkActions } from "@/components/work/useWork";

// Everything between the project and its repository, in one place, the way an editor's source control is: pull what the repository has,
// see what is waiting, push it as one pull request.

const primary = "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50";
const secondary = "flex h-7 items-center justify-center gap-1.5 rounded-md border border-surface-border px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary disabled:opacity-50";

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

// ── Not able to send yet ──────────────────────────────────────────────────────

function AddToken({ connection }: { connection: GitConnection }) {
  const connect = useGitStore((s) => s.connect);
  const status = useAccount((s) => s.status);
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
      const { canPush } = await clientFor({ owner: connection.owner, repo: connection.repo, token: value }).getRepo();
      if (!canPush) throw new Error("This token can read the repository but not write to it. It needs Contents read and write.");
      connect({ ...connection, token: value });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-surface-border p-2.5">
      <SignInButton className="self-start" />
      {status === "signed-out" && <p className="text-2xs leading-relaxed text-text-tertiary">Signs you in through the Motif GitHub App: pull requests are opened as you, on the repositories the app is installed on. Nothing to create or paste.</p>}
      <form onSubmit={save} className="flex flex-col gap-2">
        <p className="text-xs leading-relaxed text-text-secondary">
          {status === "signed-out" ? "Or use an access token. " : ""}Pushing (token changes and component edits) needs an access token with Contents and Pull requests read and write. It is stored in this browser only.
        </p>
        <input className="input-sm font-mono" type="password" placeholder="github_pat_…" aria-label="Access token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button type="submit" className={secondary} disabled={busy || !token.trim()}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          Add token
        </button>
      </form>
    </div>
  );
}

// ── The repository has no tokens yet ─────────────────────────────────────────

// The project's tokens go in as a stylesheet of CSS variables (wired into Tailwind 4 when it is there). Push does the same when it sends, so
// this is only for putting them in the pull request before that (a framework added next is planned on top of them).
function ExportTokens({ connection, onDone }: { connection: GitConnection; onDone: (text: string) => void }) {
  const host = useGitHost(connection);
  const link = useGitStore((s) => s.tokenLink);
  const sets = useDesignSystemStore((s) => s.sets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = sets.find((s) => s.id === link?.setId);
  const wrongBranch = !!link && link.branch !== connection.defaultBranch;

  const create = async () => {
    if (!set || !link) return;
    setBusy(true);
    setError(null);
    try {
      // Planned against the repository with the editor's changes in it: a framework that is already in the pull request is part of it.
      const oh = overlayReader(host, overlayOf(useEditStore.getState()));
      const planned = await readRepoState(oh, repoSlug(connection), link.branch);
      const made = await planExport(oh, planned, link.branch, set, tokenSlices());
      const tailwind = planned.analysis.stack.tailwindVersion === 4;
      const summary = tokenSummary(made.changes, made.skipped.map((s) => ({ ...s, theme: null })), { generated: true })
        + (made.imported ? "" : `\nImport \`${made.tokensPath}\` from your stylesheet${tailwind ? " after the Tailwind import" : ""} to use these tokens.`);
      const files = Object.fromEntries(Object.entries(made.files).map(([p, f]) => [p, f.text]));
      await stageFiles({ host, branch: link.branch, scope: editScope(connection), files, summary });
      useGitStore.getState().setTokenLink({ ...made.link, repo: repoSlug(connection), branch: link.branch, staged: { doc: made.doc, paths: Object.keys(files) }, syncedAt: Date.now() });
      onDone(`Added ${Object.keys(made.doc).length} tokens in ${made.tokensPath} to your pull request. Push sends them.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-surface-border p-2.5" aria-label="Tokens file" data-tokens-file>
      <p className="text-xs leading-relaxed text-text-secondary">This repository has no design tokens yet. The set “{set?.name}” goes in as a stylesheet of CSS variables when you push, or now, so a framework added next is planned on top of it.</p>
      {wrongBranch && <p className="text-xs text-amber-500">Changes go to a pull request from {connection.defaultBranch}, so these tokens aren&apos;t sent.</p>}
      {error && <p role="alert" className="break-words text-xs text-red-400">{error}</p>}
      <button className={cn(secondary, "self-start")} onClick={create} disabled={busy || !set || wrongBranch}>
        {busy && <Loader2 size={12} className="animate-spin" />}
        Add to pull request
      </button>
    </section>
  );
}

// ── The repository, read ──────────────────────────────────────────────────────

function Details({ connection, onOpenReport }: { connection: GitConnection; onOpenReport: () => void }) {
  const host = useGitHost(connection);
  const { branches } = useBranches(host);
  const analysis = useGitStore((s) => s.analysis);
  const setAnalysis = useGitStore((s) => s.setAnalysis);
  const [branch, setBranch] = useState(connection.defaultBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = analysis?.repo === repoSlug(connection) ? analysis : null;
  const counts = result ? supportCounts(result.components) : null;

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      setAnalysis(await scanBranch(host, repoSlug(connection), branch));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="group rounded-md border border-surface-border" data-details>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-text-secondary hover:text-text-primary">
        <ChevronRight size={11} className="text-text-tertiary transition-transform group-open:rotate-90" />
        Repository
        {result && <span className="ml-auto truncate text-2xs font-normal text-text-tertiary">{result.components.length} components · {result.tokens.length} tokens</span>}
      </summary>
      <div className="flex flex-col gap-2 border-t border-surface-border p-2.5">
        {result && counts ? (
          <div className="flex flex-col gap-1" role="status">
            <p className="text-xs text-text-primary">{stackLine(result.stack)}</p>
            <p className="text-xs text-text-secondary">{stylingLine(result.stack)}</p>
            <p className="text-xs text-text-secondary">{result.tokens.length} tokens · {result.components.length} components</p>
            {result.components.length > 0 && <p className="text-2xs text-text-tertiary">{counts.editable} editable · {counts.partial} partly editable · {counts["view-only"]} view only</p>}
            <p className="text-2xs text-text-tertiary">Scanned {result.ref}{result.warnings.length > 0 && <span className="text-amber-500"> · {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</span>}</p>
            <button className={cn(secondary, "mt-1 self-start")} onClick={onOpenReport}>Open report</button>
          </div>
        ) : <p className="text-xs text-text-tertiary">Not read yet: Pull reads it.</p>}
        <div className="flex gap-1">
          <select className="input-sm min-w-0 flex-1" aria-label="Branch to scan" value={branch} disabled={busy} onChange={(e) => setBranch(e.target.value)}>
            {[...new Set([branch, connection.defaultBranch, ...branches])].map((b) => <option key={b}>{b}</option>)}
          </select>
          <button className={secondary} onClick={scan} disabled={busy} title="Read this branch for the report (components and tokens come from the default branch, with Pull)">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
            {result ? "Rescan" : "Scan"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </details>
  );
}

// ── The panel ─────────────────────────────────────────────────────────────────

export default function SourceControl({ onOpenReport }: { onOpenReport: () => void }) {
  const connection = useGitStore((s) => s.connection);
  const work = useGitStore((s) => s.work ?? null);
  const link = useGitStore((s) => s.tokenLink);
  const analysis = useGitStore((s) => s.analysis);
  const history = useEditStore((s) => s.history);
  const index = useEditStore((s) => s.index);
  const bases = useEditStore((s) => s.bases);
  const files = useMemo(() => changedFiles({ history, index, bases }), [history, index, bases]);
  const runtime = useWorkRuntime();
  const unsaved = storageProblem(firstProblem);
  const tokenChanges = useTokenChanges();
  const host = useGitHost(connection ?? NO_CONNECTION);
  const { status: account, login } = useAccount(useShallow((s) => ({ status: s.status, login: s.login })));
  const pull = usePullRepository();
  const linkedSetName = useDesignSystemStore((s) => s.sets.find((x) => x.id === link?.setId)?.name);
  const { busy: pulling, notice, behind } = usePullStatus();
  // A repository with no commits has nothing to start a branch from: the first commit is offered here, where sending happens.
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    if (!connection) return;
    let alive = true;
    host.isEmpty().then((e) => { if (alive) setEmpty(e); }, () => undefined);
    return () => { alive = false; };
  }, [host, connection]);
  const { sync, updateBranch, canSend } = useWorkActions();
  const [confirming, setConfirming] = useState(false);
  const [tokensNote, setTokensNote] = useState<string | null>(null);

  const changed: Changed[] = useMemo(() => files.map((f) => ({ path: f.path, before: f.before, after: f.after, sha: f.sha })), [files]);
  const status = statusOf({ changed, work, refreshed: runtime.refreshed, syncing: runtime.syncing, error: runtime.error, tokens: tokenChanges.length, tokenNote: runtime.tokenNote, stale: runtime.stale.filter((p) => !(work && p in work.pushed)).length });
  const p = useMemo(() => plan(changed, work), [changed, work]);
  const waitingPaths = new Set([...p.push.map((f) => f.path)]);
  const waiting = files.filter((f) => waitingPaths.has(f.path));
  const inPr = files.filter((f) => p.inPr.includes(f.path));
  const reverted = p.restore;

  if (!connection) return <p className="p-3 text-xs text-text-tertiary">Connect a repository to pull from it and push to it.</p>;

  const slug = repoSlug(connection);
  const waitingCount = p.push.length + p.restore.length + tokenChanges.length;
  const canPush = canSend && !runtime.syncing && !empty && (waitingCount > 0 || (!!work && !work.pr));
  const mustUpdate = status.reason === "behind";
  const awaitingExport = !!link && link.repo === slug && !link.staged && Object.keys(link.base).length === 0 && !!analysis && analysis.tokens.length === 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 select-text">
      <div className="flex items-center gap-2">
        <a href={`https://github.com/${slug}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary hover:underline">{slug}</a>
        <span className="flex-shrink-0 font-mono text-2xs text-text-tertiary">{connection.defaultBranch}</span>
      </div>

      <div className="flex gap-2">
        <button className={primary} onClick={() => void pull()} disabled={pulling} aria-label="Pull" title="Read the repository again and take in what it has (components, and token changes)">
          {pulling ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
          Pull
          {behind && !pulling && <span className="h-1.5 w-1.5 rounded-full bg-white" data-behind title="The repository has changed since it was read" />}
        </button>
        <button className={primary} onClick={() => void sync()} disabled={!canPush} aria-label="Push" title="Send what is waiting as one pull request">
          {runtime.syncing ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
          Push{waitingCount > 0 ? ` (${waitingCount})` : ""}
        </button>
      </div>
      {behind && !pulling && <p className="-mt-1.5 text-2xs text-text-tertiary" data-behind-note>The repository has changed since it was read: Pull takes it in.</p>}
      {notice && <p className={cn("-mt-1.5 text-2xs leading-relaxed", notice.ok ? "text-text-tertiary" : "text-red-400")} role="status" data-pull-notice>{notice.text}</p>}

      {!canSend && <AddToken connection={connection} />}
      {!connection.token && account === "signed-in" && canSend && <p className="text-2xs leading-relaxed text-text-tertiary" data-signed-in>Signed in with GitHub{login ? ` as ${login}` : ""}: pull requests are opened as you, through the Motif GitHub App.</p>}

      <div className="flex items-start gap-2" role="status" aria-label="Sync status">
        <span className={cn("mt-1 h-2 w-2 flex-shrink-0 rounded-full", DOT[status.kind])} />
        <p className="text-xs leading-relaxed text-text-primary">{status.text}</p>
      </div>

      {unsaved && <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500">{unsaved}</p>}
      {runtime.notice && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-500">{runtime.notice}</p>}
      {tokensNote && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-500">{tokensNote}</p>}

      {work?.pr && (
        <a href={work.pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent hover:underline">
          Open pull request #{work.pr.number} <ExternalLink size={10} />
        </a>
      )}

      {awaitingExport && <ExportTokens connection={connection} onDone={setTokensNote} />}

      {tokenChanges.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label="Token changes">
          <h3 className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">Token changes ({tokenChanges.length})</h3>
          <ul className="rounded-md border border-surface-border">
            {tokenChanges.slice(0, 8).map((c) => (
              <li key={`${c.name}/${c.theme}`} className="truncate border-b border-surface-border-subtle px-2 py-1 font-mono text-2xs text-text-secondary last:border-b-0" title={changeLine(c)}>{c.name}{c.theme ? ` (${c.theme})` : ""} <span className="font-sans text-text-tertiary">{c.type}</span></li>
            ))}
          </ul>
          {tokenChanges.length > 8 && <p className="text-2xs text-text-tertiary">…and {tokenChanges.length - 8} more</p>}
          <p className="text-2xs leading-relaxed text-text-tertiary">Added to the pull request as files when you push.</p>
        </section>
      )}

      {(waiting.length > 0 || reverted.length > 0) && (
        <section className="flex flex-col gap-1.5" aria-label="Waiting to sync">
          <h3 className="text-2xs font-medium uppercase tracking-wide text-text-tertiary">Waiting ({waiting.length + reverted.length})</h3>
          {waiting.map((f) => <FileRow key={f.path} file={f} stale={runtime.stale.includes(f.path)} onDiscard={() => discardChanges([f.path])} />)}
          {reverted.map((r) => (
            <div key={r.path} className="rounded-md border border-surface-border px-2 py-1 font-mono text-2xs text-text-tertiary" title="Was sent before and isn't changed any more: pushing puts the original back">
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

      {files.length === 0 && reverted.length === 0 && tokenChanges.length === 0 && !work && <p className="text-xs leading-relaxed text-text-tertiary">Changes you make to components and tokens are kept here until you push. The first push opens one pull request; every later one adds to it.</p>}

      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Note for the pull request description (optional)</span>
        <textarea className="input-sm min-h-[48px]" aria-label="Pull request note" value={runtime.note} onChange={(e) => runtime.set({ note: e.target.value })} />
      </label>

      {empty && <FirstCommit connection={connection} onDone={() => setEmpty(false)} />}

      {runtime.error && <p role="alert" className="break-words text-xs text-red-400">{runtime.error}</p>}

      <div className="flex flex-wrap gap-2">
        {mustUpdate && (
          <button className={secondary} onClick={() => void updateBranch()}>
            <RefreshCw size={11} /> Update branch
          </button>
        )}
        {files.length > 0 && !confirming && <button className={secondary} onClick={() => setConfirming(true)}>Discard changes</button>}
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="Discard all changes" className="flex flex-col gap-2 rounded-md border border-red-400/30 bg-red-400/10 p-2">
          <p className="text-xs text-text-primary">Give up all {files.length} changed file{files.length === 1 ? "" : "s"}? The next push puts back the originals in the pull request.</p>
          <div className="flex gap-2">
            <button className="h-6 rounded bg-red-400 px-2 text-xs font-medium text-white" onClick={() => { discardChanges(files.map((f) => f.path)); setConfirming(false); }}>Discard all</button>
            <button className="h-6 rounded border border-surface-border px-2 text-xs text-text-secondary" onClick={() => setConfirming(false)}>Keep</button>
          </div>
        </div>
      )}

      {link && link.repo === slug && (
        <p className="text-2xs leading-relaxed text-text-tertiary" data-token-link>Tokens: the set “{linkedSetName ?? "?"}” is linked to this repository.</p>
      )}

      <Details connection={connection} onOpenReport={onOpenReport} />
    </div>
  );
}
