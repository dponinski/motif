"use client";

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CornerDownRight, Copy, GripVertical, Lock, Trash2, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { contrastRatio, gradeOf, hexOf } from "@/lib/tokens/contrast";
import { cssName } from "@/lib/token-sync/doc";
import { normalizeColor } from "@/lib/token-sync/color";
import { dependentsOf, targetKey, targetOf, wouldLoop } from "@/lib/tokens/alias-colors";
import type { ColorToken, TokenSet, TokenTheme } from "@/store/design-system";
import { CommitInput, InlineName } from "./fields";
import type { Row } from "./rows";
import type { Selection } from "./useSelection";
import type { Drag } from "./drag";

// Colors, as a palette (each group a ramp of swatches with their hex) or as a list (one row each, the values editable in place).

export interface ColorActions {
  rename: (id: string, name: string) => void;
  setColor: (id: string, themeId: string, text: string) => boolean;
  // Makes the color, in a theme, the token with this key (null: the color it is now).
  setAlias: (id: string, themeId: string, target: string | null) => boolean;
  duplicate: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  toGroup: (ids: string[], group: string) => void;
}

export interface ColorCtx {
  themes: TokenTheme[];
  // The themes the view shows: all of them, or the one chosen.
  shown: TokenTheme[];
  selection: Selection;
  drag: Drag;
  act: ColorActions;
  taken: string[];
  groups: string[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
  // A repository is connected, so a token it doesn't have is worth marking.
  hasRepo: boolean;
  // Opens the rename of a token the repository names (everywhere it is used).
  rename?: (row: Row) => void;
  // Every color of the set, for what a color can be (an alias) and what is it.
  all: ColorToken[];
  // Every color of every set (a color can be a color of another set), and the sets, for their names and their themes.
  every: ColorToken[];
  sets: TokenSet[];
}

// What a token an alias names is called: its name, with the name of its set when that is another set than the color's own.
function aliasLabel(c: ColorToken, target: string, ctx: Pick<ColorCtx, "every" | "sets">): string {
  const named = targetOf(ctx.every, c, target);
  if (!named) return target;
  return named.setId === c.setId ? named.name : `${ctx.sets.find((s) => s.id === named.setId)?.name ?? "Another set"} / ${named.name}`;
}

const valueIn = (c: ColorToken, themeId: string) => c.themeValues[themeId] ?? c.value;
// "Light: gray-50 · Dark: gray-900" for the themes in which a color is another token.
function aliasTitle(c: ColorToken, ctx: Pick<ColorCtx, "themes" | "every" | "sets">): string {
  return ctx.themes.filter((t) => c.themeAlias?.[t.id]).map((t) => `${t.name}: ${aliasLabel(c, c.themeAlias![t.id], ctx)}`).join(" · ");
}
const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };

// "Button, Card and 2 more", for what uses a token.
export const usedIn = (row: Row): string => {
  const names = row.use?.components ?? [];
  if (names.length === 0) return `${row.use?.files.length ?? 0} file${row.use?.files.length === 1 ? "" : "s"}`;
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
};
const usedTitle = (row: Row) => `Used ${row.use!.n} time${row.use!.n === 1 ? "" : "s"} in ${usedIn(row)}`;

export function Badges({ row, hasRepo }: { row: Row; hasRepo: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-2xs">
      {row.changed && <span title="Changed in Motif since the last sync" className="rounded bg-sun-soft px-1 text-ink">changed</span>}
      {hasRepo && !row.linked && <span title="Not in the repository yet: it is added with the next sync" className="text-text-tertiary">Motif only</span>}
      {row.readonly && <span title="Defined where Motif can't edit it yet" className="text-text-tertiary"><Lock size={10} aria-label="Read-only" /></span>}
      {row.unused && <span data-unused title="Nothing in the repository's components or stylesheets uses it (class names and var() are looked for)" className="rounded bg-surface-overlay px-1 text-text-tertiary">unused</span>}
      {row.use && row.use.n > 0 && <span data-used title={usedTitle(row)} className="tabular-nums text-text-tertiary">used {row.use.n}×</span>}
    </span>
  );
}

