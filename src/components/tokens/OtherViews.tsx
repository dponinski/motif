"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeColor } from "@/lib/token-sync/color";
import type { RadiusToken, ShadowToken, SpacingToken, TypographyToken } from "@/store/design-system";
import { CommitInput, InlineName } from "./fields";
import { Badges } from "./ColorViews";
import type { Row } from "./rows";
import type { Selection } from "./useSelection";
import type { Drag } from "./drag";

// Spacing, radii, shadows and typography: the same rows as colors, with what each looks like.

export interface OtherActions {
  rename: (id: string, name: string) => void;
  update: (row: Row, patch: Record<string, unknown>) => void;
  duplicate: (ids: string[]) => void;
  remove: (ids: string[]) => void;
}

export interface OtherCtx {
  selection: Selection;
  drag: Drag;
  act: OtherActions;
  taken: string[];
  hasRepo: boolean;
}

const number = (text: string) => { const n = parseFloat(text); return Number.isFinite(n) ? n : null; };
const px = (n: number) => `${parseFloat(n.toFixed(2))}`;

function Visual({ row }: { row: Row }) {
  switch (row.kind) {
    case "spacing": return <div className="flex w-40 flex-shrink-0 items-center"><div className="h-2 rounded-sm bg-accent/40" style={{ width: Math.max(2, Math.min((row.token as SpacingToken).value, 160)) }} /></div>;
    case "radius": return <div className="h-6 w-6 flex-shrink-0 border border-text-tertiary/40 bg-surface-subtle" style={{ borderRadius: Math.min((row.token as RadiusToken).value, 12) }} />;
    case "shadow": { const s = row.token as ShadowToken; return <div className="h-8 w-8 flex-shrink-0 rounded border border-surface-border bg-surface-base" style={{ boxShadow: s.raw ?? `${s.inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}` }} />; }
    case "typography": { const t = row.token as TypographyToken; return <span className="w-24 flex-shrink-0 truncate text-text-primary" style={{ fontFamily: t.fontFamily, fontSize: Math.min(18, t.fontSize), fontWeight: t.fontWeight, lineHeight: 1.2 }}>Aa Quick fox</span>; }
    default: return null;
  }
}

function Fields({ row, ctx }: { row: Row; ctx: OtherCtx }) {
  const set = (patch: Record<string, unknown>) => ctx.act.update(row, patch);
  const num = (key: string, value: number, label: string, unit?: string) => (
    <label className="flex items-center gap-1 text-2xs text-text-tertiary">
      <CommitInput value={px(value)} label={`${label} of ${row.name}`} mono frame className="w-14 text-right" invalidHint="A number" onCommit={(t) => { const n = number(t); if (n === null) return false; set({ [key]: n }); return true; }} />
      {unit}
    </label>
  );
  switch (row.kind) {
    case "spacing": { const v = (row.token as SpacingToken).value; return <>{num("value", v, "Value", "px")}<span className="w-14 text-2xs tabular-nums text-text-tertiary">{px(v / 16)}rem</span></>; }
    case "radius": { const v = (row.token as RadiusToken).value; return <>{num("value", v, "Value", "px")}{v >= 9999 && <span className="text-2xs text-text-tertiary">full</span>}</>; }
    default: return null;
  }
}

