"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FrameworkRefusal, planTailwind, tailwindBranchName, tailwindPrBody, type FrameworkPlan } from "@/lib/frameworks/tailwind";
import { readRepoState } from "@/lib/token-sync/flow";
import { openTokenPr } from "@/lib/token-sync/pr";
import { useReadRepository } from "@/components/stage/useReadRepository";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import FirstCommit from "./FirstCommit";
import { errorMessage, useCanSend, useGitHost } from "./hooks";

const btnPrimary = "h-8 px-3 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";
const btnSecondary = "h-8 px-3 border border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-subtle disabled:opacity-50 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";

function Body({ connection }: { connection: GitConnection }) {
  const host = useGitHost(connection);
  const canSend = useCanSend(connection);
  const read = useReadRepository();
  const branch = connection.defaultBranch;
  const [empty, setEmpty] = useState(false);
  const [plan, setPlan] = useState<FrameworkPlan | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: number; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRefusal(null);
    setPlan(null);
    try {
      if (await host.isEmpty()) { setEmpty(true); return; }
      setEmpty(false);
      const next = await readRepoState(host, repoSlug(connection), branch);
      try {
        setPlan(await planTailwind(host, next, branch, connection.repo));
      } catch (err) {
        if (!(err instanceof FrameworkRefusal)) throw err;
        setRefusal(err.message);
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
      const pr = await openTokenPr({
        host, base: branch, files: plan.files, branch: tailwindBranchName(),
        title: "Add Tailwind CSS v4",
        body: tailwindPrBody(plan),
        message: "Add Tailwind CSS v4",
      });
      setDone({ number: pr.number, url: pr.url });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-text-secondary">
        A framework is added to the repository like a dependency: as a pull request. Once it is merged and the repository is read again, Motif edits styles with the framework&apos;s classes.
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
      {error && <p className="break-words text-xs text-red-400" role="alert">{error}</p>}
      {refusal && <p className="text-xs leading-relaxed text-text-secondary" role="status" data-refused>{refusal}</p>}
      {empty && <FirstCommit connection={connection} onDone={() => void load()} />}

      {plan && !done && (
        <div className="flex flex-col gap-2" data-plan>
          <p className="text-2xs font-medium uppercase tracking-wider text-text-tertiary">The pull request will</p>
          <ul className="flex flex-col gap-1">
            {plan.summary.map((s) => (
              <li key={s.path} className="text-xs text-text-secondary"><span className="font-mono text-text-primary">{s.path}</span>: {s.what}</li>
            ))}
          </ul>
          {plan.notes.map((n) => <p key={n} className="text-2xs leading-relaxed text-amber-500">{n}</p>)}
          {!canSend && <p className="text-xs text-amber-500">Opening a pull request needs you to sign in with GitHub, or an access token with Contents and Pull requests read and write. Either is in the Git panel.</p>}
          <button className={cn(btnPrimary, "self-start")} onClick={() => void create()} disabled={busy || !canSend}>
            {busy && <Loader2 size={12} className="animate-spin" />} Create pull request
          </button>
        </div>
      )}

      {done && (
        <div className="flex flex-col gap-2 rounded-md border border-surface-border p-3" role="status" data-done>
          <p className="flex items-center gap-1.5 text-xs text-text-primary"><Check size={12} className="text-emerald-500" /> Opened pull request #{done.number}.</p>
          <a href={done.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent underline">View it on GitHub <ExternalLink size={10} /></a>
          <p className="text-2xs leading-relaxed text-text-tertiary">Merge it, then read the repository again.</p>
          <button className={cn(btnSecondary, "self-start")} onClick={() => void read()}>Read the repository again</button>
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
            {connection ? <Body connection={connection} /> : <p className="text-xs text-text-secondary">Connect a repository first.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