// The color picker's own dialog, kept until it closes so that choosing is one step and not one per shade passed.
function NativeColor({ value, onCommit, label }: { value: string; onCommit: (hex: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const hex = (normalizeColor(value) ?? "#000000").slice(0, 7);
  // What the picker shows while it is open; once the value has changed under it, that is what it shows.
  const [dragged, setDragged] = useState({ from: hex, value: hex });
  const live = dragged.from === hex ? dragged.value : hex;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => onCommit(el.value);
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  });
  return <input ref={ref} type="color" aria-label={label} value={live} onInput={(e) => setDragged({ from: hex, value: e.currentTarget.value })} onChange={() => undefined} className="h-6 w-6 flex-shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />;
}

function Contrast({ value }: { value: string }) {
  const on = (against: string, name: string) => {
    const r = contrastRatio(value, against);
    if (r === null) return null;
    const grade = gradeOf(r);
    return <span key={name} title={`Contrast with ${name}`} className={cn("rounded px-1 text-2xs tabular-nums", grade === "fails" ? "bg-danger/10 text-danger" : "bg-surface-overlay text-text-secondary")}>{name} {(Math.floor(r * 10) / 10).toFixed(1)} {grade}</span>;
  };
  return <span className="flex flex-wrap gap-1">{on("#ffffff", "white")}{on("#000000", "black")}</span>;
}

// In one theme: the token this color is, or a way to make it one.
function AliasField({ token, theme, ctx }: { token: ColorToken; theme: TokenTheme; ctx: ColorCtx }) {
  const target = token.themeAlias?.[theme.id];
  const label = target ? aliasLabel(token, target, ctx) : "";
  // The colors it can be: those of its own set first, then those of each other set, none that would lead back to it.
  const options = ctx.every.filter((c) => c.id !== token.id && !wouldLoop(ctx.every, token, theme.id, targetKey(c, token.setId), ctx.sets));
  const groups = [token.setId, ...ctx.sets.map((s) => s.id).filter((id) => id !== token.setId)]
    .map((id) => ({ id, name: ctx.sets.find((s) => s.id === id)?.name ?? "", colors: options.filter((c) => c.setId === id) }))
    .filter((g) => g.colors.length > 0);
  const choices = (
    <>
      {groups.length <= 1 ? groups[0]?.colors.map((c) => <option key={c.id} value={targetKey(c, token.setId)}>{c.name}</option>)
        : groups.map((g) => <optgroup key={g.id} label={g.name}>{g.colors.map((c) => <option key={c.id} value={targetKey(c, token.setId)}>{c.name}</option>)}</optgroup>)}
    </>
  );
  return (
    <div className="flex items-center gap-1.5 pl-[3.75rem]" data-alias-field={theme.id}>
      {target ? (
        <>
          <span className="flex min-w-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-2xs text-accent" title={`${theme.name} is the token ${label}`} data-alias-chip>
            <CornerDownRight size={10} aria-hidden /><span className="truncate">{label}</span>
          </span>
          <select aria-label={`Token that ${token.name} is in ${theme.name}`} value={target} onChange={(e) => ctx.act.setAlias(token.id, theme.id, e.target.value)} className="w-5 flex-shrink-0 rounded border border-line bg-surface-base text-2xs text-text-primary outline-none">
            {choices}
            {!options.some((c) => targetKey(c, token.setId) === target) && <option value={target}>{label}</option>}
          </select>
          <button type="button" aria-label={`Detach ${token.name} (${theme.name}) from ${label}`} title="Keep the color it is now, and stop following the token" onClick={() => ctx.act.setAlias(token.id, theme.id, null)} className="flex items-center gap-1 rounded px-1 py-0.5 text-2xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary"><Unlink size={10} /> Detach</button>
        </>
      ) : (
        <select aria-label={`Make ${token.name} (${theme.name}) another token`} value="" onChange={(e) => { if (e.target.value) ctx.act.setAlias(token.id, theme.id, e.target.value); }} className="min-w-0 max-w-full rounded border border-line bg-surface-base px-1 py-0.5 text-2xs text-text-secondary outline-none">
          <option value="">Make it another token…</option>
          {choices}
        </select>
      )}
    </div>
  );
}

