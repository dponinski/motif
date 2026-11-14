"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isColorValue } from "@/lib/repo-scan/summary";
import { planExport, planSync, readRepoState, type RepoState, type SyncPlan, type TokenLink } from "@/lib/token-sync/flow";
import { displayValue, type TokenChange, type TokenConflict } from "@/lib/token-sync/merge";
import { tokenSummary } from "@/lib/token-sync/pr";
import { overlayOf, overlayReader } from "@/lib/work/overlay";
import { stageFiles } from "@/lib/work/stage";
import { editScope } from "@/components/work/useWork";
import { useEditStore } from "@/store/edit";
import { useNavRequest } from "@/store/nav";
import { useDesignSystemStore } from "@/store/design-system";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { applySyncPlan, importRepoTokens, tokenSlices } from "@/store/token-sync";
import { errorMessage, useBranches, useGitHost } from "./hooks";

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

function ExportSection({ state, connection, host, branch, onDone, onOpenSync }: { state: RepoState; connection: GitConnection; host: Host; branch: string; onDone: (n: Notice) => void; onOpenSync: () => void }) {
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
  // The pull request is made from the default branch, so that is where the tokens go.
  const wrongBranch = branch !== connection.defaultBranch;

  const create = async () => {
    const set = sets.find((s) => s.id === setId);
    if (!set) return;
    setBusy(true);
    setError(null);
    try {
      // Planned against the repository with the editor's changes in it: a framework that is already in the pull request
      // is part of it.
      const oh = overlayReader(host, overlayOf(useEditStore.getState()));
      const planned = await readRepoState(oh, repoSlug(connection), branch);
      const plan = await planExport(oh, planned, branch, set, tokenSlices());
      const tailwind = planned.analysis.stack.tailwindVersion === 4;
      const summary = tokenSummary(plan.changes, plan.skipped.map((s) => ({ ...s, theme: null })), { generated: true })
        + (plan.imported ? "" : `\nImport \`${plan.tokensPath}\` from your stylesheet${tailwind ? " after the Tailwind import" : ""} to use these tokens.`);
      const files = Object.fromEntries(Object.entries(plan.files).map(([p, f]) => [p, f.text]));
      await stageFiles({ host, branch, scope: editScope(connection), files, summary });
      useGitStore.getState().setTokenLink({ ...plan.link, repo: repoSlug(connection), branch, staged: { doc: plan.doc, paths: Object.keys(files) }, syncedAt: Date.now() });
      onDone({ kind: "ok", text: `Added ${Object.keys(plan.doc).length} tokens in ${plan.tokensPath} to your pull request. Press Sync to send them.` });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-text-secondary">
        This repository has no design tokens yet. Add a Motif token set to your pull request as a stylesheet of CSS variables{state.analysis.stack.tailwindVersion === 4 ? " wired into Tailwind" : ""}. It is sent with everything else when you press Sync.
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
      {wrongBranch && <p className="text-xs text-amber-500">Changes go to a pull request from {connection.defaultBranch}. Choose {connection.defaultBranch} to add tokens.</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button className={btnPrimary} onClick={create} disabled={busy || !setId || wrongBranch}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          Add to pull request
        </button>
        <button className={btnSecondary} onClick={onOpenSync}>Open Sync</button>
      </div>
    </div>
  );
}

// ── Linked ────────────────────────────────────────────────────────────────────

function SyncSection({ link, state, connection, onOpenSync, notify }: {
  link: TokenLink; state: RepoState; connection: GitConnection; onOpenSync: () => void; notify: (n: Notice) => void;
}) {
  const setLink = useGitStore((s) => s.setTokenLink);
  const colors = useDesignSystemStore((s) => s.colors);
  const spacing = useDesignSystemStore((s) => s.spacing);
  const radii = useDesignSystemStore((s) => s.radii);
  const shadows = useDesignSystemStore((s) => s.shadows);
  const setName = useDesignSystemStore((s) => s.sets.find((x) => x.id === link.setId)?.name);
  const plan: SyncPlan = useMemo(() => planSync(link, { colors, spacing, radii, shadows }, state), [link, colors, spacing, radii, shadows, state]);
  const [takeTheirs, setTakeTheirs] = useState<Set<number>>(new Set());

  const { conflicts } = plan.merge;
  const needsApply = conflicts.length > 0 || plan.toMotif.length > 0 || plan.merge.restored.length > 0;
  const inSync = !needsApply && plan.toRepo.length === 0;
  const wrongBranch = link.branch !== connection.defaultBranch;

  const apply = () => {
    const next = applySyncPlan(link, plan, [...takeTheirs], state);
    setTakeTheirs(new Set());
    const parts = [plan.toMotif.length && `${plan.toMotif.length} changes brought into Motif`, plan.merge.restored.length && `${plan.merge.restored.length} tokens restored`].filter(Boolean);
    notify({ kind: "ok", text: parts.length ? `${parts.join(", ")}.` : "Updated." });
    return next;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-secondary">
        Synced with <span className="font-medium text-text-primary">{link.repo}</span> on <span className="font-mono">{link.branch}</span>, using the set <span className="font-medium text-text-primary">{setName}</span>.
      </p>

      {wrongBranch && (
        <p className="text-xs text-amber-500">
          This link is to {link.branch}, but changes go to a pull request from {connection.defaultBranch}, so these tokens aren&apos;t sent. Stop syncing this set and link it again on {connection.defaultBranch}.
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
        <button className={btnPrimary} onClick={apply}>
          {conflicts.length > 0 ? "Apply my choices" : "Apply to Motif"}
        </button>
      )}

      {plan.toRepo.length > 0 && (
        <>
          <ChangeList changes={plan.toRepo} label="Not in the repository yet" />
          <p className="text-2xs leading-relaxed text-text-tertiary">
            {needsApply
              ? "Apply the changes above first: until then these tokens are not added to the pull request."
              : "These are added to your pull request when you press Sync, together with your other changes."}
          </p>
          <button className={btnSecondary} onClick={onOpenSync}>Open Sync</button>
        </>
      )}

      <button className="self-start text-2xs text-text-tertiary underline hover:text-text-primary" onClick={() => setLink(null)}>
        Stop syncing this set
      </button>
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

function Body({ connection, onOpenSync }: { connection: GitConnection; onOpenSync: () => void }) {
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
      const next = await readRepoState(host, slug, branch);
      setState(next);
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
          ? <SyncSection link={link} state={state} connection={connection} onOpenSync={onOpenSync} notify={setNotice} />
          : Object.keys(state.snapshot.doc).length > 0
            ? <ImportSection state={state} repo={slug} branch={branch} onDone={setNotice} />
            : <ExportSection state={state} connection={connection} host={host} branch={branch} onDone={setNotice} onOpenSync={onOpenSync} />
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
            {connection ? <Body connection={connection} onOpenSync={() => { onOpenChange(false); useNavRequest.getState().ask("sync"); }} /> : <p className="text-xs text-text-secondary">Connect a repository in the Git panel first.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
