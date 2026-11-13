"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isColorValue } from "@/lib/repo-scan/summary";
import { planExport, planSync, readRepoState, type RepoState, type SyncPlan, type TokenLink } from "@/lib/token-sync/flow";
import { displayValue, type TokenChange, type TokenConflict } from "@/lib/token-sync/merge";
import { openTokenPr, prBody } from "@/lib/token-sync/pr";
import { applyEdits, filesNeeded } from "@/lib/token-sync/write";
import { useDesignSystemStore } from "@/store/design-system";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { applySyncPlan, importRepoTokens, tokenSlices } from "@/store/token-sync";
import { errorMessage, useBranches, useCanSend, useGitHost } from "./hooks";

const btnPrimary = "h-7 px-3 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";
const btnSecondary = "h-7 px-3 border border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-subtle disabled:opacity-50 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";

type Host = ReturnType<typeof useGitHost>;
type Notice = { kind: "ok" | "error"; text: string; href?: string };

// ── Pieces ────────────────────────────────────────────────────────────────────

function Value({ value }: { value: string | undefined }) {
  if (value === undefined) return <span className="text-text-tertiary">—</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {isColorValue(value) && <span className="h-3.5 w-3.5 flex-shrink-0 rounded border border-surface-border" style={{ backgroundColor: value }} />}
      <span className="truncate font-mono text-2xs text-text-secondary" title={value}>{value}</span>
    </span>
  );
}