export function ColorEditor({ row, ctx }: { row: Row; ctx: ColorCtx }) {
  const token = row.token as ColorToken;
  const used = dependentsOf(ctx.every, token);
  return (
    <div className="flex flex-col gap-2.5" data-color-editor>
      <div className="flex items-center gap-2">
        <InlineName row={row} taken={ctx.taken} onRename={(n) => ctx.act.rename(row.id, n)} className="text-sm font-medium text-text-primary" />
        <div className="flex-1" />
        {row.changed && <span className="rounded bg-sun-soft px-1 text-2xs text-ink">changed</span>}
      </div>
      {ctx.themes.map((theme) => {
        const value = valueIn(token, theme.id);
        return (
          <div key={theme.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className="w-12 flex-shrink-0 text-2xs text-text-tertiary">{theme.name}</span>
              <NativeColor value={value} label={`${theme.name} color picker`} onCommit={(hex) => ctx.act.setColor(row.id, theme.id, hex)} />
              <CommitInput value={value} label={`${theme.name} value of ${row.name}`} mono frame className="flex-1" onCommit={(t) => ctx.act.setColor(row.id, theme.id, t)} invalidHint="Not a color Motif can read" />
            </div>
            <AliasField token={token} theme={theme} ctx={ctx} />
            <div className="pl-[3.75rem]"><Contrast value={value} /></div>
          </div>
        );
      })}
      <div className="flex items-center gap-1.5 border-t border-surface-border pt-2">
        <span className="text-2xs text-text-tertiary">Group</span>
        <select aria-label={`Group of ${row.name}`} value={row.group} onChange={(e) => ctx.act.toGroup([row.id], e.target.value)} className="min-w-0 flex-1 rounded border border-line bg-surface-base px-1 py-0.5 text-xs text-text-primary outline-none">
          {[...new Set([...ctx.groups, row.group])].map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => copy(hexOf(valueIn(token, ctx.shown[0]?.id ?? ctx.themes[0].id)))} className="flex items-center gap-1 rounded px-1.5 py-1 text-2xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary"><Copy size={10} /> Hex</button>
        <button type="button" onClick={() => copy(`var(--${row.linked ? row.name : cssName(row.name)})`)} className="flex items-center gap-1 rounded px-1.5 py-1 text-2xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary"><Copy size={10} /> var()</button>
        <button type="button" onClick={() => { ctx.act.duplicate([row.id]); ctx.setOpenId(null); }} className="rounded px-1.5 py-1 text-2xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary">Duplicate</button>
        <div className="flex-1" />
        <button type="button" aria-label={`Delete ${row.name}`} onClick={() => { ctx.act.remove([row.id]); ctx.setOpenId(null); }} className="flex items-center gap-1 rounded px-1.5 py-1 text-2xs text-text-secondary hover:bg-danger/10 hover:text-danger"><Trash2 size={10} /> Delete</button>
      </div>
      {row.use && (
        <p className="text-2xs text-text-tertiary" data-usage>
          {row.use.n === 0 ? "Nothing in the repository's components or stylesheets uses it." : `Used ${row.use.n} time${row.use.n === 1 ? "" : "s"} in ${usedIn(row)}.`}
        </p>
      )}
      {used.length > 0 && (
        <p className="text-2xs text-text-tertiary" data-used-by>
          Used by {used.map((c) => (c.setId === token.setId ? c.name : `${ctx.sets.find((s) => s.id === c.setId)?.name ?? "Another set"} / ${c.name}`)).join(", ")}. If this is deleted they keep the color they are now.
        </p>
      )}
      {row.linked && (
        <p className="text-2xs text-text-tertiary">
          Named by the repository.{" "}
          {ctx.rename && !row.readonly
            ? <button type="button" data-rename-open onClick={() => { ctx.setOpenId(null); ctx.rename!(row); }} className="text-accent underline-offset-2 hover:underline">Rename in repository…</button>
            : "It is defined where Motif can't change it yet, so it can't be renamed here."}
        </p>
      )}
    </div>
  );
}

// ── Palette ───────────────────────────────────────────────────────────────────

function Swatch({ row, label, ctx }: { row: Row; label: string; ctx: ColorCtx }) {
  const token = row.token as ColorToken;
  const picked = ctx.selection.selected.has(row.id);
  const dragged = ctx.drag.moving?.includes(row.id);
  const over = ctx.drag.over?.type === "token" && ctx.drag.over.id === row.id ? ctx.drag.over : null;
  const values = ctx.shown.map((t) => valueIn(token, t.id));
  return (
    <Popover.Root open={ctx.openId === row.id} onOpenChange={(o) => ctx.setOpenId(o ? row.id : null)}>
      <Popover.Anchor asChild>
        <div data-token-id={row.id} data-selected={picked || undefined} className={cn("group/card relative w-[88px] select-none", dragged && "opacity-40")} onPointerDown={(e) => ctx.drag.press(e, row.id)}>
          {over && <span aria-hidden className={cn("absolute -top-0.5 bottom-0 w-0.5 rounded bg-accent", over.after ? "-right-1.5" : "-left-1.5")} data-drop={over.after ? "after" : "before"} />}
          <button
            type="button"
            aria-label={`${row.name}: ${values.map(hexOf).join(", ")}`}
            aria-pressed={picked}
            onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) ctx.selection.click(row.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey }); else ctx.setOpenId(ctx.openId === row.id ? null : row.id); }}
            className={cn("flex h-14 w-full flex-col overflow-hidden rounded-md border border-black/10 shadow-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent", picked && "ring-2 ring-accent ring-offset-1 ring-offset-surface-base")}
          >
            {values.map((v, i) => <span key={i} className="block flex-1" style={{ backgroundColor: v }} />)}
          </button>
          <div className="mt-1 flex items-center gap-1">
            <span className="truncate text-2xs font-medium text-text-secondary" title={row.name}>{label}</span>
            {token.themeAlias && <span title={aliasTitle(token, ctx)} data-alias-mark className="flex-shrink-0 text-accent"><CornerDownRight size={9} aria-label={`${row.name} is another token`} /></span>}
            {row.changed && <span aria-label="Changed" title="Changed in Motif since the last sync" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sun" />}
            {row.readonly && <Lock size={8} aria-label="Read-only" className="flex-shrink-0 text-text-tertiary" />}
          </div>
          {values.map((v, i) => <p key={i} className="truncate font-mono text-[12px] leading-tight text-text-tertiary" title={`${ctx.shown[i].name}: ${v}`}>{hexOf(v)}</p>)}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-label={`Edit ${row.name}`} onOpenAutoFocus={(e) => e.preventDefault()} className="z-50 w-72 rounded-lg border border-surface-border bg-surface-raised p-3 shadow-2xl">
          <ColorEditor row={row} ctx={ctx} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function PaletteBody({ rows, group, ctx }: { rows: Row[]; group: string; ctx: ColorCtx }) {
  return (
    <div className="flex flex-wrap gap-3 px-4 pb-3 pt-1" data-palette-group={group}>
      {rows.map((r) => <Swatch key={r.id} row={r} label={r.name.startsWith(`${group}-`) ? r.name.slice(group.length + 1) : r.name} ctx={ctx} />)}
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

function ListRow({ row, ctx }: { row: Row; ctx: ColorCtx }) {
  const token = row.token as ColorToken;
  const picked = ctx.selection.selected.has(row.id);
  const dragged = ctx.drag.moving?.includes(row.id);
  const over = ctx.drag.over?.type === "token" && ctx.drag.over.id === row.id ? ctx.drag.over : null;
  return (
    <div
      data-token-id={row.id}
      data-selected={picked || undefined}
      onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("input,button,select")) ctx.drag.press(e, row.id); }}
      onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) ctx.selection.click(row.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey }); }}
      className={cn("group/row relative flex items-center gap-2 px-4 py-1 transition-colors", picked ? "bg-accent/10" : "hover:bg-surface-subtle", dragged && "opacity-40")}
    >
      {over && <span aria-hidden className={cn("absolute inset-x-0 h-0.5 bg-accent", over.after ? "bottom-0" : "top-0")} data-drop={over.after ? "after" : "before"} />}
      <span data-drag-handle title="Drag to move or reorder" className="-ml-3 w-3 flex-shrink-0 cursor-grab text-text-tertiary opacity-0 group-hover/row:opacity-100"><GripVertical size={12} /></span>
      <input type="checkbox" aria-label={`Select ${row.name}`} checked={picked} onChange={() => ctx.selection.toggle(row.id)} className="h-3 w-3 flex-shrink-0 accent-[var(--cobalt)]" />
      <InlineName row={row} taken={ctx.taken} onRename={(n) => ctx.act.rename(row.id, n)} className="w-44 flex-shrink-0 text-xs text-text-primary" />
      {ctx.shown.map((theme) => {
        const value = valueIn(token, theme.id);
        return (
          <div key={theme.id} className="flex w-44 flex-shrink-0 items-center gap-1.5">
            <Popover.Root open={ctx.openId === `${row.id}:${theme.id}`} onOpenChange={(o) => ctx.setOpenId(o ? `${row.id}:${theme.id}` : null)}>
              <Popover.Anchor asChild>
                <button type="button" aria-label={`Edit ${row.name} (${theme.name})`} onClick={() => ctx.setOpenId(ctx.openId === `${row.id}:${theme.id}` ? null : `${row.id}:${theme.id}`)} className="h-5 w-5 flex-shrink-0 rounded border border-black/15" style={{ backgroundColor: value }} />
              </Popover.Anchor>
              <Popover.Portal>
                <Popover.Content align="start" sideOffset={6} aria-label={`Edit ${row.name}`} onOpenAutoFocus={(e) => e.preventDefault()} className="z-50 w-72 rounded-lg border border-surface-border bg-surface-raised p-3 shadow-2xl">
                  <ColorEditor row={row} ctx={ctx} />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <CommitInput value={value} label={`${theme.name} value of ${row.name}`} mono className="w-full" onCommit={(t) => ctx.act.setColor(row.id, theme.id, t)} invalidHint="Not a color Motif can read" />
            {token.themeAlias?.[theme.id] && <span data-alias-chip title={`${theme.name} is the token ${aliasLabel(token, token.themeAlias[theme.id], ctx)}`} className="flex flex-shrink-0 items-center gap-0.5 text-2xs text-accent"><CornerDownRight size={10} aria-hidden />{aliasLabel(token, token.themeAlias[theme.id], ctx)}</span>}
          </div>
        );
      })}
      <div className="flex-1" />
      <Badges row={row} hasRepo={ctx.hasRepo} />
      <div className="flex w-12 flex-shrink-0 items-center justify-end gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
        <button type="button" aria-label={`Duplicate ${row.name}`} onClick={() => ctx.act.duplicate([row.id])} className="rounded p-1 text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"><Copy size={10} /></button>
        <button type="button" aria-label={`Delete ${row.name}`} onClick={() => ctx.act.remove([row.id])} className="rounded p-1 text-text-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={10} /></button>
      </div>
    </div>
  );
}

export function ListBody({ rows, ctx }: { rows: Row[]; ctx: ColorCtx }) {
  return (
    <div className="pb-2" data-list-group>
      {rows.map((r) => <ListRow key={r.id} row={r} ctx={ctx} />)}
    </div>
  );
}

export function ListHead({ ctx }: { ctx: ColorCtx }) {
  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-b border-surface-border px-4 py-1 text-2xs text-text-tertiary">
      <span className="w-3" />
      <span className="w-44">Name</span>
      {ctx.shown.map((t) => <span key={t.id} className="w-44 pl-[1.625rem]">{t.name}</span>)}
    </div>
  );
}