function Expanded({ row, ctx }: { row: Row; ctx: OtherCtx }) {
  const set = (patch: Record<string, unknown>) => ctx.act.update(row, patch);
  const field = (label: string, value: string | number, onCommit: (t: string) => boolean, width = "w-20") => (
    <label className="flex flex-col gap-0.5 text-2xs text-text-tertiary">
      {label}
      <CommitInput value={String(value)} label={`${label} of ${row.name}`} frame className={width} onCommit={onCommit} invalidHint="Not a valid value" />
    </label>
  );
  const asNumber = (key: string) => (t: string) => { const n = number(t); if (n === null) return false; set({ [key]: n }); return true; };
  if (row.kind === "typography") {
    const t = row.token as TypographyToken;
    return (
      <div className="flex flex-wrap items-end gap-3 border-t border-surface-border bg-surface-subtle/50 px-4 py-2 pl-11">
        {field("Family", t.fontFamily, (x) => { if (!x.trim()) return false; set({ fontFamily: x.trim() }); return true; }, "w-40")}
        {field("Size", t.fontSize, asNumber("fontSize"))}
        {field("Weight", t.fontWeight, asNumber("fontWeight"))}
        {field("Line height", t.lineHeight, asNumber("lineHeight"))}
      </div>
    );
  }
  const s = row.token as ShadowToken;
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-surface-border bg-surface-subtle/50 px-4 py-2 pl-11">
      {field("X", s.x, asNumber("x"), "w-14")}
      {field("Y", s.y, asNumber("y"), "w-14")}
      {field("Blur", s.blur, asNumber("blur"), "w-14")}
      {field("Spread", s.spread, asNumber("spread"), "w-14")}
      {field("Color", s.color, (x) => { if (normalizeColor(x) === null) return false; set({ color: x.trim() }); return true; }, "w-40")}
      {s.raw && <span className="text-2xs text-text-tertiary">Several layers: only the first is edited here.</span>}
    </div>
  );
}

export function OtherRowView({ row, ctx }: { row: Row; ctx: OtherCtx }) {
  const [open, setOpen] = useState(false);
  const expandable = row.kind === "typography" || row.kind === "shadow";
  const picked = ctx.selection.selected.has(row.id);
  const dragged = ctx.drag.moving?.includes(row.id);
  const over = ctx.drag.over?.type === "token" && ctx.drag.over.id === row.id ? ctx.drag.over : null;
  const summary = row.kind === "typography"
    ? `${(row.token as TypographyToken).fontSize}px · ${(row.token as TypographyToken).fontWeight} · ${(row.token as TypographyToken).lineHeight}`
    : row.kind === "shadow" ? row.text : "";
  return (
    <div data-token-id={row.id} data-selected={picked || undefined} className={cn("relative border-b border-transparent", dragged && "opacity-40")}>
      {over && <span aria-hidden className={cn("absolute inset-x-0 z-10 h-0.5 bg-accent", over.after ? "bottom-0" : "top-0")} data-drop={over.after ? "after" : "before"} />}
      <div
        onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("input,button,select")) ctx.drag.press(e, row.id); }}
        onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) ctx.selection.click(row.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey }); }}
        className={cn("group/row flex items-center gap-3 px-4 py-1.5 transition-colors", picked ? "bg-accent/10" : "hover:bg-surface-subtle")}
      >
        <span data-drag-handle title="Drag to move or reorder" className="-ml-3 w-3 flex-shrink-0 cursor-grab text-text-tertiary opacity-0 group-hover/row:opacity-100"><GripVertical size={12} /></span>
        <input type="checkbox" aria-label={`Select ${row.name}`} checked={picked} onChange={() => ctx.selection.toggle(row.id)} className="h-3 w-3 flex-shrink-0 accent-[var(--accent,#6366f1)]" />
        <Visual row={row} />
        <InlineName row={row} taken={ctx.taken} onRename={(n) => ctx.act.rename(row.id, n)} className="w-40 flex-shrink-0 text-xs text-text-primary" />
        <Fields row={row} ctx={ctx} />
        {summary && <span className="min-w-0 truncate text-2xs text-text-tertiary">{summary}</span>}
        <div className="flex-1" />
        <Badges row={row} hasRepo={ctx.hasRepo} />
        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
          {expandable && (
            <button type="button" aria-label={`${open ? "Close" : "Edit"} ${row.name}`} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded p-1 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
          )}
          <button type="button" aria-label={`Duplicate ${row.name}`} onClick={() => ctx.act.duplicate([row.id])} className="rounded p-1 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"><Copy size={10} /></button>
          <button type="button" aria-label={`Delete ${row.name}`} onClick={() => ctx.act.remove([row.id])} className="rounded p-1 text-text-tertiary hover:bg-red-400/10 hover:text-red-400"><Trash2 size={10} /></button>
        </div>
      </div>
      {open && expandable && <Expanded row={row} ctx={ctx} />}
    </div>
  );
}

export function OtherBody({ rows, ctx }: { rows: Row[]; ctx: OtherCtx }) {
  return <div className="pb-2">{rows.map((r) => <OtherRowView key={r.id} row={r} ctx={ctx} />)}</div>;
}
