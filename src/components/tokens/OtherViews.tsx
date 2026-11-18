"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, GripVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeColor } from "@/lib/token-sync/color";
import type { NumberToken, RadiusToken, ShadowToken, SpacingToken, StringToken, TokenTheme, TypographyToken, TokenKind } from "@/store/design-system";
import { isUnit, NUMBER_USES, STRING_USES, UNITS } from "@/lib/tokens/uses";
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
  // The themes of the open set, and the ones the bar shows: a number or a string has a value for each.
  themes: TokenTheme[];
  shown: TokenTheme[];
}

const number = (text: string) => { const n = parseFloat(text); return Number.isFinite(n) ? n : null; };
const px = (n: number) => `${parseFloat(n.toFixed(2))}`;

function Visual({ row, themeId }: { row: Row; themeId?: string }) {
  switch (row.kind) {
    case "spacing": return <div className="flex w-40 flex-shrink-0 items-center"><div className="h-2 rounded-sm bg-accent/40" style={{ width: Math.max(2, Math.min((row.token as SpacingToken).value, 160)) }} /></div>;
    case "radius": return <div className="h-6 w-6 flex-shrink-0 border border-text-tertiary/40 bg-surface-subtle" style={{ borderRadius: Math.min((row.token as RadiusToken).value, 12) }} />;
    case "shadow": { const s = row.token as ShadowToken; return <div className="h-8 w-8 flex-shrink-0 rounded border border-surface-border bg-surface-base" style={{ boxShadow: s.raw ?? `${s.inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}` }} />; }
    case "typography": { const t = row.token as TypographyToken; return <span className="w-24 flex-shrink-0 truncate text-text-primary" style={{ fontFamily: t.fontFamily, fontSize: Math.min(18, t.fontSize), fontWeight: t.fontWeight, lineHeight: 1.2 }}>Aa Quick fox</span>; }
    case "number": { const n = row.token as NumberToken; return <span className="w-16 flex-shrink-0 truncate rounded bg-surface-subtle px-1.5 py-0.5 text-center font-mono text-2xs text-text-secondary" aria-hidden>{n.value}{n.unit}</span>; }
    case "string": { const x = row.token as StringToken; return <span className="w-16 flex-shrink-0 truncate text-center text-text-primary" style={x.use === "font-family" ? { fontFamily: x.value } : undefined} aria-hidden>Aa</span>; }
    case "composition": return <Sample composition={row.token as Composition} small themeId={themeId} />;
    default: return null;
  }
}

const selectClass = "rounded border border-surface-border bg-surface-base px-1 min-h-11 py-0.5 text-2xs text-text-secondary outline-none focus:border-accent";

// A value in each theme that is shown, for a set that has more than one: the first theme's is the value every theme has, and another theme
// either has one of its own or has that one (left empty, with the value it has as the hint).
function ThemedValues({ row, ctx }: { row: Row; ctx: OtherCtx }) {
  const token = row.token as { value: number | string; themeValues?: Record<string, number | string> };
  const baseId = ctx.themes[0].id;
  const numeric = row.kind !== "string";
  const own = (themeId: string) => (themeId === baseId ? String(token.value) : token.themeValues?.[themeId] !== undefined ? String(token.themeValues[themeId]) : "");
  const unit = row.kind === "spacing" || row.kind === "radius" ? "px" : row.kind === "number" ? (row.token as NumberToken).unit : "";
  return (
    <>
      {ctx.shown.map((theme) => (
        <label key={theme.id} className="flex items-center gap-1 text-2xs text-text-tertiary">
          <span className="w-10 truncate" title={theme.name}>{theme.name}</span>
          <CommitInput
            value={own(theme.id)}
            placeholder={theme.id === baseId ? undefined : String(token.value)}
            label={`${theme.name} value of ${row.name}`}
            mono={numeric}
            frame
            className={numeric ? "w-16 text-right" : "w-36"}
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
          {unit && theme.id === ctx.shown[ctx.shown.length - 1].id ? unit : null}
        </label>
      ))}
    </>
  );
}

