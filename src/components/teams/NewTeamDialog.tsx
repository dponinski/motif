"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Users, X } from "lucide-react";
import { useTeams } from "@/store/teams";

// Starts a team, with the person as its owner. Inviting people comes after, from the team's own dialog.
export default function NewTeamDialog({ onCreated }: { onCreated?: (teamId: string) => void }) {
  const create = useTeams((s) => s.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await create(name);
    setBusy(false);
    if (r.error || !r.id) { setError(r.error ?? "That didn't work"); return; }
    setOpen(false);
    setName("");
    onCreated?.(r.id);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <Dialog.Trigger asChild>
        <button className="flex h-11 items-center gap-1.5 rounded-md border border-line px-3 text-[14px] text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary">
          <Users size={12} /> New team
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 w-[380px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-surface-border bg-surface-raised p-4 text-text-primary shadow-2xl">
          <div className="mb-3 flex items-center">
            <Dialog.Title className="flex-1 text-sm font-medium">New team</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close"><X size={13} /></Dialog.Close>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-text-secondary">A team shares design systems. Everyone in it can edit them, and you choose who is in it.</p>
            <input className="input-sm" aria-label="Team name" placeholder="Design team" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
            {error && <p className="text-xs text-danger" role="alert">{error}</p>}
            <button type="submit" disabled={busy || !name.trim()} className="flex h-11 items-center justify-center gap-1.5 rounded-md bg-blaze text-xs font-medium text-on-blaze transition-colors hover:bg-blaze/90 disabled:opacity-60">
              {busy && <Loader2 size={12} className="animate-spin" />} Create team
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
