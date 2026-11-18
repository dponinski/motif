"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupItems } from "@/lib/tokens/organize";
import type { Row } from "./rows";
import type { Selection } from "./useSelection";
import type { Drag } from "./drag";

// The tokens of one kind as groups: each with a header (select all of it, fold it, rename it, add to it) and, below, whatever
// the view draws for the group's tokens. A header is also where tokens are dropped to put them in that group.
export default function GroupedTokens({
  rows, selection, drag, renderBody, addRow, onRenameGroup, adding, onAdding, empty,
}: {
  rows: Row[];
  selection: Selection;
  drag: Drag;
  renderBody: (rows: Row[], group: string) => React.ReactNode;
  addRow: (group: string, done: () => void) => React.ReactNode;
  onRenameGroup: (from: string, to: string) => void;
  adding: string | null;
  onAdding: (group: string | null) => void;
  empty: React.ReactNode;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ group: string; text: string } | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const groups = groupItems(rows);

  const fold = (group: string) => setFolded((f) => { const n = new Set(f); if (!n.delete(group)) n.add(group); return n; });
  const finishRename = () => {
    if (renaming && renaming.text.trim() && renaming.text.trim() !== renaming.group) onRenameGroup(renaming.group, renaming.text.trim());
    setRenaming(null);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-token-groups>
      {groups.length === 0 && adding === null && newGroup === null && empty}
      {groups.map(({ group, items }) => {
        const ids = items.map((r) => r.id);
        const all = ids.length > 0 && ids.every((id) => selection.selected.has(id));
        const some = ids.some((id) => selection.selected.has(id));
        const isFolded = folded.has(group);
        const target = drag.over?.type === "group" && drag.over.group === group;
        return (
          <section key={group} data-group={group} className="mb-1">
            <div
              data-group-drop={group}
              className={cn("group/head flex items-center gap-2 px-4 py-1.5 transition-colors", target ? "bg-accent/15 outline outline-1 -outline-offset-1 outline-accent" : "hover:bg-surface-subtle")}
            >
              <input
                type="checkbox"
                aria-label={`Select the ${group} group`}
                checked={all}
                ref={(el) => { if (el) el.indeterminate = some && !all; }}
                onChange={() => selection.setMany(ids, !all)}
                className="h-3 w-3 flex-shrink-0 accent-[var(--cobalt)]"
              />
              <button type="button" onClick={() => fold(group)} aria-expanded={!isFolded} aria-label={`${isFolded ? "Open" : "Fold"} ${group}`} className="text-text-tertiary hover:text-text-primary">
                {isFolded ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              </button>
              {renaming?.group === group ? (
                <input
                  autoFocus
                  aria-label={`Name of the ${group} group`}
                  value={renaming.text}
                  onChange={(e) => setRenaming({ group, text: e.target.value })}
                  onBlur={finishRename}
                  onKeyDown={(e) => { if (e.key === "Enter") finishRename(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                  className="rounded border border-accent bg-surface-base px-1 text-2xs font-semibold uppercase tracking-wider text-text-primary outline-none"
                />
              ) : (
                <button type="button" onDoubleClick={() => setRenaming({ group, text: group })} title="Double-click to rename the group" className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary">
                  {group}
                </button>
              )}
              <span className="text-2xs text-text-tertiary tabular-nums">{items.length}</span>
              <div className="flex-1" />
              <button type="button" onClick={() => onAdding(group)} aria-label={`Add to ${group}`} title={`Add a token to ${group}`} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-text-tertiary opacity-0 transition-opacity hover:bg-surface-overlay hover:text-text-primary focus:opacity-100 group-hover/head:opacity-100">
                <Plus size={10} /> Add
              </button>
            </div>
            {adding === group && addRow(group, () => onAdding(null))}
            {!isFolded && renderBody(items, group)}
          </section>
        );
      })}
      {adding !== null && !groups.some((g) => g.group === adding) && (
        <section>
          <div className="px-4 py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-tertiary">{adding}</div>
          {addRow(adding, () => onAdding(null))}
        </section>
      )}
      {newGroup === null ? (
        <button type="button" onClick={() => setNewGroup("")} className="flex w-full items-center gap-1.5 px-4 min-h-11 py-2 text-left text-2xs text-text-tertiary transition-colors hover:bg-surface-subtle hover:text-text-secondary">
          <Plus size={10} /> New group
        </button>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2">
          <input
            autoFocus
            aria-label="Name of the new group"
            placeholder="Group name"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newGroup.trim()) { onAdding(newGroup.trim()); setNewGroup(null); }
              if (e.key === "Escape") { e.stopPropagation(); setNewGroup(null); }
            }}
            className="w-48 rounded border border-surface-border bg-surface-base px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent"
          />
          <button type="button" onClick={() => setNewGroup(null)} className="text-2xs text-text-tertiary hover:text-text-primary">Cancel</button>
        </div>
      )}
    </div>
  );
}
