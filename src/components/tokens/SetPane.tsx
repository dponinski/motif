"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ListPlus, Palette as PaletteIcon, Rows3, Search, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterItems, groupItems, nextName, sortForReading, uniqueName, type Only } from "@/lib/tokens/organize";
import { normalizeColor } from "@/lib/token-sync/color";
import { useDesignSystemStore, type ColorToken, type TokenKind, type TokenSet } from "@/store/design-system";
import { targetKey } from "@/lib/tokens/alias-colors";
import { editTokens } from "@/store/token-history";
import { useGitStore } from "@/store/git";
import { AddRow, type AddField } from "./fields";
import ThemeBar, { type ThemeShown } from "./ThemeBar";
import AddTokensDialog from "./AddTokensDialog";
import GroupedTokens from "./GroupedTokens";
import BulkBar from "./BulkBar";
import RenameDialog from "./RenameDialog";
import { ListBody, ListHead, PaletteBody, type ColorCtx } from "./ColorViews";
import { OtherBody, type OtherCtx } from "./OtherViews";
import { useRows, type Row } from "./rows";
import { isUnit, NUMBER_USES, STRING_USES, UNITS } from "@/lib/tokens/uses";
import { presetSlots, PRESETS } from "@/lib/tokens/compose";
import { useSelection } from "./useSelection";
import { useTokenDrag, type DropTarget } from "./drag";

// The list of the store each kind of token is in.
const LIST = { color: "colors", typography: "typography", spacing: "spacing", radius: "radii", shadow: "shadows", number: "numbers", string: "strings", composition: "compositions" } as const;

const free = (prefix: string, names: string[]) => { for (let i = 1; ; i++) if (!names.includes(`${prefix}-${i}`)) return `${prefix}-${i}`; };
const suggest = (kind: TokenKind, group: string, names: string[]) =>
  kind === "color" ? nextName(group, names) : kind === "spacing" ? free("space", names) : kind === "radius" ? free("radius", names) : kind === "shadow" ? free("shadow", names) : kind === "number" ? free("number", names) : kind === "string" ? free("string", names) : kind === "composition" ? free("composition", names) : free("text", names);

// A choice kept in the browser (which view of colors was last used); the same on the server and the first paint, then what was kept.
const listeners = new Set<() => void>();
function useStored<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const read = () => { try { return (localStorage.getItem(key) as T | null) ?? fallback; } catch { return fallback; } };
  const value = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, read, () => fallback);
  return [value, (v) => { try { localStorage.setItem(key, v); } catch { /* not remembered */ } listeners.forEach((l) => l()); }];
}

const chip = (on: boolean) => cn("rounded-full border px-2 py-0.5 text-2xs transition-colors", on ? "border-accent/50 bg-accent/15 text-accent" : "border-surface-border text-text-tertiary hover:text-text-secondary");

// What the person asked to add (New token), so the add row opens for that type: `n` makes a second request for the same type count.
export interface AddRequest { kind: TokenKind; n: number }

// Every kind of token in one reading order: colors, then lengths, numbers, strings, text styles, shadows, compositions.
export const KINDS: TokenKind[] = ["color", "spacing", "radius", "number", "string", "typography", "shadow", "composition"];

const ADD_TYPES: { kind: TokenKind; label: string }[] = [{ kind: "color", label: "Color" }, { kind: "number", label: "Number" }, { kind: "string", label: "String" }, { kind: "composition", label: "Composition" }];