function Fields({ row, ctx }: { row: Row; ctx: OtherCtx }) {
  const set = (patch: Record<string, unknown>) => ctx.act.update(row, patch);
  const themed = ctx.themes.length > 1 && ctx.shown.length > 0;
  // `exact` shows the number as it is (a Number has the digits its author gave it); pixels are shown to two places.
  const num = (key: string, value: number, label: string, unit?: string, exact = false) => (
    <label className="flex items-center gap-1 text-2xs text-text-tertiary">
      <CommitInput value={exact ? String(value) : px(value)} label={`${label} of ${row.name}`} mono frame className="w-14 text-right" invalidHint="A number" onCommit={(t) => { const n = number(t); if (n === null) return false; set({ [key]: n }); return true; }} />
      {unit}
    </label>
  );
  switch (row.kind) {
    case "spacing": { const v = (row.token as SpacingToken).value; if (themed) return <ThemedValues row={row} ctx={ctx} />; return <>{num("value", v, "Value", "px")}<span className="w-14 text-2xs tabular-nums text-text-tertiary">{px(v / 16)}rem</span></>; }
    case "radius": { const v = (row.token as RadiusToken).value; if (themed) return <ThemedValues row={row} ctx={ctx} />; return <>{num("value", v, "Value", "px")}{v >= 9999 && <span className="text-2xs text-text-tertiary">full</span>}</>; }
    case "number": {
      const n = row.token as NumberToken;
      return (
        <>
          {themed ? <ThemedValues row={row} ctx={ctx} /> : num("value", n.value, "Value", undefined, true)}
          <select aria-label={`Unit of ${row.name}`} value={n.unit} onChange={(e) => { if (isUnit(e.target.value)) set({ unit: e.target.value }); }} className={selectClass}>
            {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          <select aria-label={`Used as of ${row.name}`} value={n.use ?? ""} onChange={(e) => set({ use: e.target.value || undefined })} className={selectClass}>
            {NUMBER_USES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </>
      );
    }
    case "string": {
      const x = row.token as StringToken;
      return (
        <>
          {themed ? <ThemedValues row={row} ctx={ctx} /> : <CommitInput value={x.value} label={`Value of ${row.name}`} frame className="w-56" invalidHint="Can't be empty" onCommit={(t) => { if (!t.trim()) return false; set({ value: t.trim() }); return true; }} />}
          <select aria-label={`Used as of ${row.name}`} value={x.use ?? ""} onChange={(e) => set({ use: e.target.value || undefined })} className={selectClass}>
            {STRING_USES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </>
      );
    }
    case "composition": return <span data-composition-kind className="w-20 flex-shrink-0 text-2xs capitalize text-text-tertiary">{(row.token as Composition).kind}</span>;
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
  const expandable = row.kind === "typography" || row.kind === "shadow" || row.kind === "composition";
  const data = useDesignSystemStore(useShallow((s) => ({ colors: s.colors, numbers: s.numbers, strings: s.strings, spacing: s.spacing, radii: s.radii })));
  // With one theme shown (of several), what a composition looks like in it.
  const shownTheme = ctx.themes.length > 1 && ctx.shown.length === 1 ? ctx.shown[0].id : undefined;
  const picked = ctx.selection.selected.has(row.id);
  const dragged = ctx.drag.moving?.includes(row.id);
  const over = ctx.drag.over?.type === "token" && ctx.drag.over.id === row.id ? ctx.drag.over : null;
  const summary = row.kind === "typography"
    ? `${(row.token as TypographyToken).fontSize}px · ${(row.token as TypographyToken).fontWeight} · ${(row.token as TypographyToken).lineHeight}`
    : row.kind === "shadow" ? row.text : row.kind === "composition" ? compositionSummary(row.token as Composition, data, shownTheme) : "";
  return (
    <div data-token-id={row.id} data-token-kind={row.kind} data-selected={picked || undefined} className={cn("relative border-b border-transparent", dragged && "opacity-40")}>
      {over && <span aria-hidden className={cn("absolute inset-x-0 z-10 h-0.5 bg-accent", over.after ? "bottom-0" : "top-0")} data-drop={over.after ? "after" : "before"} />}
      <div
        onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("input,button,select")) ctx.drag.press(e, row.id); }}
        onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) ctx.selection.click(row.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey }); }}
        className={cn("group/row flex items-center gap-3 px-4 py-1.5 transition-colors", picked ? "bg-accent/10" : "hover:bg-surface-subtle")}
      >
        <span data-drag-handle title="Drag to move or reorder" className="-ml-3 w-3 flex-shrink-0 cursor-grab text-text-tertiary opacity-0 group-hover/row:opacity-100"><GripVertical size={12} /></span>
        <input type="checkbox" aria-label={`Select ${row.name}`} checked={picked} onChange={() => ctx.selection.toggle(row.id)} className="h-3 w-3 flex-shrink-0 accent-[var(--cobalt)]" />
        <Visual row={row} themeId={shownTheme} />
        <InlineName row={row} taken={ctx.taken(row.kind)} onRename={(n) => ctx.act.rename(row.id, n)} className="w-40 flex-shrink-0 text-xs text-text-primary" />
        <Fields row={row} ctx={ctx} />
        {summary && <span className="min-w-0 truncate text-2xs text-text-tertiary">{summary}</span>}
        <div className="flex-1" />
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
      {open && expandable && <Expanded row={row} ctx={ctx} />}
    </div>
  );
}

export function OtherBody({ rows, ctx }: { rows: Row[]; ctx: OtherCtx }) {
  return <div className="pb-2">{rows.map((r) => <OtherRowView key={r.id} row={r} ctx={ctx} />)}</div>;
}
