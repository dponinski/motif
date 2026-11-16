"use client";

import { useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Copy, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDesignSystemStore, type TokenSet, type TokenTheme } from "@/store/design-system";
import { editTokens } from "@/store/token-history";

// The themes of the open set, over its colors (the only tokens that differ by theme): which one is shown (or all of them side by side),
// and making, renaming, copying and deleting them. Each of those is a step of the Tokens screen's undo.

export type ThemeShown = "all" | string;

const item = "flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-surface-subtle data-[disabled]:cursor-default data-[disabled]:opacity-40";

const nameTaken = (themes: TokenTheme[], name: string, except?: string) =>
  themes.some((t) => t.id !== except && t.name.toLowerCase() === name.trim().toLowerCase());

// A name typed into the bar: Enter takes it, Escape and leaving without a change give it up. A name that is empty or taken is not taken.
function NameField({ initial, label, taken, onDone, onCancel }: { initial: string; label: string; taken: (name: string) => boolean; onDone: (name: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const name = text.trim();
  const bad = name !== "" && taken(name);
  const finish = (take: boolean) => {
    if (done.current) return;
    done.current = true;
    if (take && name && !bad && name !== initial) onDone(name); else onCancel();
  };
  return (
    <span className="flex flex-col">
      <input
        autoFocus
        aria-label={label}
        aria-invalid={bad}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          // A name a theme already has is said so and the field stays, so it can be changed; leaving the field gives it up.
          if (e.key === "Enter") { e.preventDefault(); if (!bad) finish(true); }
          else if (e.key === "Escape") { e.stopPropagation(); finish(false); }
        }}
        className={cn("w-28 rounded border bg-surface-base px-1.5 py-0.5 text-xs text-text-primary outline-none", bad ? "border-red-400" : "border-accent")}
      />
      {bad && <span role="alert" className="absolute mt-6 rounded bg-surface-raised px-1.5 py-0.5 text-2xs text-red-400 shadow">There is a theme called that</span>}
    </span>
  );
}

function Segment({ set, theme, on, onShow, onRename, onDuplicate, onDelete }: {
  set: TokenSet; theme: TokenTheme; on: boolean; onShow: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const only = set.themes.length === 1;
  return (
    <span className={cn("group/theme flex items-center rounded", on ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")} data-theme-segment={theme.id} onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}>
      <button type="button" aria-pressed={on} onClick={onShow} onDoubleClick={onRename} className="rounded-l px-2 py-1 text-xs" title={`Show ${theme.name}. Double-click to rename`}>{theme.name}</button>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger asChild>
          <button type="button" aria-label={`Theme menu: ${theme.name}`} className={cn("rounded-r px-1 py-1 text-text-tertiary hover:text-text-primary focus-visible:opacity-100", on || open ? "opacity-100" : "opacity-0 group-hover/theme:opacity-100")}>
            <MoreHorizontal size={11} />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={4} className="z-50 min-w-[170px] overflow-hidden rounded-md border border-surface-border bg-surface-raised py-1 text-xs text-text-secondary shadow-lg">
            <Menu.Item className={item} onSelect={onRename}><Pencil size={11} /> Rename</Menu.Item>
            <Menu.Item className={item} onSelect={onDuplicate}><Copy size={11} /> Duplicate</Menu.Item>
            <Menu.Separator className="my-1 h-px bg-surface-border" />
            <Menu.Item className={cn(item, "text-red-400")} disabled={only} onSelect={onDelete} title={only ? "A set keeps at least one theme" : undefined}><Trash2 size={11} /> Delete{only ? " (the only theme)" : ""}</Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
}

export default function ThemeBar({ set, shown, onShow }: { set: TokenSet; shown: ThemeShown; onShow: (id: ThemeShown) => void }) {
  const ds = () => useDesignSystemStore.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const taken = (except?: string) => (name: string) => nameTaken(set.themes, name, except);

  return (
    <div data-theme-bar role="toolbar" aria-label="Themes" className="flex flex-shrink-0 items-center gap-2 border-b border-surface-border px-4 py-1.5">
      <span className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">Themes</span>
      <div role="group" aria-label="Theme shown" className="flex items-center gap-0.5 rounded bg-surface-subtle p-0.5">
        {set.themes.length > 1 && (
          <button type="button" aria-pressed={shown === "all"} onClick={() => onShow("all")} title="Show every theme side by side" className={cn("rounded px-2 py-1 text-xs", shown === "all" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}>All</button>
        )}
        {set.themes.map((t) => renaming === t.id ? (
          <NameField key={t.id} initial={t.name} label={`Name of ${t.name}`} taken={taken(t.id)} onCancel={() => setRenaming(null)} onDone={(name) => { editTokens(() => ds().renameTheme(set.id, t.id, name)); setRenaming(null); }} />
        ) : (
          <Segment
            key={t.id}
            set={set}
            theme={t}
            on={shown === t.id || (set.themes.length === 1)}
            onShow={() => onShow(t.id)}
            onRename={() => setRenaming(t.id)}
            onDuplicate={() => { const id = editTokens(() => ds().duplicateTheme(set.id, t.id)); onShow(id); }}
            onDelete={() => { editTokens(() => ds().deleteThemeFromSet(set.id, t.id)); if (shown === t.id) onShow("all"); }}
          />
        ))}
      </div>
      {adding ? (
        <span className="flex items-center gap-1">
          <NameField initial="" label="New theme name" taken={taken()} onCancel={() => setAdding(false)} onDone={(name) => { const id = editTokens(() => ds().addThemeToSet(set.id, name)); setAdding(false); onShow(id); }} />
          <button type="button" aria-label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => setAdding(false)} className="text-text-tertiary hover:text-text-primary"><X size={11} /></button>
        </span>
      ) : (
        <button type="button" aria-label="Add theme" onClick={() => setAdding(true)} title="Add a theme: it starts as a copy of the one that is open" className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-tertiary hover:bg-surface-subtle hover:text-text-primary"><Plus size={11} /> Add</button>
      )}
    </div>
  );
}
