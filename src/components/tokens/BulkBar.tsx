"use client";

import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Copy, FolderInput, Layers, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Row } from "./rows";
import type { TokenSet } from "@/store/design-system";

// What can be done to the tokens that are picked: put them in a group or another set, copy them, take them away.
export default function BulkBar({
  picked, groups, sets, setId, onGroup, onSet, onDuplicate, onDelete, onClear,
}: {
  picked: Row[];
  groups: string[];
  sets: TokenSet[];
  setId: string;
  onGroup: (group: string) => void;
  onSet: (setId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  // Deleting asks again, for a few seconds, about the same tokens.
  const [armed, setArmed] = useState<number | null>(null);
  const confirm = armed === picked.length;
  const setConfirm = (on: boolean) => setArmed(on ? picked.length : null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  if (picked.length === 0) return null;
  const linked = picked.filter((r) => r.linked).length;
  const used = picked.filter((r) => (r.use?.n ?? 0) > 0).length;
  const others = sets.filter((s) => s.id !== setId);
  const button = "flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary";

  return (
    <div role="toolbar" aria-label="Selected tokens" data-bulk-bar className="flex flex-shrink-0 items-center gap-1 border-b border-accent/30 bg-accent/10 px-4 py-1.5">
      <span className="mr-2 text-xs font-medium text-accent">{picked.length} selected</span>

      <Popover.Root open={groupOpen} onOpenChange={setGroupOpen}>
        <Popover.Trigger asChild><button type="button" className={button}><FolderInput size={12} /> Move to group</button></Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} aria-label="Move to group" className="z-50 w-56 rounded-lg border border-surface-border bg-surface-raised p-1.5 shadow-xl">
            <div className="max-h-48 overflow-y-auto">
              {groups.map((g) => (
                <button key={g} type="button" onClick={() => { onGroup(g); setGroupOpen(false); }} className="block w-full truncate rounded px-2 py-1 text-left text-xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary">{g}</button>
              ))}
            </div>
            <div className="mt-1 flex items-center gap-1 border-t border-surface-border pt-1.5">
              <input
                aria-label="New group"
                placeholder="New group…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onGroup(text.trim()); setText(""); setGroupOpen(false); } }}
                className="min-w-0 flex-1 rounded border border-surface-border bg-surface-base px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent"
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {others.length > 0 && (
        <Popover.Root>
          <Popover.Trigger asChild><button type="button" className={button}><Layers size={12} /> Move to set</button></Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={4} aria-label="Move to set" className="z-50 w-52 rounded-lg border border-surface-border bg-surface-raised p-1.5 shadow-xl">
              {others.map((s) => (
                <Popover.Close key={s.id} asChild>
                  <button type="button" onClick={() => onSet(s.id)} className="block w-full truncate rounded px-2 py-1 text-left text-xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary">{s.name}</button>
                </Popover.Close>
              ))}
              <p className="mt-1 border-t border-surface-border px-2 pt-1.5 text-2xs text-text-tertiary">In the other set they are Motif&apos;s own until that set is synced.</p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}

      <button type="button" onClick={onDuplicate} className={button}><Copy size={12} /> Duplicate</button>
      <button
        type="button"
        onClick={() => (confirm ? onDelete() : setConfirm(true))}
        title={linked > 0 ? `${linked} of these ${linked === 1 ? "is" : "are"} in the repository and will come back at the next sync${used > 0 ? `; ${used} used in its code` : ""}` : undefined}
        className={cn(button, confirm ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 hover:text-red-400" : "hover:text-red-400")}
      >
        <Trash2 size={12} /> {confirm ? `Delete ${picked.length}?` : "Delete"}
      </button>
      {confirm && linked > 0 && <span className="text-2xs text-text-tertiary">{linked} in the repository will come back at the next sync{used > 0 ? ` (${used} used in its code, which this doesn't change)` : ""}</span>}

      <div className="flex-1" />
      <button type="button" onClick={onClear} aria-label="Clear the selection" title="Clear the selection (Esc)" className="rounded p-1 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"><X size={12} /></button>
    </div>
  );
}