function ChangeList({ changes, label }: { changes: TokenChange[]; label: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, 8);
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-text-tertiary">{label} ({changes.length})</p>
      <ul className="rounded-md border border-surface-border">
        {shown.map((c) => (
          <li key={`${c.name}/${c.theme}`} className="flex items-center gap-2 border-b border-surface-border-subtle px-2.5 py-1.5 text-xs last:border-b-0">
            <span className="w-40 flex-shrink-0 truncate font-mono text-text-primary" title={c.name}>{c.name}</span>
            <span className="w-14 flex-shrink-0 text-2xs text-text-tertiary">{c.theme ?? ""}</span>
            {c.type === "removed" ? (
              <span className="text-text-tertiary">removed</span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                {c.type === "changed" && <><Value value={displayValue(c.kind, c.before)} /><ArrowRight size={10} className="flex-shrink-0 text-text-tertiary" /></>}
                <Value value={displayValue(c.kind, c.after)} />
                {c.type === "added" && <span className="text-2xs text-text-tertiary">new</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {changes.length > 8 && (
        <button className="mt-1 text-2xs text-text-tertiary underline hover:text-text-primary" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${changes.length}`}
        </button>
      )}
    </div>
  );
}

function Conflicts({ conflicts, takeTheirs, onToggle }: { conflicts: TokenConflict[]; takeTheirs: Set<number>; onToggle: (i: number, theirs: boolean) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text-primary">{conflicts.length} value{conflicts.length === 1 ? "" : "s"} changed in both places</p>
      <p className="mb-2 text-2xs leading-relaxed text-text-tertiary">Choose which to keep. Keeping Motif&apos;s value sends it to the repository in the next pull request.</p>
      <div className="flex flex-col gap-2">
        {conflicts.map((c, i) => (
          <div key={c.path.join("/")} className="rounded-md border border-surface-border p-2">
            <p className="mb-1.5 break-words font-mono text-xs text-text-primary">{c.label}</p>
            <div className="grid grid-cols-2 gap-1">
              {(["mine", "theirs"] as const).map((side) => {
                const selected = takeTheirs.has(i) === (side === "theirs");
                return (
                  <button
                    key={side}
                    aria-pressed={selected}
                    onClick={() => onToggle(i, side === "theirs")}
                    className={cn("flex min-w-0 flex-col items-start gap-0.5 rounded border px-2 py-1 text-left text-2xs transition-colors", selected ? "border-accent bg-accent/10 text-text-primary" : "border-transparent bg-surface-subtle text-text-secondary hover:text-text-primary")}
                  >
                    <span className="uppercase tracking-wider text-text-tertiary">{side === "mine" ? "Motif" : "Repository"}</span>
                    <Value value={side === "mine" ? c.mine : c.theirs} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Message({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p className={cn("text-xs leading-relaxed", notice.kind === "error" ? "text-red-400" : "text-emerald-500")} role="status">
      {notice.text}
      {notice.href && <> · <a href={notice.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">Open pull request <ExternalLink size={10} /></a></>}
    </p>
  );
}

// ── Not linked yet: the repository has tokens ─────────────────────────────────

function ImportSection({ state, repo, branch, onDone }: { state: RepoState; repo: string; branch: string; onDone: (n: Notice) => void }) {
  const { snapshot, analysis } = state;
  const counts = Object.values(snapshot.doc).reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.kind]: (acc[t.kind] ?? 0) + 1 }), {});
  const total = Object.keys(snapshot.doc).length;
  const readonly = Object.keys(snapshot.readonly).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-text-secondary">
        This repository has design tokens. Import them into a new Motif set; later syncs bring in changes from the repository and send yours back as a pull request.
      </p>
      <div className="rounded-md border border-surface-border p-3 text-xs">
        <p className="text-text-primary">{total} tokens will be imported</p>
        <p className="mt-0.5 text-text-secondary">
          {[counts.color && `${counts.color} colors`, counts.radius && `${counts.radius} radius`, counts.spacing && `${counts.spacing} spacing`, counts.shadow && `${counts.shadow} shadows`].filter(Boolean).join(" · ")}
          {analysis.themes.length > 1 && ` · themes: ${analysis.themes.join(", ")}`}
        </p>
        {readonly > 0 && <p className="mt-1 text-2xs text-amber-500">{readonly} are defined where Motif can read but not yet edit them, so changes to those stay in Motif.</p>}
        {snapshot.skipped.length > 0 && (
          <details className="mt-2 text-2xs text-text-tertiary">
            <summary className="cursor-pointer hover:text-text-secondary">{snapshot.skipped.length} left out</summary>
            <ul className="mt-1 list-disc pl-4">
              {snapshot.skipped.map((s) => <li key={s.name}><span className="font-mono">{s.name}</span>: {s.reason}</li>)}
            </ul>
          </details>
        )}
      </div>
      <button
        className={btnPrimary}
        onClick={() => {
          importRepoTokens(repo, branch, state);
          onDone({ kind: "ok", text: `Imported ${total} tokens into the set “${repo}”.` });
        }}
        disabled={total === 0}
      >
        Import into a new set
      </button>
    </div>
  );
}

// ── Not linked yet: the repository has no tokens ──────────────────────────────

function ExportSection({ state, connection, host, branch, onDone }: { state: RepoState; connection: GitConnection; host: Host; branch: string; onDone: (n: Notice) => void }) {
  const canSend = useCanSend(connection);
  const sets = useDesignSystemStore((s) => s.sets);
  const colors = useDesignSystemStore((s) => s.colors);
  const radii = useDesignSystemStore((s) => s.radii);
  const spacing = useDesignSystemStore((s) => s.spacing);
  const shadows = useDesignSystemStore((s) => s.shadows);
  const countIn = (id: string) => [colors, radii, spacing, shadows].reduce((n, list) => n + list.filter((t) => t.setId === id).length, 0);
  const options = sets.filter((s) => countIn(s.id) > 0);
  const [setId, setSetId] = useState(options[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const set = sets.find((s) => s.id === setId);
    if (!set) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await planExport(host, state, branch, set, tokenSlices());
      const tailwind = state.analysis.stack.tailwindVersion === 4;
      const note = plan.imported
        ? ""
        : `\n\n> Import \`${plan.tokensPath}\` from your stylesheet${tailwind ? " after the Tailwind import" : ""} to use these tokens.`;
      const pr = await openTokenPr({
        host, base: branch, files: plan.files,
        title: "Add design tokens from Motif",
        body: prBody(plan.changes, plan.skipped.map((s) => ({ ...s, theme: null })), { generated: true }) + note,
        message: "Add design tokens from Motif",
      });
      useGitStore.getState().setTokenLink({ ...plan.link, repo: repoSlug(connection), branch, pending: pr, syncedAt: Date.now() });
      onDone({ kind: "ok", text: `Opened pull request #${pr.number} adding ${Object.keys(plan.doc).length} tokens in ${plan.tokensPath}.`, href: pr.url });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-text-secondary">
        This repository has no design tokens yet. Send a Motif token set to it as a pull request that adds a stylesheet of CSS variables{state.analysis.stack.tailwindVersion === 4 ? " wired into Tailwind" : ""}.
      </p>
      {options.length === 0 ? (
        <p className="text-xs text-text-tertiary">There are no tokens in Motif to send yet.</p>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-text-tertiary">Token set</span>
          <select className="input-sm" value={setId} onChange={(e) => setSetId(e.target.value)}>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name} ({countIn(s.id)} tokens)</option>)}
          </select>
        </label>
      )}
      {!canSend && <p className="text-xs text-amber-500">Opening a pull request needs you to sign in with GitHub, or an access token with Contents and Pull requests read and write. Either is in the Git panel.</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button className={btnPrimary} onClick={create} disabled={busy || !canSend || !setId}>
        {busy && <Loader2 size={12} className="animate-spin" />}
        Create pull request
      </button>
    </div>
  );
}

// ── Linked ────────────────────────────────────────────────────────────────────

function SyncSection({ link, state, connection, host, onRefresh, notify }: {
  link: TokenLink; state: RepoState; connection: GitConnection; host: Host; onRefresh: () => void; notify: (n: Notice) => void;
}) {
  const canSend = useCanSend(connection);
  const setLink = useGitStore((s) => s.setTokenLink);
  const colors = useDesignSystemStore((s) => s.colors);
  const spacing = useDesignSystemStore((s) => s.spacing);
  const radii = useDesignSystemStore((s) => s.radii);
  const shadows = useDesignSystemStore((s) => s.shadows);
  const setName = useDesignSystemStore((s) => s.sets.find((x) => x.id === link.setId)?.name);
  const plan: SyncPlan = useMemo(() => planSync(link, { colors, spacing, radii, shadows }, state), [link, colors, spacing, radii, shadows, state]);
  const [takeTheirs, setTakeTheirs] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"apply" | "pr" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { conflicts } = plan.merge;
  const needsApply = conflicts.length > 0 || plan.toMotif.length > 0 || plan.merge.restored.length > 0;
  const inSync = !needsApply && plan.toRepo.length === 0;

  useEffect(() => {
    if (!link.pending) return;
    let stale = false;
    host.getPullRequest(link.pending.number).then((info) => {
      if (stale || info.state === "open") return;
      setLink({ ...link, pending: null });
      notify({ kind: "ok", text: info.merged ? `Pull request #${info.number} was merged.` : `Pull request #${info.number} was closed without merging.` });
      if (info.merged) onRefresh();
    }, () => undefined);
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.pending?.number]);

  const apply = () => {
    const next = applySyncPlan(link, plan, [...takeTheirs], state);
    setTakeTheirs(new Set());
    const parts = [plan.toMotif.length && `${plan.toMotif.length} changes brought into Motif`, plan.merge.restored.length && `${plan.merge.restored.length} tokens restored`].filter(Boolean);
    notify({ kind: "ok", text: parts.length ? `${parts.join(", ")}.` : "Updated." });
    return next;
  };

  const createPr = async () => {
    setBusy("pr");
    setError(null);
    try {
      const paths = filesNeeded(state.analysis);
      const read = await Promise.all(paths.map(async (p) => [p, await host.getFile(p, link.branch)] as const));
      const texts: Record<string, string> = {};
      const shas: Record<string, string> = {};
      for (const [path, file] of read) if (file) { texts[path] = file.text; shas[path] = file.sha; }

      const result = await applyEdits(texts, state.analysis, state.snapshot, plan.toRepo);
      const changed = Object.keys(result.files);
      if (changed.length === 0) {
        setError(result.skipped.length ? `Nothing could be written: ${result.skipped[0].reason}` : "There is nothing to send.");
        return;
      }
      const left = new Set(result.skipped.map((s) => `${s.name}/${s.theme ?? ""}`));
      const written = plan.toRepo.filter((c) => !left.has(`${c.name}/${c.theme}`) && !left.has(`${c.name}/`));
      const pr = await openTokenPr({
        host, base: link.branch,
        files: Object.fromEntries(changed.map((p) => [p, { text: result.files[p], sha: shas[p] ?? null }])),
        title: "Update design tokens from Motif",
        body: prBody(written, result.skipped, { generated: false }),
        message: "Update design tokens from Motif",
      });
      setLink({ ...link, pending: pr });
      notify({ kind: "ok", text: `Opened pull request #${pr.number} with ${written.length} changes.`, href: pr.url });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const prBlocked = !canSend ? "Opening a pull request needs you to sign in with GitHub, or an access token. Either is in the Git panel."
    : needsApply ? "Apply the changes above first."
    : link.pending ? `Pull request #${link.pending.number} is still open. Merge or close it first.`
    : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-secondary">
        Synced with <span className="font-medium text-text-primary">{link.repo}</span> on <span className="font-mono">{link.branch}</span>, using the set <span className="font-medium text-text-primary">{setName}</span>.
      </p>

      {link.pending && (
        <p className="text-xs text-text-secondary">
          Pull request <a href={link.pending.url} target="_blank" rel="noreferrer" className="underline">#{link.pending.number}</a> is open with Motif&apos;s changes.
        </p>
      )}

      {inSync && <p className="text-xs text-emerald-500">Motif and the repository have the same tokens.</p>}

      {conflicts.length > 0 && (
        <Conflicts conflicts={conflicts} takeTheirs={takeTheirs} onToggle={(i, theirs) => setTakeTheirs((prev) => { const n = new Set(prev); if (theirs) n.add(i); else n.delete(i); return n; })} />
      )}

      {plan.toMotif.length > 0 && <ChangeList changes={plan.toMotif} label="Coming from the repository" />}
      {plan.merge.restored.length > 0 && (
        <p className="text-2xs leading-relaxed text-text-tertiary">
          {plan.merge.restored.length} token{plan.merge.restored.length === 1 ? " was" : "s were"} deleted in Motif ({plan.merge.restored.slice(0, 4).join(", ")}{plan.merge.restored.length > 4 ? "…" : ""}) and will come back: syncing never deletes tokens from a repository, so remove them there if you want them gone.
        </p>
      )}
      {needsApply && (
        <button className={btnPrimary} onClick={apply} disabled={busy !== null}>
          {conflicts.length > 0 ? "Apply my choices" : "Apply to Motif"}
        </button>
      )}

      {plan.toRepo.length > 0 && (
        <>
          <ChangeList changes={plan.toRepo} label="Going to the repository" />
          {prBlocked && <p className="text-2xs leading-relaxed text-text-tertiary">{prBlocked}</p>}
          <button className={btnPrimary} onClick={createPr} disabled={busy !== null || prBlocked !== null}>
            {busy === "pr" && <Loader2 size={12} className="animate-spin" />}
            Create pull request
          </button>
        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button className="self-start text-2xs text-text-tertiary underline hover:text-text-primary" onClick={() => setLink(null)}>
        Stop syncing this set
      </button>
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

function Body({ connection }: { connection: GitConnection }) {
  const host = useGitHost(connection);
  const slug = repoSlug(connection);
  const storedLink = useGitStore((s) => s.tokenLink);
  const sets = useDesignSystemStore((s) => s.sets);
  const link = storedLink && storedLink.repo === slug && sets.some((s) => s.id === storedLink.setId) ? storedLink : null;
  const { branches } = useBranches(host);
  const [chosen, setChosen] = useState(connection.defaultBranch);
  const branch = link?.branch ?? chosen;

  const [state, setState] = useState<RepoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await readRepoState(host, slug, branch));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [host, slug, branch]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{slug}</span>
        {link ? (
          <span className="font-mono text-2xs text-text-tertiary">{branch}</span>
        ) : (
          <select className="input-sm !w-40" aria-label="Branch" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            {[...new Set([connection.defaultBranch, ...branches])].map((b) => <option key={b}>{b}</option>)}
          </select>
        )}
        <button className={btnSecondary} onClick={refresh} disabled={loading}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Check
        </button>
      </div>

      <Message notice={notice} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading && !state && <p className="flex items-center gap-2 text-xs text-text-tertiary"><Loader2 size={12} className="animate-spin" /> Reading the repository…</p>}

      {state && (
        link
          ? <SyncSection link={link} state={state} connection={connection} host={host} onRefresh={refresh} notify={setNotice} />
          : Object.keys(state.snapshot.doc).length > 0
            ? <ImportSection state={state} repo={slug} branch={branch} onDone={setNotice} />
            : <ExportSection state={state} connection={connection} host={host} branch={branch} onDone={setNotice} />
      )}
    </div>
  );
}

export default function TokenSyncDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const connection = useGitStore((s) => s.connection);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 select-text flex-col rounded-xl border border-surface-border bg-surface-raised text-text-primary shadow-2xl"
        >
          <div className="flex flex-shrink-0 items-center border-b border-surface-border px-4 py-3">
            <Dialog.Title className="flex-1 text-sm font-medium">Sync tokens with a repository</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close">
              <X size={13} />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto p-4">
            {connection ? <Body connection={connection} /> : <p className="text-xs text-text-secondary">Connect a repository in the Git panel first.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
