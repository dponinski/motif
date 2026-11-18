"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FrameworkRefusal, planTailwind, tailwindSummary, type FrameworkPlan } from "@/lib/frameworks/tailwind";
import { readRepoState } from "@/lib/token-sync/flow";
import { overlayOf, overlayReader } from "@/lib/work/overlay";
import { stageFiles } from "@/lib/work/stage";
import { editScope } from "@/components/work/useWork";
import { useEditStore } from "@/store/edit";
import { useNavRequest } from "@/store/nav";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { errorMessage, useGitHost } from "./hooks";

const btnPrimary = "h-11 px-3 bg-blaze hover:bg-blaze/90 disabled:opacity-50 text-on-blaze text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";
const btnSecondary = "h-11 px-3 border border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-subtle disabled:opacity-50 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";

function Body({ connection, onOpenSync }: { connection: GitConnection; onOpenSync: () => void }) {
  const host = useGitHost(connection);
  const branch = connection.defaultBranch;
  const [plan, setPlan] = useState<FrameworkPlan | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRefusal(null);
    setPlan(null);
    try {
      // Planned against the repository with the editor's changes in it, so what is already in the pull request counts.
      const oh = overlayReader(host, overlayOf(useEditStore.getState()));
      const next = await readRepoState(oh, repoSlug(connection), branch);
      try {
        setPlan(await planTailwind(oh, next, branch, connection.repo));
      } catch (err) {
        if (!(err instanceof FrameworkRefusal)) throw err;
        // Say whether it is in the repository or only in the pull request.
        const real = next.analysis.stack.tailwindVersion === 4 ? await readRepoState(host, repoSlug(connection), branch).catch(() => null) : null;
        setRefusal(real && real.analysis.stack.tailwindVersion !== 4 ? "Tailwind CSS v4 is already in your pull request." : err.message);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [host, connection, branch]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await stageFiles({ host, branch, scope: editScope(connection), files: Object.fromEntries(Object.entries(plan.files).map(([p, f]) => [p, f.text])), summary: tailwindSummary(plan) });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-text-secondary">
        A framework is added to the repository like a dependency: in your pull request, with your other changes. Motif edits styles with the framework&apos;s classes straight away, and the repository has it once the pull request is merged.
      </p>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-2 rounded-md border border-accent/50 bg-surface-subtle px-3 py-2.5">
          <input type="radio" checked readOnly className="mt-0.5" aria-label="Tailwind CSS v4" />
          <span className="flex flex-col">
            <span className="text-xs font-medium text-text-primary">Tailwind CSS v4</span>
            <span className="text-2xs leading-relaxed text-text-tertiary">Utility classes, with your tokens as theme values.</span>
          </span>
        </label>
        <p className="text-2xs text-text-tertiary">More frameworks will be added later.</p>
      </div>

      {loading && <p className="flex items-center gap-2 text-xs text-text-tertiary"><Loader2 size={12} className="animate-spin" /> Reading the repository…</p>}
      {error && <p className="break-words text-xs text-danger" role="alert">{error}</p>}
      {refusal && <p className="text-xs leading-relaxed text-text-secondary" role="status" data-refused>{refusal}</p>}

      {plan && !done && (
        <div className="flex flex-col gap-2" data-plan>
          <p className="text-2xs font-medium uppercase tracking-wider text-text-tertiary">Your pull request will get</p>
          <ul className="flex flex-col gap-1">
            {plan.summary.map((s) => (
              <li key={s.path} className="text-xs text-text-secondary"><span className="font-mono text-text-primary">{s.path}</span>: {s.what}</li>
            ))}
          </ul>
          {plan.notes.map((n) => <p key={n} className="text-2xs leading-relaxed text-ink">{n}</p>)}
          <button className={cn(btnPrimary, "self-start")} onClick={() => void create()} disabled={busy}>
            {busy && <Loader2 size={12} className="animate-spin" />} Add to pull request
          </button>
        </div>
      )}

      {done && (
        <div className="flex flex-col gap-2 rounded-md border border-surface-border p-3" role="status" data-done>
          <p className="flex items-center gap-1.5 text-xs text-text-primary"><Check size={12} className="text-success" /> Added to your pull request.</p>
          <p className="text-2xs leading-relaxed text-text-tertiary">Press Sync to send it with your other changes.</p>
          <button className={cn(btnSecondary, "self-start")} onClick={onOpenSync}>Open Sync</button>
        </div>
      )}
    </div>
  );
}

export default function FrameworkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const connection = useGitStore((s) => s.connection);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 select-text flex-col rounded-xl border border-surface-border bg-surface-raised text-text-primary shadow-2xl"
        >
          <div className="flex flex-shrink-0 items-center border-b border-surface-border px-4 py-3">
            <Dialog.Title className="flex-1 text-sm font-medium">Add a framework</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close"><X size={13} /></Dialog.Close>
          </div>
          <div className="overflow-y-auto p-4">
            {connection ? <Body connection={connection} onOpenSync={() => { onOpenChange(false); useNavRequest.getState().ask("git"); }} /> : <p className="text-xs text-text-secondary">Connect a repository first.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