export default function SetPane({ set, sets, request }: { set: TokenSet; sets: TokenSet[]; request: AddRequest | null }) {
  const ds = () => useDesignSystemStore.getState();
  const rows = [
    ...useRows("color", set.id, set.themes), ...useRows("spacing", set.id, set.themes), ...useRows("radius", set.id, set.themes), ...useRows("number", set.id, set.themes),
    ...useRows("string", set.id, set.themes), ...useRows("typography", set.id, set.themes), ...useRows("shadow", set.id, set.themes), ...useRows("composition", set.id, set.themes),
  ];
  // (A new array on every render: what depends on the rows depends on their ids.)
  const rowsKey = rows.map((r) => `${r.id}:${r.group}:${r.name}`).join("|");
  // Whether the repository has been counted for where its tokens are used.
  const counted = rows.some((r) => r.use !== null);
  const hasRepo = useGitStore((s) => !!(s.tokenLink || s.analysis));
  // The colors of every set: a color can be a color of another.
  const everyColor = useDesignSystemStore((s) => s.colors);
  const hasColors = rows.some((r) => r.kind === "color");
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<Only>("all");
  const [renaming, setRenaming] = useState<Row | null>(null);
  const [view, setView] = useStored<"palette" | "list">("motif-tokens-view", "palette");
  const [themeChoice, setThemeChoice] = useState<ThemeShown>("all");
  // A theme that was deleted is no longer shown.
  const themeId: ThemeShown = set.themes.some((t) => t.id === themeChoice) ? themeChoice : "all";
  const [adding, setAdding] = useState<string | null>(null);
  // What the add row adds: what New token was asked for.
  const [addKind, setAddKind] = useState<TokenKind>("color");
  const seen = useRef(0);
  useEffect(() => {
    if (!request || request.n === seen.current) return;
    seen.current = request.n;
    setAddKind(request.kind);
    setAdding("base");
  }, [request]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addMany, setAddMany] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  // Comparing themes needs more than one: with one left, a comparison that was on is off.
  const multiTheme = hasColors && set.themes.length > 1;
  const shownOnly: Only = (only === "differs" || only === "same") && !multiTheme ? "all" : only;
  const filtered = useMemo(() => filterItems(rows, query, shownOnly), [rows, query, shownOnly]);
  const groups = useMemo(() => groupItems(filtered), [filtered]);
  const order = useMemo(() => groups.flatMap((g) => g.items.map((r) => r.id)), [groups]);
  const selection = useSelection(order);
  const picked = useMemo(() => rows.filter((r) => selection.selected.has(r.id)), [rows, selection.selected]);
  // A name is taken by a token of the same kind (a color and a radius can both be `card`).
  const taken = (kind: TokenKind) => rows.filter((r) => r.kind === kind).map((r) => r.name);
  const allGroups = useMemo(() => [...new Set(rows.map((r) => r.group))], [rows]);
  const shown = themeId === "all" ? set.themes : set.themes.filter((t) => t.id === themeId);

  // A row is of its own kind: what is done to it is done as its own, and what is done to several is done to each kind among them.
  const kindOf = (id: string): TokenKind => rows.find((r) => r.id === id)?.kind ?? "color";
  const eachKind = (ids: string[]) => [...new Set(ids.map(kindOf))].map((k) => [k, ids.filter((id) => kindOf(id) === k)] as const);

  const drag = useTokenDrag({
    axis: "y",
    dragged: (id) => (selection.selected.has(id) ? selection.ids : [id]),
    onDrop: (ids, target: DropTarget) => editTokens(() => {
      if (target.type === "group") { for (const [k, of] of eachKind(ids)) ds().moveTokensBefore(k, of, null, target.group); return; }
      const t = rows.find((r) => r.id === target.id);
      if (!t) return;
      const siblings = sortForReading(rows.filter((r) => r.group === t.group));
      const i = siblings.findIndex((r) => r.id === t.id);
      // Each kind keeps its own order: what a token goes before is the nearest token of its kind from there on.
      for (const [k, of] of eachKind(ids)) {
        const from = target.after ? siblings.slice(i + 1) : siblings.slice(i);
        const next = from.find((r) => r.kind === k && !ids.includes(r.id));
        ds().moveTokensBefore(k, of, next?.id ?? null, t.group);
      }
    }),
  });

  const common = {
    rename: (id: string, name: string) => { editTokens(() => ds().renameToken(kindOf(id), id, name)); },
    duplicate: (ids: string[]) => { const made = editTokens(() => eachKind(ids).flatMap(([k, group]) => ds().duplicateTokens(k, group))); selection.selectAll(made); },
    remove: (ids: string[]) => { editTokens(() => { for (const [k, group] of eachKind(ids)) ds().deleteTokens(k, group); }); selection.clear(); },
  };
  const colorCtx: ColorCtx = {
    themes: set.themes, shown, selection, drag, taken, groups: allGroups, openId, setOpenId, hasRepo, rename: setRenaming,
    all: rows.filter((r) => r.kind === "color").map((r) => r.token as ColorToken),
    every: everyColor, sets,
    act: { ...common, setColor: (id, theme, text) => editTokens(() => ds().setColorText(id, theme, text)), setAlias: (id, theme, target) => editTokens(() => ds().setColorAlias(id, theme, target)), toGroup: (ids, group) => { editTokens(() => { for (const [k, of] of eachKind(ids)) ds().setTokenGroup(k, of, group); }); } },
  };
  const otherCtx: OtherCtx = {
    selection, drag, taken, hasRepo, rename: setRenaming, themes: set.themes, shown,
    act: {
      ...common,
      setThemeValue: (row, themeId, value) => editTokens(() => {
        const s = ds();
        const base = set.themes[0]?.id;
        if (row.kind === "number") { if (themeId === base) { if (typeof value === "number") s.updateNumber(row.id, { value }); } else s.setNumberThemeValue(row.id, themeId, typeof value === "number" ? value : null); }
        else if (row.kind === "string") { if (themeId === base) { if (typeof value === "string") s.updateString(row.id, { value }); } else s.setStringThemeValue(row.id, themeId, typeof value === "string" ? value : null); }
        else if (row.kind === "spacing" || row.kind === "radius") {
          if (themeId === base) { if (typeof value === "number") (row.kind === "spacing" ? s.updateSpacing : s.updateRadius)(row.id, { value }); }
          else s.setLengthThemeValue(row.kind, row.id, themeId, typeof value === "number" ? value : null);
        }
      }),
      update: (row: Row, patch: Record<string, unknown>) => editTokens(() => {
        const s = ds();
        if (row.kind === "spacing") s.updateSpacing(row.id, patch);
        else if (row.kind === "radius") s.updateRadius(row.id, patch);
        else if (row.kind === "shadow") s.updateShadow(row.id, patch);
        else if (row.kind === "number") s.updateNumber(row.id, patch);
        else if (row.kind === "string") s.updateString(row.id, patch);
        else if (row.kind === "composition") s.updateComposition(row.id, patch);
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
    switch (addKind) {
      case "color": return { focus: "value", fields: [{ key: "name", label: "New color name", placeholder: "name", width: "w-44" }, { key: "value", label: "New color value", placeholder: "#6366f1", width: "w-32", mono: true, validate: (v) => normalizeColor(v.trim()) !== null }] };
      case "spacing": return { focus: "value", fields: [{ key: "name", label: "New spacing name", placeholder: "name", width: "w-44" }, { key: "value", label: "New spacing value", placeholder: "px", width: "w-20", mono: true, validate: (v) => Number.isFinite(parseFloat(v)) }] };
      case "radius": return { focus: "value", fields: [{ key: "name", label: "New radius name", placeholder: "name", width: "w-44" }, { key: "value", label: "New radius value", placeholder: "px", width: "w-20", mono: true, validate: (v) => Number.isFinite(parseFloat(v)) }] };
      case "shadow": return { focus: "name", fields: [{ key: "name", label: "New shadow name", placeholder: "name", width: "w-44" }] };
      case "number": return { focus: "value", fields: [
        { key: "name", label: "New number name", placeholder: "name", width: "w-44" },
        { key: "value", label: "New number value", placeholder: "value", width: "w-20", mono: true, validate: (v) => Number.isFinite(parseFloat(v)) },
        { key: "unit", label: "New number unit", placeholder: "", width: "w-20", options: UNITS.map((u) => ({ value: u.value, label: u.label })) },
        { key: "use", label: "New number used as", placeholder: "", width: "w-36", options: NUMBER_USES },
      ] };
      case "string": return { focus: "value", fields: [
        { key: "name", label: "New string name", placeholder: "name", width: "w-44" },
        { key: "value", label: "New string value", placeholder: "text", width: "w-64", validate: (v) => v.trim() !== "" },
        { key: "use", label: "New string used as", placeholder: "", width: "w-36", options: STRING_USES },
      ] };
      case "composition": return { focus: "name", fields: [
        { key: "name", label: "New composition name", placeholder: "name", width: "w-44" },
        { key: "preset", label: "New composition made of", placeholder: "", width: "w-36", options: PRESETS.map((p) => ({ value: p.id, label: p.label })) },
      ] };
      case "typography": return { focus: "name", fields: [{ key: "name", label: "New text style name", placeholder: "name", width: "w-44" }, { key: "size", label: "New text style size", placeholder: "size", width: "w-20", mono: true, validate: (v) => v === "" || Number.isFinite(parseFloat(v)) }] };
    }
  };
  const addRow = (group: string, done: () => void) => {
    const { fields, focus } = fieldsFor();
    const kind = addKind;
    const names = () => (ds()[LIST[kind]] as { setId: string; name: string }[]).filter((t) => t.setId === set.id).map((t) => t.name);
    const initial = () => ({ type: kind, name: suggest(kind, group, names()), value: "", size: "", unit: "px", use: "", preset: "typography" });
    return (
      <AddRow
        key={addKind}
        fields={[{ key: "type", label: "Type of the new token", placeholder: "", width: "w-32", options: ADD_TYPES.map((t) => ({ value: t.kind, label: t.label })) }, ...fields]}
        onField={(key, value) => { if (key === "type") setAddKind(value as TokenKind); }}
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
            else if (kind === "number") s.addNumber({ name: unique, value: parseFloat(v.value), unit: isUnit(v.unit) ? v.unit : "px", ...(v.use ? { use: v.use } : {}), group, setId: set.id });
            else if (kind === "composition") { const made = PRESETS.find((p) => p.id === v.preset)?.id ?? "typography"; s.addComposition({ name: unique, kind: made, slots: presetSlots(made), group, setId: set.id }); }
            else if (kind === "string") s.addString({ name: unique, value: v.value.trim(), ...(v.use ? { use: v.use } : {}), group, setId: set.id });
            else s.addTypography({ name: unique, fontFamily: "Inter", fontSize: parseFloat(v.size) || 14, fontWeight: 400, lineHeight: Math.round((parseFloat(v.size) || 14) * 1.5), group, setId: set.id });
          });
          return initial();
        }}
      />
    );
  };

  const empty = rows.length === 0 ? (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center" data-empty>
      <p className="text-sm font-medium text-text-primary">No tokens in {set.name} yet</p>
      <p className="max-w-sm text-xs leading-relaxed text-text-tertiary">Make one with New token: a color, a number, a string or a composition, all in the same set. Or paste a list, or bring them in from the repository with Pull in Source control.</p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => { setAddKind("color"); setAdding("base"); }} className="rounded bg-blaze px-3 min-h-11 py-1.5 text-xs font-medium text-on-blaze hover:bg-blaze/90">Add a color</button>
        <button type="button" onClick={() => setAddMany(true)} className="rounded border border-line px-3 min-h-11 py-1.5 text-xs text-text-secondary hover:text-text-primary">Paste or make a scale</button>
      </div>
    </div>
  ) : (
    <p className="px-6 py-10 text-center text-xs text-text-tertiary" data-no-match>Nothing matches{query ? ` “${query}”` : ""}.</p>
  );

  // Showing a theme also makes it the set's open theme, which is the one a new theme starts as a copy of and the editor shows.
  const showTheme = (id: ThemeShown) => { setThemeChoice(id); if (id !== "all") ds().setActiveTheme(set.id, id); };
  return (
    <>
      <ThemeBar set={set} shown={themeId} onShow={showTheme} />
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-surface-border px-4 py-2">
        <label className="relative">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input ref={search} aria-label="Search tokens" placeholder="Search (press /)" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setQuery(""); e.currentTarget.blur(); } }} className="w-52 rounded border border-line bg-surface-base py-1 pl-6 pr-2 text-xs text-text-primary outline-none focus:border-accent" />
        </label>
        {([["all", "All"], ["changed", "Changed"], ["unsynced", "Not in repository"], ["readonly", "Read-only"], ...(counted ? [["unused", "Unused"]] : []), ...(multiTheme ? [["differs", "Differ between themes"], ["same", "Same in every theme"]] : [])] as [Only, string][]).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={shownOnly === id} onClick={() => setOnly(id)} className={chip(shownOnly === id)}>{label}</button>
        ))}
        {!counted && hasRepo && rows.some((r) => r.linked) && (
          <button type="button" disabled title="Scan the repository again (in Source control) to find out which tokens its code uses" className={cn(chip(false), "opacity-50")}>Unused</button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={() => setAddMany(true)} title="Paste CSS, a design tokens file or a list, or make a scale from one value" className="flex items-center gap-1 rounded border border-line px-2 min-h-11 py-1 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary"><ListPlus size={11} /> Add many…</button>
        {hasColors && (
          <div className="flex items-center gap-0.5 rounded bg-surface-subtle p-0.5" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "palette"} onClick={() => setView("palette")} className={cn("flex items-center gap-1 rounded px-2 min-h-11 py-1 text-xs", view === "palette" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}><PaletteIcon size={11} /> Palette</button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex items-center gap-1 rounded px-2 min-h-11 py-1 text-xs", view === "list" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}><Rows3 size={11} /> List</button>
          </div>
        )}
        {hasColors && (
          <button type="button" onClick={() => editTokens(() => ds().regroupColors(set.id))} title="Put each color in the group its name says: a ramp like gray-50 … gray-900 is one group, a pair like primary and primary-foreground another" className="flex items-center gap-1 rounded px-2 min-h-11 py-1 text-xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary"><Wand2 size={11} /> Regroup by name</button>
        )}
      </div>

      <BulkBar
        picked={picked}
        groups={allGroups}
        sets={sets}
        setId={set.id}
        alias={hasColors && picked.length > 0 && picked.every((r) => r.kind === "color") ? {
          themes: set.themes,
          targets: [...everyColor].filter((c) => !selection.selected.has(c.id)).sort((a, b) => Number(b.setId === set.id) - Number(a.setId === set.id))
            .map((c) => ({ key: targetKey(c, set.id), name: c.setId === set.id ? c.name : `${sets.find((x) => x.id === c.setId)?.name ?? "Another set"} / ${c.name}` })),
          apply: (choices) => {
            let refused = 0;
            editTokens(() => {
              for (const id of selection.ids) for (const [theme, target] of Object.entries(choices)) if (!ds().setColorAlias(id, theme, target)) refused++;
            });
            return refused;
          },
        } : undefined}
        copy={multiTheme ? { themes: set.themes, apply: (from, to) => editTokens(() => ds().copyThemeColors(selection.ids, from, to)) } : undefined}
        onGroup={(g) => { editTokens(() => { for (const [k, of] of eachKind(selection.ids)) ds().setTokenGroup(k, of, g); }); }}
        onSet={(id) => { editTokens(() => { for (const [k, of] of eachKind(selection.ids)) ds().moveTokensToSet(k, of, id); }); selection.clear(); }}
        onDuplicate={() => common.duplicate(selection.ids)}
        onDelete={() => common.remove(selection.ids)}
        onClear={selection.clear}
      />

      <RenameDialog row={renaming} kind={renaming?.kind ?? "color"} taken={taken(renaming?.kind ?? "color")} onClose={() => setRenaming(null)} />
      <AddTokensDialog open={addMany} onOpenChange={setAddMany} set={set} kind="color" />
      {hasColors && view === "list" && <ListHead ctx={colorCtx} />}
      <GroupedTokens
        rows={filtered}
        selection={selection}
        drag={drag}
        adding={adding}
        onAdding={setAdding}
        addRow={addRow}
        onRenameGroup={(from, to) => { editTokens(() => { for (const k of KINDS) ds().renameGroup(k, set.id, from, to); }); }}
        empty={empty}
        renderBody={(items, group) => {
          const colors = items.filter((r) => r.kind === "color");
          const others = items.filter((r) => r.kind !== "color");
          // The colors of a group are a palette (or a list); the other tokens of the group are rows under them.
          return (
            <>
              {colors.length > 0 && (view === "palette" ? <PaletteBody rows={colors} group={group} ctx={colorCtx} /> : <ListBody rows={colors} ctx={colorCtx} />)}
              {others.length > 0 && <OtherBody rows={others} ctx={otherCtx} />}
            </>
          );
        }}
      />
    </>
  );
}
