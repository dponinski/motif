"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ListPlus, Palette as PaletteIcon, Rows3, Search, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterItems, groupItems, nextName, sortForReading, uniqueName, type Only } from "@/lib/tokens/organize";
import { normalizeColor } from "@/lib/token-sync/color";
import { useDesignSystemStore, type ColorToken, type TokenKind, type TokenSet } from "@/store/design-system";
import { editTokens } from "@/store/token-history";
import { useGitStore } from "@/store/git";
import { AddRow, type AddField } from "./fields";
import AddTokensDialog from "./AddTokensDialog";
import GroupedTokens from "./GroupedTokens";
import BulkBar from "./BulkBar";
import { ListBody, ListHead, PaletteBody, type ColorCtx } from "./ColorViews";
import { OtherBody, type OtherCtx } from "./OtherViews";
import { useRows, type Row } from "./rows";
import { useSelection } from "./useSelection";
import { useTokenDrag, type DropTarget } from "./drag";

const NOUN: Record<TokenKind, string> = { color: "color", typography: "text style", spacing: "spacing", radius: "radius", shadow: "shadow" };

const free = (prefix: string, names: string[]) => { for (let i = 1; ; i++) if (!names.includes(`${prefix}-${i}`)) return `${prefix}-${i}`; };
const suggest = (kind: TokenKind, group: string, names: string[]) =>
  kind === "color" ? nextName(group, names) : kind === "spacing" ? free("space", names) : kind === "radius" ? free("radius", names) : kind === "shadow" ? free("shadow", names) : free("text", names);

// A choice kept in the browser (which view of colors was last used); the same on the server and the first paint, then what was kept.
const listeners = new Set<() => void>();
function useStored<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const read = () => { try { return (localStorage.getItem(key) as T | null) ?? fallback; } catch { return fallback; } };
  const value = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, read, () => fallback);
  return [value, (v) => { try { localStorage.setItem(key, v); } catch { /* not remembered */ } listeners.forEach((l) => l()); }];
}

const chip = (on: boolean) => cn("rounded-full border px-2 py-0.5 text-2xs transition-colors", on ? "border-accent/50 bg-accent/15 text-accent" : "border-surface-border text-text-tertiary hover:text-text-secondary");

