"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, GripVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeColor } from "@/lib/token-sync/color";
import type { NumberToken, RadiusToken, ShadowToken, SpacingToken, StringToken, TokenTheme, TypographyToken, TokenKind } from "@/store/design-system";
import { isUnit, NUMBER_USES, STRING_USES, UNITS } from "@/lib/tokens/uses";
import FontField, { BrowseFonts } from "./FontField";
import { CommitInput, InlineName } from "./fields";
import { Badges } from "./ColorViews";
import type { Row } from "./rows";
import CompositionEditor, { Sample } from "./CompositionEditor";
import { summary as compositionSummary } from "@/lib/tokens/compose";
import type { Composition } from "@/lib/tokens/model";
import { useDesignSystemStore } from "@/store/design-system";
import { useShallow } from "zustand/react/shallow";
import type { Selection } from "./useSelection";
import type { Drag } from "./drag";
import type { tableColumns } from "./TableHeader";

// Spacing, radii, shadows and typography: the same rows as colors, with what each looks like.

export interface OtherActions {
  rename: (id: string, name: string) => void;
  update: (row: Row, patch: Record<string, unknown>) => void;
  duplicate: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  // The value of a number, a string or a length in a theme: null takes a theme's own value away.
  setThemeValue: (row: Row, themeId: string, value: number | string | null) => void;
}

export interface OtherCtx {
  selection: Selection;
  drag: Drag;
  act: OtherActions;
  taken: (kind: TokenKind) => string[];
  hasRepo: boolean;
  rename?: (row: Row) => void;
  // The themes of the open set (a number, a string or a composition has a value for each), and the grid the head and the rows share.
  themes: TokenTheme[];
  columns: ReturnType<typeof tableColumns>;
}

const number = (text: string) => { const n = parseFloat(text); return Number.isFinite(n) ? n : null; };
const px = (n: number) => `${parseFloat(n.toFixed(2))}`;

// What a token looks like, small enough to sit by its name.
function Visual({ row }: { row: Row }) {
  const box = "flex h-6 w-6 flex-shrink-0 items-center justify-center";
  switch (row.kind) {
    case "spacing": return <span aria-hidden className={box}><span className="h-2 rounded-sm bg-accent/40" style={{ width: Math.max(2, Math.min((row.token as SpacingToken).value, 24)) }} /></span>;
    case "radius": return <span aria-hidden className={cn(box, "border border-text-tertiary/40 bg-surface-subtle")} style={{ borderRadius: Math.min((row.token as RadiusToken).value, 12) }} />;
    case "shadow": { const s = row.token as ShadowToken; return <span aria-hidden className={cn(box, "rounded border border-surface-border bg-surface-base")} style={{ boxShadow: s.raw ?? `${s.inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}` }} />; }
    case "typography": { const t = row.token as TypographyToken; return <span aria-hidden className={cn(box, "text-text-primary")} style={{ fontFamily: t.fontFamily, fontWeight: t.fontWeight, fontSize: 14 }}>Aa</span>; }
    case "string": { const x = row.token as StringToken; return x.use === "font-family" ? <span aria-hidden className={cn(box, "text-text-primary")} style={{ fontFamily: x.value }}>Aa</span> : null; }
    case "composition": return <CompositionMark composition={row.token as Composition} />;
    default: return null;
  }
}

// A composition's mark: "Aa" in the text style, the shadow, or nothing for one of parts of its own.
function CompositionMark({ composition }: { composition: Composition }) {
  return composition.kind === "custom" ? null : <Sample composition={composition} mark />;
}

