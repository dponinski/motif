"use client";

import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Component, Plus } from "lucide-react";
import { PALETTE, SNIPPETS, componentSnippet } from "@/lib/edit/snippets";
import type { ImportSpec } from "@/lib/edit/imports";
import type { LibraryComponent } from "@/lib/preview/library";
import ElementIcon from "@/components/panels/ElementIcon";
import { describeTag } from "@/lib/edit/names";
import Tip from "@/components/Tip";
import { cn } from "@/lib/utils";

export interface PaletteItem { id: string; label: string; jsx: string; imp?: ImportSpec; icon: ReturnType<typeof describeTag>["icon"] }

const TAG_OF_SNIPPET: Record<string, string> = { div: "div", row: "div", column: "div", text: "span", heading: "h2", image: "img", button: "button", link: "a", list: "ul" };

// What can be added to a component: the elements a designer reaches for first, then the repository's own components. A press adds
// the element to the one that is picked (or to the component itself when none is); dragging it onto the canvas puts it where it
// is let go, with a line showing where.
export default function InsertPalette({ components, onInsert, onDrag }: {
  components: LibraryComponent[];
  onInsert: (item: PaletteItem) => void;
  // A drag has begun from an item: the pointer is captured by it, so the page sees the moves and the release.
  onDrag: (item: PaletteItem) => void;
}) {
  const [open, setOpen] = useState(false);
  // While an item is dragged out, the panel is hidden so that it doesn't cover where it is going (it stays mounted, which keeps the pointer's capture).
  const [away, setAway] = useState(false);
  const press = useRef<{ x: number; y: number; item: PaletteItem } | null>(null);
  const dragging = useRef(false);

  const items = useMemo<PaletteItem[]>(
    () => PALETTE.flatMap((p) => {
      const snippet = SNIPPETS.find((s) => s.id === p.id);
      return snippet ? [{ id: p.id, label: p.label, jsx: snippet.jsx, icon: describeTag(TAG_OF_SNIPPET[p.id] ?? "div").icon }] : [];
    }),
    []
  );
  const own = useMemo<PaletteItem[]>(
    () => components.map((c) => { const { jsx, imp } = componentSnippet(c); return { id: `lib:${c.id}`, label: c.name, jsx, imp, icon: "component" as const }; }),
    [components]
  );

  const row = (item: PaletteItem) => (
    <button
      key={item.id}
      type="button"
      data-palette-item={item.label}
      aria-label={`Add ${item.label}`}
      onPointerDown={(e) => { press.current = { x: e.clientX, y: e.clientY, item }; dragging.current = false; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the drag still works over the panel */ } }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
        press.current = null;
        dragging.current = true;
        onDrag(p.item);
        setAway(true);
      }}
      onPointerUp={() => {
        const p = press.current;
        press.current = null;
        if (p) onInsert(p.item);
        dragging.current = false;
        setAway(false);
        setOpen(false);
      }}
      onPointerCancel={() => { press.current = null; dragging.current = false; setAway(false); setOpen(false); }}
      className="flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-secondary outline-none hover:bg-surface-subtle hover:text-text-primary focus-visible:bg-surface-subtle"
    >
      <ElementIcon name={item.icon} size={13} className="flex-shrink-0 text-text-tertiary" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </button>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label="Add an element">
        <Popover.Trigger asChild>
          <button type="button" aria-label="Add element" className="flex h-7 items-center gap-1 rounded bg-surface-subtle px-2 text-xs text-text-secondary transition-colors hover:bg-surface-border hover:text-text-primary">
            <Plus size={12} /> Add
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-label="Add element" data-insert-palette className={cn("z-50 w-[220px] rounded-lg border border-surface-border bg-surface-raised p-1.5 text-text-primary shadow-2xl", away && "opacity-0")}>
          <p className="px-2 pb-1 text-2xs text-text-tertiary">Press to add to the picked element, or drag onto the canvas.</p>
          <div className="grid grid-cols-2 gap-0.5">{items.map(row)}</div>
          {own.length > 0 && (
            <>
              <p className="mt-1.5 flex items-center gap-1 border-t border-surface-border px-2 pb-1 pt-1.5 text-2xs text-text-tertiary"><Component size={10} /> Components</p>
              <div className="grid max-h-48 grid-cols-2 gap-0.5 overflow-y-auto">{own.map(row)}</div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
