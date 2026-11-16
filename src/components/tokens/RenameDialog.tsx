"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { findRename } from "@/lib/tokens/rename-scan";
import { namesFor, type RenamePlan } from "@/lib/tokens/rename";
import { overlayOf, overlayReader } from "@/lib/work/overlay";
import { stageFiles } from "@/lib/work/stage";
import { readMotifTokens } from "@/lib/token-sync/doc";
import { tokenSlices } from "@/store/token-sync";
import { editScope } from "@/components/work/useWork";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { useDesignSystemStore, type TokenKind } from "@/store/design-system";
import { useEditStore } from "@/store/edit";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { editTokens } from "@/store/token-history";
import type { Row } from "./rows";

const field = "rounded border border-surface-border bg-surface-base px-2 py-1 text-xs text-text-primary outline-none focus:border-accent";
const primary = "h-7 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50";

// Renames a token the repository names: finds every place the repository's code names it, and puts the new names among the changes
// that Sync sends (one pull request), then renames Motif's token to match.
export default function RenameDialog(props: { row: Row | null; kind: TokenKind; taken: string[]; onClose: () => void }) {
  const connection = useGitStore((s) => s.connection);
  return connection ? <RenameBody key={props.row?.id ?? "none"} {...props} connection={connection} /> : null;
}