// A value in each theme of the set, for a number, a string, a length: the first theme's is the value every theme has, and another theme either
// has one of its own or has that one (left empty, with the value it has as the hint). A set with one theme has the one value.
function ValueCells({ row, ctx }: { row: Row; ctx: OtherCtx }) {
  const token = row.token as { value: number | string; themeValues?: Record<string, number | string> };
  const baseId = ctx.themes[0].id;
  const numeric = row.kind !== "string";
  const themed = ctx.themes.length > 1;
  const isFont = row.kind === "string" && (row.token as StringToken).use === "font-family";
  const own = (themeId: string) => (themeId === baseId ? String(token.value) : token.themeValues?.[themeId] !== undefined ? String(token.themeValues[themeId]) : "");
  return (
    <>
      {ctx.themes.map((theme, i) => {
        const label = themed ? `${theme.name} value of ${row.name}` : `Value of ${row.name}`;
        return (
          <div key={theme.id} role="cell" className="flex min-w-0 items-center gap-1">
            <CommitInput
              value={own(theme.id)}
              placeholder={theme.id === baseId ? undefined : String(token.value)}
              label={label}
              mono={numeric}
              className={cn("min-w-0", numeric ? "w-24" : "flex-1")}
              invalidHint={numeric ? "A number" : "Can't be empty"}
              onCommit={(text) => {
                const t = text.trim();
                if (t === "" && theme.id !== baseId) { ctx.act.setThemeValue(row, theme.id, null); return true; }
                if (numeric) { const n = number(t); if (n === null) return false; ctx.act.setThemeValue(row, theme.id, n); return true; }
                if (t === "") return false;
                ctx.act.setThemeValue(row, theme.id, t);
                return true;
              }}
            />
            {numeric && i === ctx.themes.length - 1 && <span className="flex-shrink-0 text-2xs text-text-tertiary">{row.kind === "number" ? (row.token as NumberToken).unit : "px"}</span>}
            {isFont && <BrowseFonts label={label} current={own(theme.id) || String(token.value)} onPick={(v) => ctx.act.setThemeValue(row, theme.id, v)} />}
          </div>
        );
      })}
    </>
  );
}

// What a composition comes to in each theme, and what a text style or a shadow of the repository comes to, in the columns of the themes.
function SummaryCells({ row, ctx }: { row: Row; ctx: OtherCtx }) {
  const data = useDesignSystemStore(useShallow((s) => ({ colors: s.colors, numbers: s.numbers, strings: s.strings, spacing: s.spacing, radii: s.radii })));
  if (row.kind === "composition") {
    return <>{ctx.themes.map((theme, i) => <div key={theme.id} role="cell" className="min-w-0 truncate text-2xs text-text-tertiary" title={compositionSummary(row.token as Composition, data, i === 0 ? undefined : theme.id)}>{compositionSummary(row.token as Composition, data, i === 0 ? undefined : theme.id)}</div>)}</>;
  }
  const text = row.kind === "typography"
    ? `${(row.token as TypographyToken).fontSize}px · ${(row.token as TypographyToken).fontWeight} · ${(row.token as TypographyToken).lineHeight}`
    : row.text;
  return <div role="cell" style={{ gridColumn: `span ${ctx.themes.length}` }} className="min-w-0 truncate text-2xs text-text-tertiary" title={text}>{text}</div>;
}

const selectClass = "rounded border border-surface-border bg-surface-base px-1 min-h-11 py-0.5 text-2xs text-text-secondary outline-none focus:border-accent";