export default function KindPane({ kind, set, sets }: { kind: TokenKind; set: TokenSet; sets: TokenSet[] }) {
  const ds = () => useDesignSystemStore.getState();
  const rows = useRows(kind, set.id, set.themes);
  // Whether the repository has been counted for where its tokens are used.
  const counted = rows.some((r) => r.use !== null);
  const hasRepo = useGitStore((s) => !!(s.tokenLink || s.analysis));
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<Only>("all");
  const [view, setView] = useStored<"palette" | "list">("motif-tokens-view", "palette");
  const [themeId, setThemeId] = useState<string>("all");
  const [adding, setAdding] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addMany, setAddMany] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => filterItems(rows, query, only), [rows, query, only]);
  const groups = useMemo(() => groupItems(filtered), [filtered]);
  const order = useMemo(() => groups.flatMap((g) => g.items.map((r) => r.id)), [groups]);
  const selection = useSelection(order);
  const picked = useMemo(() => rows.filter((r) => selection.selected.has(r.id)), [rows, selection.selected]);
  const taken = useMemo(() => rows.map((r) => r.name), [rows]);
  const allGroups = useMemo(() => [...new Set(rows.map((r) => r.group))], [rows]);
  const colorsView = kind === "color";
  const shown = themeId === "all" ? set.themes : set.themes.filter((t) => t.id === themeId);

  const drag = useTokenDrag({
    axis: colorsView && view === "palette" ? "x" : "y",
    dragged: (id) => (selection.selected.has(id) ? selection.ids : [id]),
    onDrop: (ids, target: DropTarget) => editTokens(() => {
      if (target.type === "group") { ds().moveTokensBefore(kind, ids, null, target.group); return; }
      const t = rows.find((r) => r.id === target.id);
      if (!t) return;
      const siblings = sortForReading(rows.filter((r) => r.group === t.group));
      const i = siblings.findIndex((r) => r.id === t.id);
      const next = target.after ? siblings.slice(i + 1).find((r) => !ids.includes(r.id)) : t;
      ds().moveTokensBefore(kind, ids, next?.id ?? null, t.group);
    }),
  });

  const common = {
    rename: (id: string, name: string) => { editTokens(() => ds().renameToken(kind, id, name)); },
    duplicate: (ids: string[]) => { const made = editTokens(() => ds().duplicateTokens(kind, ids)); selection.selectAll(made); },
    remove: (ids: string[]) => { editTokens(() => ds().deleteTokens(kind, ids)); selection.clear(); },
  };
  const colorCtx: ColorCtx = {
    themes: set.themes, shown, selection, drag, taken, groups: allGroups, openId, setOpenId, hasRepo,
    all: kind === "color" ? rows.map((r) => r.token as ColorToken) : [],
    act: { ...common, setColor: (id, theme, text) => editTokens(() => ds().setColorText(id, theme, text)), setAlias: (id, theme, target) => editTokens(() => ds().setColorAlias(id, theme, target)), toGroup: (ids, group) => { editTokens(() => ds().setTokenGroup(kind, ids, group)); } },
  };
  const otherCtx: OtherCtx = {
    selection, drag, taken, hasRepo,
    act: {
      ...common,
      update: (row: Row, patch: Record<string, unknown>) => editTokens(() => {
        const s = ds();
        if (row.kind === "spacing") s.updateSpacing(row.id, patch);
        else if (row.kind === "radius") s.updateRadius(row.id, patch);
        else if (row.kind === "shadow") s.updateShadow(row.id, patch);
        else s.updateTypography(row.id, patch);
      }),
    },
  };

  // The keys of the screen, when no field has them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "/" && !mod) { e.preventDefault(); search.current?.focus(); }
      else if (e.key === "Escape") { if (openId) setOpenId(null); else selection.clear(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selection.ids.length) { e.preventDefault(); common.remove(selection.ids); }
      else if (mod && e.key.toLowerCase() === "d" && selection.ids.length) { e.preventDefault(); common.duplicate(selection.ids); }
      else if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); selection.selectAll(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Adding: a row of fields at the top of a group.
  const fieldsFor = (): { fields: AddField[]; focus: string } => {
    switch (kind) {
      case "color": return { focus: "value", fields: [{ key: "name", label: "New color name", placeholder: "name", width: "w-44" }, { key: "value", label: "New color value", placeholder: "#6366f1", width: "w-32", mono: true, validate: (v) => normalizeColor(v.trim()) !== null }] };
      case "spacing": return { focus: "value", fields: [{ key: "name", label: "New spacing name", placeholder: "name", width: "w-44" }, { key: "value", label: "New spacing value", placeholder: "px", width: "w-20", mono: true, validate: (v) => Number.isFinite(parseFloat(v)) }] };
      case "radius": return { focus: "value", fields: [{ key: "name", label: "New radius name", placeholder: "name", width: "w-44" }, { key: "value", label: "New radius value", placeholder: "px", width: "w-20", mono: true, validate: (v) => Number.isFinite(parseFloat(v)) }] };
      case "shadow": return { focus: "name", fields: [{ key: "name", label: "New shadow name", placeholder: "name", width: "w-44" }] };
      case "typography": return { focus: "name", fields: [{ key: "name", label: "New text style name", placeholder: "name", width: "w-44" }, { key: "size", label: "New text style size", placeholder: "size", width: "w-20", mono: true, validate: (v) => v === "" || Number.isFinite(parseFloat(v)) }] };
    }
  };
  const addRow = (group: string, done: () => void) => {
    const { fields, focus } = fieldsFor();
    const names = () => ds()[kind === "color" ? "colors" : kind === "spacing" ? "spacing" : kind === "radius" ? "radii" : kind === "shadow" ? "shadows" : "typography"].filter((t) => t.setId === set.id).map((t) => t.name);
    const initial = () => ({ name: suggest(kind, group, names()), value: "", size: "" });
    return (
      <AddRow
        fields={fields}
        focus={focus}
        initial={initial()}
        onClose={done}
        detect={kind === "color" ? (key, value, values) => (key === "name" && normalizeColor(value.trim()) !== null && !values.value ? { value: value.trim(), name: suggest(kind, group, names()) } : null) : undefined}
        onAdd={(v) => {
          const name = v.name.trim() || suggest(kind, group, names());
          const unique = uniqueName(name, names());
          editTokens(() => {
            const s = ds();
            if (kind === "color") s.addColor({ name: unique, value: v.value.trim(), group, setId: set.id });
            else if (kind === "spacing") s.addSpacing({ name: unique, value: parseFloat(v.value), group, setId: set.id });
            else if (kind === "radius") s.addRadius({ name: unique, value: parseFloat(v.value), group, setId: set.id });
            else if (kind === "shadow") s.addShadow({ name: unique, x: 0, y: 4, blur: 8, spread: 0, color: "rgba(0,0,0,0.1)", group, setId: set.id });
            else s.addTypography({ name: unique, fontFamily: "Inter", fontSize: parseFloat(v.size) || 14, fontWeight: 400, lineHeight: Math.round((parseFloat(v.size) || 14) * 1.5), group, setId: set.id });
          });
          return initial();
        }}
      />
    );
  };

  const empty = rows.length === 0 ? (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center" data-empty>
      <p className="text-sm font-medium text-text-primary">No {NOUN[kind]} tokens in {set.name} yet</p>
      <p className="max-w-sm text-xs leading-relaxed text-text-tertiary">Add the first one below, or bring them in from the repository with Repo sync.</p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setAdding("base")} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90">Add a {NOUN[kind]}</button>
        <button type="button" onClick={() => setAddMany(true)} className="rounded border border-surface-border px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Paste or make a scale</button>
      </div>
    </div>
  ) : (
    <p className="px-6 py-10 text-center text-xs text-text-tertiary" data-no-match>Nothing matches{query ? ` “${query}”` : ""}.</p>
  );

  const showTheme = colorsView && set.themes.length > 1;
  return (
    <>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-surface-border px-4 py-2">
        <label className="relative">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input ref={search} aria-label="Search tokens" placeholder="Search (press /)" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setQuery(""); e.currentTarget.blur(); } }} className="w-52 rounded border border-surface-border bg-surface-base py-1 pl-6 pr-2 text-xs text-text-primary outline-none focus:border-accent" />
        </label>
        {([["all", "All"], ["changed", "Changed"], ["unsynced", "Not in repository"], ["readonly", "Read-only"], ...(counted ? [["unused", "Unused"]] : [])] as [Only, string][]).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={only === id} onClick={() => setOnly(id)} className={chip(only === id)}>{label}</button>
        ))}
        {!counted && hasRepo && rows.some((r) => r.linked) && (
          <button type="button" disabled title="Scan the repository again (in the Git panel) to find out which tokens its code uses" className={cn(chip(false), "opacity-50")}>Unused</button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={() => setAddMany(true)} title="Paste CSS, a design tokens file or a list, or make a scale from one value" className="flex items-center gap-1 rounded border border-surface-border px-2 py-1 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary"><ListPlus size={11} /> Add many…</button>
        {showTheme && (
          <select aria-label="Theme shown" value={themeId} onChange={(e) => setThemeId(e.target.value)} className="rounded border border-surface-border bg-surface-base px-1.5 py-1 text-xs text-text-secondary outline-none">
            <option value="all">All themes</option>
            {set.themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {colorsView && (
          <div className="flex items-center gap-0.5 rounded bg-surface-subtle p-0.5" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "palette"} onClick={() => setView("palette")} className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", view === "palette" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}><PaletteIcon size={11} /> Palette</button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", view === "list" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}><Rows3 size={11} /> List</button>
          </div>
        )}
        {colorsView && (
          <button type="button" onClick={() => editTokens(() => ds().regroupColors(set.id))} title="Put each color in the group its name says: a ramp like gray-50 … gray-900 is one group, a pair like primary and primary-foreground another" className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary"><Wand2 size={11} /> Regroup by name</button>
        )}
      </div>

      <BulkBar
        picked={picked}
        groups={allGroups}
        sets={sets}
        setId={set.id}
        onGroup={(g) => { editTokens(() => ds().setTokenGroup(kind, selection.ids, g)); }}
        onSet={(id) => { editTokens(() => ds().moveTokensToSet(kind, selection.ids, id)); selection.clear(); }}
        onDuplicate={() => common.duplicate(selection.ids)}
        onDelete={() => common.remove(selection.ids)}
        onClear={selection.clear}
      />

      <AddTokensDialog open={addMany} onOpenChange={setAddMany} set={set} kind={kind} />
      {colorsView && view === "list" && rows.length > 0 && <ListHead ctx={colorCtx} />}
      <GroupedTokens
        rows={filtered}
        selection={selection}
        drag={drag}
        adding={adding}
        onAdding={setAdding}
        addRow={addRow}
        onRenameGroup={(from, to) => { editTokens(() => ds().renameGroup(kind, set.id, from, to)); }}
        empty={empty}
        renderBody={(items, group) => colorsView
          ? (view === "palette" ? <PaletteBody rows={items} group={group} ctx={colorCtx} /> : <ListBody rows={items} ctx={colorCtx} />)
          : <OtherBody rows={items} ctx={otherCtx} />}
      />
    </>
  );
}