function RenameBody({ row, kind, taken, onClose, connection }: { row: Row | null; kind: TokenKind; taken: string[]; onClose: () => void; connection: GitConnection }) {
  const host = useGitHost(connection);
  const link = useGitStore((s) => s.tokenLink);
  const analysis = useGitStore((s) => s.analysis);
  const [to, setTo] = useState(row?.name ?? "");
  const [phase, setPhase] = useState<"name" | "reading" | "plan" | "adding">("name");
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repoName = (row?.token as { repoName?: string } | undefined)?.repoName ?? null;
  const token = useMemo(() => analysis?.tokens.find((t) => t.name === repoName) ?? null, [analysis, repoName]);

  const names = token && to.trim() ? namesFor(token, to, analysis!.tokens) : null;
  const problem = !token ? "This token isn't in the scan of the repository. Scan it again from Source control." : typeof names === "string" ? names : taken.includes(to.trim()) ? "A token of this set has that name" : null;
  const linked = !!link && link.repo === repoSlug(connection);

  const find = async () => {
    if (!row || !token || !link || problem) return;
    setPhase("reading");
    setError(null);
    setProgress(null);
    try {
      const reader = overlayReader(host, overlayOf(useEditStore.getState()));
      const result = await findRename({ reader, branch: link.branch, token, to: to.trim(), tokens: analysis!.tokens, onProgress: (done, total) => setProgress([done, total]) });
      if ("refused" in result) { setError(result.refused); setPhase("name"); return; }
      setPlan(result);
      setPhase("plan");
    } catch (err) {
      setError(errorMessage(err));
      setPhase("name");
    }
  };

  const apply = async () => {
    if (!row || !plan || !token || !link || typeof names === "string" || !names) return;
    setPhase("adding");
    setError(null);
    try {
      const lines = plan.places.map((p) => `- \`${p.path}\` (${p.n})`).join("\n");
      const summary = `Rename token ${token.name} to ${names.to} (${plan.total} place${plan.total === 1 ? "" : "s"} in ${plan.places.length} file${plan.places.length === 1 ? "" : "s"})\n${lines}`;
      if (plan.places.length > 0) await stageFiles({ host, branch: link.branch, scope: editScope(connection), files: plan.files, summary });
      editTokens(() => useDesignSystemStore.getState().renameRepoToken(kind, row.id, names.to));
      // The rename is among the changes now, so the tokens waiting to sync are the ones that changed besides it (without this, the old
      // name reads as removed and the new one as added).
      const latest = useGitStore.getState().tokenLink;
      if (latest && latest.repo === link.repo) {
        // A rename of a token that was renamed before goes from the first name.
        const earlier = Object.entries(latest.renamed ?? {}).find(([, r]) => r.to === token.name);
        const renamed = { ...latest.renamed };
        const origin = earlier ? earlier[0] : token.name;
        renamed[origin] = { to: names.to, paths: [...new Set([...(earlier?.[1].paths ?? []), ...Object.keys(plan.files)])] };
        useGitStore.getState().setTokenLink({ ...latest, renamed, staged: { doc: readMotifTokens(tokenSlices(), latest), paths: [...new Set([...(latest.staged?.paths ?? []), ...Object.keys(plan.files)])] } });
      }
      // What the scan says follows the rename, so the new name isn't taken for a token the repository doesn't have.
      const current = useGitStore.getState().analysis;
      if (current) {
        const usage = current.tokenUsage;
        useGitStore.getState().setAnalysis({
          ...current,
          tokens: current.tokens.map((t) => (t.name === token.name ? { ...t, name: names.to, tailwind: names.tailwindTo ?? t.tailwind } : t)),
          ...(usage ? { tokenUsage: Object.fromEntries(Object.entries(usage).map(([k, v]) => [k === token.name ? names.to : k, v])) } : {}),
        });
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setPhase("plan");
    }
  };

  const busy = phase === "reading" || phase === "adding";
  return (
    <Dialog.Root open={!!row} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[28rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <Dialog.Title className="flex-1 text-sm font-semibold text-text-primary">Rename {row?.name} in the repository</Dialog.Title>
            <Dialog.Close asChild><button type="button" aria-label="Close" disabled={busy} className="rounded p-1 text-text-tertiary hover:bg-surface-subtle disabled:opacity-40"><X size={14} /></button></Dialog.Close>
          </div>

          <p className="text-xs leading-relaxed text-text-secondary">
            Changes the token&apos;s name where the repository declares it, the Tailwind class that names it and every <code className="font-mono">var()</code> and class that uses it, as one change to your pull request.
          </p>

          <label className="flex flex-col gap-1 text-2xs text-text-tertiary">
            New name
            <input
              aria-label="New name"
              className={cn(field, "font-mono", problem && to.trim() && to.trim() !== row?.name && "border-red-500/60")}
              value={to}
              disabled={phase !== "name"}
              onChange={(e) => { setTo(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && phase === "name") { e.preventDefault(); void find(); } }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="min-h-[1rem] text-2xs text-text-tertiary" data-rename-problem>{!linked ? "Link this repository's tokens first (Repo sync)." : to.trim() && to.trim() !== row?.name && problem ? problem : ""}</p>

          {phase === "reading" && (
            <p className="flex items-center gap-2 text-xs text-text-secondary" role="status"><Loader2 size={12} className="animate-spin" /> Reading the code{progress ? ` (${progress[0]} of ${progress[1]} files)` : "…"}</p>
          )}

          {plan && (phase === "plan" || phase === "adding") && (
            <div className="flex min-h-0 flex-col gap-2" data-rename-plan>
              <p className="text-xs text-text-primary">
                {plan.total === 0 ? "Nothing in the repository's code names it, so only Motif's token changes." : <>Found <strong>{plan.total}</strong> place{plan.total === 1 ? "" : "s"} in <strong>{plan.places.length}</strong> file{plan.places.length === 1 ? "" : "s"}.</>}
              </p>
              {plan.places.length > 0 && (
                <ul className="min-h-0 overflow-y-auto rounded-md border border-surface-border text-2xs">
                  {plan.places.slice(0, 40).map((p) => (
                    <li key={p.path} className="flex items-center gap-2 border-b border-surface-border-subtle px-2 py-1 last:border-b-0"><span className="min-w-0 flex-1 truncate font-mono text-text-secondary" title={p.path}>{p.path}</span><span className="tabular-nums text-text-tertiary">{p.n}</span></li>
                  ))}
                  {plan.places.length > 40 && <li className="px-2 py-1 text-text-tertiary">and {plan.places.length - 40} more files</li>}
                </ul>
              )}
              {plan.unreadable.length > 0 && <p className="text-2xs text-amber-500">Left as they are, because they couldn&apos;t be read as stylesheets: {plan.unreadable.join(", ")}</p>}
              <p className="text-2xs leading-relaxed text-text-tertiary">Class names built while the page runs (<code className="font-mono">{"`bg-${x}`"}</code>) can&apos;t be seen, and Markdown files (documentation) are left as they are, so check for those. Nothing is sent until you press Sync.</p>
            </div>
          )}

          {error && <p role="alert" className="break-words text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={onClose} className="h-7 rounded-md border border-surface-border px-3 text-xs text-text-secondary hover:bg-surface-subtle disabled:opacity-50">Cancel</button>
            {phase === "name" || phase === "reading" ? (
              <button type="button" disabled={busy || !linked || !!problem || !to.trim() || to.trim() === row?.name} onClick={() => void find()} className={primary}>Find places</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void apply()} className={primary}>{phase === "adding" ? "Adding…" : "Rename and add to pull request"}</button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
