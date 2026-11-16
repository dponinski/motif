"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { finishPull } from "@/lib/pull";
import { usePullStatus } from "@/store/pull";
import { ChangeList, Conflicts } from "@/components/tokens/ChangeList";

// A pull takes in everything that doesn't clash and asks about the rest: a token value changed in the repository and here too.
function Body() {
  const pending = usePullStatus((s) => s.pending)!;
  const [takeTheirs, setTakeTheirs] = useState<Set<number>>(new Set());
  const { conflicts } = pending.plan.merge;
  const others = pending.plan.toMotif;
  const done = () => {
    const text = finishPull(pending, [...takeTheirs]);
    usePullStatus.getState().set({ pending: null, notice: { text, ok: true } });
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-text-secondary">
        Components are up to date. These token values were changed in the repository and here, so the choice is yours; the token changes that don&apos;t clash come in with it. Keeping Motif&apos;s value sends it to the repository in the next push.
      </p>
      <Conflicts conflicts={conflicts} takeTheirs={takeTheirs} onToggle={(i, theirs) => setTakeTheirs((prev) => { const n = new Set(prev); if (theirs) n.add(i); else n.delete(i); return n; })} />
      {others.length > 0 && <ChangeList changes={others} label="Also coming from the repository" />}
      <div className="flex gap-2">
        <button className="h-7 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent/90" onClick={done}>Apply my choices</button>
        <button className="h-7 rounded-md border border-surface-border px-3 text-xs text-text-secondary hover:bg-surface-subtle" onClick={() => usePullStatus.getState().set({ pending: null, notice: { text: "The repository's token changes were left for later: pull again to take them.", ok: true } })}>Decide later</button>
      </div>
    </div>
  );
}

export default function PullConflicts() {
  const open = usePullStatus((s) => s.pending !== null);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) usePullStatus.getState().set({ pending: null, notice: { text: "The repository's token changes were left for later: pull again to take them.", ok: true } }); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 select-text flex-col rounded-xl border border-surface-border bg-surface-raised text-text-primary shadow-2xl">
          <div className="flex flex-shrink-0 items-center border-b border-surface-border px-4 py-3">
            <Dialog.Title className="flex-1 text-sm font-medium">Token values changed in both places</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close"><X size={13} /></Dialog.Close>
          </div>
          <div className="overflow-y-auto p-4">{open && <Body />}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