// What the token is: its type, and what it is measured in and used as.
function TypeCell({ row, ctx }: { row: Row; ctx: OtherCtx }) {
  const set = (patch: Record<string, unknown>) => ctx.act.update(row, patch);
  switch (row.kind) {
    case "spacing": { const v = (row.token as SpacingToken).value; return <span role="cell" className="text-2xs text-text-tertiary">Spacing <span className="tabular-nums">· {px(v / 16)}rem</span></span>; }
    case "radius": { const v = (row.token as RadiusToken).value; return <span role="cell" className="text-2xs text-text-tertiary">Radius{v >= 9999 ? " · full" : ""}</span>; }
    case "number": {
      const n = row.token as NumberToken;
      return (
        <div role="cell" className="flex items-center gap-1">
          <select aria-label={`Unit of ${row.name}`} value={n.unit} onChange={(e) => { if (isUnit(e.target.value)) set({ unit: e.target.value }); }} className={selectClass}>
            {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          <select aria-label={`Used as of ${row.name}`} value={n.use ?? ""} onChange={(e) => set({ use: e.target.value || undefined })} className={cn(selectClass, "min-w-0 flex-1")}>
            {NUMBER_USES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      );
    }
    case "string": {
      const x = row.token as StringToken;
      return (
        <div role="cell" className="flex items-center gap-1">
          <span className="text-2xs text-text-tertiary">String</span>
          <select aria-label={`Used as of ${row.name}`} value={x.use ?? ""} onChange={(e) => set({ use: e.target.value || undefined })} className={cn(selectClass, "min-w-0 flex-1")}>
            {STRING_USES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      );
    }
    case "composition": return <span role="cell" data-composition-kind className="text-2xs capitalize text-text-tertiary">{(row.token as Composition).kind}</span>;
    case "typography": return <span role="cell" className="text-2xs text-text-tertiary">Text style</span>;
    case "shadow": return <span role="cell" className="text-2xs text-text-tertiary">Shadow</span>;
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
  if (row.kind === "composition") return <CompositionEditor composition={row.token as Composition} onChange={(patch) => ctx.act.update(row, patch)} />;
  const asNumber = (key: string) => (t: string) => { const n = number(t); if (n === null) return false; set({ [key]: n }); return true; };
  if (row.kind === "typography") {
    const t = row.token as TypographyToken;
    return (
      <div className="flex flex-wrap items-end gap-3 border-t border-surface-border bg-surface-subtle/50 px-4 py-2 pl-11">
        <div className="flex flex-col gap-0.5 text-2xs text-text-tertiary">
          Family
          <FontField label={`Family of ${row.name}`} value={t.fontFamily} className="w-40" onCommit={(x) => { if (!x.trim()) return false; set({ fontFamily: x.trim() }); return true; }} />
        </div>
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
  const expandable = row.kind === "typography" || row.kind === "shadow" || row.kind === "composition";
  const picked = ctx.selection.selected.has(row.id);
  const dragged = ctx.drag.moving?.includes(row.id);
  const over = ctx.drag.over?.type === "token" && ctx.drag.over.id === row.id ? ctx.drag.over : null;
  const valued = row.kind === "spacing" || row.kind === "radius" || row.kind === "number" || row.kind === "string";
  return (
    <div data-token-id={row.id} data-token-kind={row.kind} data-selected={picked || undefined} role="row" className={cn("relative border-b border-surface-border/60", dragged && "opacity-40")}>
      {over && <span aria-hidden className={cn("absolute inset-x-0 z-10 h-0.5 bg-accent", over.after ? "bottom-0" : "top-0")} data-drop={over.after ? "after" : "before"} />}
      <div
        onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("input,button,select")) ctx.drag.press(e, row.id); }}
        onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) ctx.selection.click(row.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey }); }}
        style={{ gridTemplateColumns: ctx.columns.template }}
        className={cn("group/row grid items-center gap-x-2 px-4 min-h-[3.25rem] py-1 transition-colors", picked ? "bg-accent/10" : "hover:bg-surface-subtle")}
      >
        <span data-drag-handle title="Drag to move or reorder" className="-ml-3 w-3 cursor-grab text-text-tertiary opacity-0 group-hover/row:opacity-100"><GripVertical size={12} /></span>
        <input type="checkbox" aria-label={`Select ${row.name}`} checked={picked} onChange={() => ctx.selection.toggle(row.id)} className="h-3 w-3 accent-[var(--cobalt)]" />
        <div role="cell" className="flex min-w-0 items-center gap-2">
          <Visual row={row} />
          <InlineName row={row} taken={ctx.taken(row.kind)} onRename={(n) => ctx.act.rename(row.id, n)} className="text-xs text-text-primary" />
        </div>
        {valued ? <ValueCells row={row} ctx={ctx} /> : <SummaryCells row={row} ctx={ctx} />}
        <span />
        <TypeCell row={row} ctx={ctx} />
        <div role="cell" className="flex items-center justify-end gap-1.5">
          <Badges row={row} hasRepo={ctx.hasRepo} />
          <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
            {expandable && (
              <button type="button" aria-label={`${open ? "Close" : "Edit"} ${row.name}`} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded p-1 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
            )}
            {row.linked && !row.readonly && ctx.rename && (
              <button type="button" data-rename-open aria-label={`Rename ${row.name} in the repository`} title="Rename in the repository" onClick={() => ctx.rename!(row)} className="rounded p-1 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"><Pencil size={10} /></button>
            )}
            <button type="button" aria-label={`Duplicate ${row.name}`} onClick={() => ctx.act.duplicate([row.id])} className="rounded p-1 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"><Copy size={10} /></button>
            <button type="button" aria-label={`Delete ${row.name}`} onClick={() => ctx.act.remove([row.id])} className="rounded p-1 text-text-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={10} /></button>
          </div>
        </div>
      </div>
      {open && expandable && <Expanded row={row} ctx={ctx} />}
    </div>
  );
}

export function OtherBody({ rows, ctx }: { rows: Row[]; ctx: OtherCtx }) {
  return <div className="pb-2" role="rowgroup">{rows.map((r) => <OtherRowView key={r.id} row={r} ctx={ctx} />)}</div>;
}
