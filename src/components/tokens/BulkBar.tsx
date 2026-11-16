"use client";

import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CornerDownRight, Copy, FolderInput, Layers, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Row } from "./rows";
import type { TokenSet, TokenTheme } from "@/store/design-system";

// Making the picked colors other tokens: for each theme, the token (by key) all of them become, null to keep the color they are.
export interface AliasBulk {
  themes: TokenTheme[];
  targets: { key: string; name: string }[];
  // Does it, and says how many (color, theme) pairs could not be (a token that would lead back to itself).
  apply: (choices: Record<string, string | null>) => number;
}
const KEEP = "";
const DETACH = "\0detach";

function AliasPopover({ alias, count, onDone, className }: { alias: AliasBulk; count: number; onDone: (refused: number) => void; className: string }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const chosen = Object.values(choice).some((v) => v !== KEEP && v !== undefined);
  const go = () => {
    const map: Record<string, string | null> = {};
    for (const t of alias.themes) { const v = choice[t.id] ?? KEEP; if (v === DETACH) map[t.id] = null; else if (v !== KEEP) map[t.id] = v; }
    const refused = alias.apply(map);
    setOpen(false);
    setChoice({});
    onDone(refused);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><button type="button" className={className}><CornerDownRight size={12} /> Make alias…</button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} aria-label="Make alias" className="z-50 w-72 rounded-lg border border-surface-border bg-surface-raised p-3 shadow-xl">
          <p className="mb-2 text-xs text-text-secondary">Make {count} color{count === 1 ? "" : "s"} another token, in each theme on its own.</p>
          <div className="flex flex-col gap-1.5">
            {alias.themes.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-2xs text-text-tertiary">
                <span className="w-12 flex-shrink-0">{t.name}</span>
                <select aria-label={`${t.name} becomes`} value={choice[t.id] ?? KEEP} onChange={(e) => setChoice((c) => ({ ...c, [t.id]: e.target.value }))} className="min-w-0 flex-1 rounded border border-surface-border bg-surface-base px-1 py-1 text-xs text-text-primary outline-none">
                  <option value={KEEP}>Leave as it is</option>
                  <option value={DETACH}>Detach (keep the color it is)</option>
                  {alias.targets.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button type="button" disabled={!chosen} onClick={go} className="mt-3 w-full rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Apply</button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// What can be done to the tokens that are picked: put them in a group or another set, copy them, take them away.
export default function BulkBar({
  picked, groups, sets, setId, alias, onGroup, onSet, onDuplicate, onDelete, onClear,
}: {
  // For colors: making them other tokens.
  alias?: AliasBulk;
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
  const [aliasNote, setAliasNote] = useState<string | null>(null);
  useEffect(() => {
    if (aliasNote === null) return;
    const t = setTimeout(() => setAliasNote(null), 5000);
    return () => clearTimeout(t);
  }, [aliasNote]);
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

      {alias && <AliasPopover alias={alias} count={picked.length} className={button} onDone={(refused) => setAliasNote(refused > 0 ? `${refused} couldn't be made one: it would lead back to the token itself` : "Done")} />}
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

      {aliasNote && <span role="status" data-alias-note className="text-2xs text-text-tertiary">{aliasNote}</span>}
      <div className="flex-1" />
      <button type="button" onClick={onClear} aria-label="Clear the selection" title="Clear the selection (Esc)" className="rounded p-1 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"><X size={12} /></button>
    </div>
  );
}
