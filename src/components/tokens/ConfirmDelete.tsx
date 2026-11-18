"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

// Asking before something that takes tokens away: what goes, and that it can be undone. Escape and Cancel leave everything as it was.
export default function ConfirmDelete({ title, children, confirm, onConfirm, onClose, blocked }: {
  title: string;
  children: React.ReactNode;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
  // A reason the thing can't be deleted: it is said, and there is nothing to confirm.
  blocked?: string;
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby="confirm-delete-body" className="fixed left-1/2 top-1/2 z-50 flex w-[26rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <Dialog.Title className="flex-1 text-sm font-semibold text-text-primary">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary"><X size={12} /></Dialog.Close>
          </div>
          <div id="confirm-delete-body" className="flex flex-col gap-2 text-xs text-text-secondary">{blocked ? <p>{blocked}</p> : children}</div>
          <div className="flex justify-end gap-2">
            <Dialog.Close className="h-7 rounded-md border border-surface-border px-3 text-xs text-text-secondary hover:bg-surface-subtle">{blocked ? "Close" : "Cancel"}</Dialog.Close>
            {!blocked && <button type="button" onClick={onConfirm} autoFocus className="h-11 rounded-md bg-danger px-3 text-xs font-medium text-text-inverse hover:bg-danger/90">{confirm}</button>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
