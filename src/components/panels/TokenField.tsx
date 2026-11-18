"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClassGroup } from "@/lib/edit/classes";
import { choicesFor, isFlagged, splitOpacity, statusOf, suggest, swatchOf, type Choice, type TokenIndex } from "@/lib/edit/tokens";

// The controls that assign the repository's tokens to an element: a picker for colors, a list with the tokens
// first for everything else, and for a value that is written out, the token it could be instead.

const shown = (value: string) => (value === "DEFAULT" ? "default" : value);

// A color only ever comes from `swatchOf`, which reads the value and writes it again as hex, so nothing a
// repository wrote reaches a style as it is.
function Swatch({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("h-3 w-3 flex-shrink-0 rounded-sm border", color ? "border-black/15" : "border-dashed border-text-tertiary/50", className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

// The color a class value stands for: a token's, or the one written between brackets, or a word like `white`.
function colorOf(value: string, tokens: Choice[]): string | null {
  const token = tokens.find((t) => t.value === value);
  if (token) return token.swatch;
  const inner = value.match(/^\[(.*)\]$/)?.[1];
  return swatchOf(inner !== undefined ? inner.replace(/^[a-z-]+:(?!\/)/, "").replace(/_/g, " ") : value);
}

const KEYWORDS = ["transparent", "current", "white", "black"];
const OPACITIES = ["100", "95", "90", "80", "75", "70", "60", "50", "40", "30", "25", "20", "10", "5", "0"];

interface Row {
  value: string;
  label: string;
  hint: string | null;
  swatch: string | null;
  // Why it is offered, when it is not simply a token that matched: "same color", "as written".
  note: string | null;
}

// Tokens whose name has what was typed in it: the one that is exactly it first, then the ones that start with it.
function matching(tokens: Choice[], typed: string): Choice[] {
  const q = typed.toLowerCase();
  const rank = (c: Choice) => (c.value === q ? 0 : c.value.startsWith(q) ? 1 : 2);
  return tokens.filter((c) => c.value.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b));
}

export function ColorField({
  group, label, value, inherited, index, theme, onChange,
}: {
  group: ClassGroup;
  label: string;
  value: string | null;
  // What applies until this state sets its own, when a state is being edited.
  inherited: string | null;
  index: TokenIndex;
  theme: string;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const tokens = useMemo(() => choicesFor(group, index, theme).tokens, [group, index, theme]);
  const current = value === null ? null : splitOpacity(value);
  const flagged = value !== null && isFlagged("color", value, index);

  const typed = splitOpacity(query.trim());
  const rows = useMemo((): Row[] => {
    const text = typed.color;
    if (!text) return tokens.map((t) => ({ value: t.value, label: t.value, hint: t.hint, swatch: t.swatch, note: null }));
    const exact = tokens.some((t) => t.value === text);
    // A color typed or pasted as a value (`#4f46e5`, `oklch(...)`) is looked up: the token that is that color
    // comes first, and the color as written stays on offer.
    // A word (`transparent`, `white`) is a class value as it is; only a written-out color needs brackets.
    if (!exact && /^#|\(/.test(text) && swatchOf(text)) {
      const written = `[${text.replace(/\s+/g, "_")}]`;
      const found = suggest(group, written, index);
      return [
        ...(found ? [{ value: splitOpacity(found.value).color, label: splitOpacity(found.value).color, hint: found.hint, swatch: found.swatch, note: found.exact ? "same color" : "closest" }] : []),
        { value: written, label: written, hint: null, swatch: swatchOf(text), note: "as written" },
      ];
    }
    const found = matching(tokens, text).map((t) => ({ value: t.value, label: t.value, hint: t.hint, swatch: t.swatch, note: null }));
    return exact ? found : [...found, { value: text, label: text, hint: null, swatch: colorOf(text, tokens), note: "as written" }];
  }, [tokens, typed.color, group, index]);

  useEffect(() => { setActive(0); }, [query]);
  // Opening starts from the token in use, so it is in view and one arrow away from its neighbours.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(Math.max(0, tokens.findIndex((t) => t.value === current?.color)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Choosing a color keeps the opacity the class has, as changing a fill does anywhere; typing `name/50` sets
  // both, and a word such as `transparent` has no use for one.
  const choose = (color: string, opacity: string | null | undefined = undefined) => {
    const keep = opacity !== undefined ? opacity : typed.opacity ?? current?.opacity ?? null;
    onChange(keep && keep !== "100" ? `${color}/${keep}` : color);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows[active]; if (row) choose(row.value); }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          data-value={value ?? ""}
          className={cn("input-sm flex w-full min-w-0 items-center gap-1.5 text-left", flagged && "border-sun/60")}
        >
          <Swatch color={current ? colorOf(current.color, tokens) : null} />
          <span className={cn("min-w-0 flex-1 truncate", value === null && "text-text-tertiary")}>{value ?? (inherited ? `inherits ${inherited}` : "—")}</span>
          <ChevronDown size={11} className="flex-shrink-0 text-text-tertiary" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          aria-label={`${label} tokens`}
          className="z-50 w-64 rounded-lg border border-surface-border bg-surface-raised p-2 text-text-primary shadow-2xl"
          onOpenAutoFocus={(e) => { e.preventDefault(); input.current?.focus(); }}
        >
          <input
            ref={input}
            className="input-sm"
            aria-label={`${label}: search tokens or type a value`}
            placeholder={tokens.length ? "Search tokens, or type a value" : "Type a value"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <div role="listbox" aria-label={`${label} tokens`} className="mt-1.5 max-h-60 overflow-y-auto">
            {rows.map((row, i) => (
              <button
                key={`${row.value}|${row.note ?? ""}`}
                type="button"
                role="option"
                aria-selected={i === active}
                ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(row.value)}
                className={cn("flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs", i === active ? "bg-accent/15 text-text-primary" : "text-text-secondary")}
              >
                <Swatch color={row.swatch} className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.note
                  ? <span className="flex-shrink-0 text-2xs text-text-tertiary">{row.note}</span>
                  : row.hint && <span className="flex-shrink-0 font-mono text-2xs text-text-tertiary">{row.hint}</span>}
                {row.value === current?.color && <Check size={11} className="flex-shrink-0 text-accent" />}
              </button>
            ))}
            {rows.length === 0 && (
              <p className="px-1.5 py-2 text-2xs leading-relaxed text-text-tertiary">
                {tokens.length ? "No token by that name." : "This repository has no color tokens a class can name. Type a value, such as a Tailwind color."}
              </p>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-surface-border pt-1.5">
            {KEYWORDS.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() => choose(word, word === "transparent" ? null : undefined)}
                className={cn("flex items-center gap-1 rounded border border-surface-border px-1.5 py-0.5 text-2xs hover:bg-surface-subtle", current?.color === word ? "text-text-primary" : "text-text-secondary")}
              >
                <Swatch color={swatchOf(word)} className="h-2.5 w-2.5" /> {word}
              </button>
            ))}
          </div>
          <label className="mt-1.5 flex items-center gap-2 text-2xs text-text-tertiary">
            Opacity
            <select
              className="input-sm !w-20"
              aria-label={`${label} opacity`}
              disabled={!current}
              value={current?.opacity ?? "100"}
              onChange={(e) => { if (current) onChange(e.target.value === "100" ? current.color : `${current.color}/${e.target.value}`); }}
            >
              {current?.opacity && !OPACITIES.includes(current.opacity) && <option value={current.opacity}>{current.opacity}</option>}
              {OPACITIES.map((o) => <option key={o} value={o}>{o}%</option>)}
            </select>
          </label>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// A list for a group whose values are steps or names: the repository's tokens first, each with what it is worth,
// then what Tailwind ships with.
export function ChoiceField({
  group, label, value, inherited, index, theme, onChange, scaleLabel = "Tailwind",
}: {
  group: ClassGroup;
  // What the list calls the values that aren't the repository's tokens.
  scaleLabel?: string;
  label: string;
  value: string | null;
  inherited: string | null;
  index: TokenIndex;
  theme: string;
  onChange: (value: string | null) => void;
}) {
  const { tokens, scale } = useMemo(() => choicesFor(group, index, theme), [group, index, theme]);
  const known = value !== null && [...tokens, ...scale].some((c) => c.value === value);
  const flagged = value !== null && !!group.role && isFlagged(group.role, value, index);
  const option = (c: Choice) => <option key={c.value} value={c.value}>{shown(c.value)}{c.hint ? ` · ${c.hint}` : ""}</option>;
  return (
    <select className={cn("input-sm w-full", flagged && "border-sun/60")} aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{inherited ? `inherits ${shown(inherited)}` : "—"}</option>
      {value !== null && !known && <option value={value}>{value}</option>}
      {tokens.length > 0 ? (
        <>
          <optgroup label="Tokens">{tokens.map(option)}</optgroup>
          {scale.length > 0 && <optgroup label={scaleLabel}>{scale.map(option)}</optgroup>}
        </>
      ) : scale.map(option)}
    </select>
  );
}

// What a field's value is, for the mark beside its label: one of the repository's tokens, or a value that is
// written out where a token (or a step of the scale) could be.
export function fieldStatus(group: ClassGroup, value: string | null, index: TokenIndex): "token" | "flag" | null {
  if (!group.role || value === null) return null;
  if (isFlagged(group.role, value, index)) return "flag";
  return statusOf(group.role, value, index) === "token" ? "token" : null;
}

// What it takes to make a written-out value a token (see `useSaveToken`).
export interface SaveToken {
  // The prefix the name carries so a class can name it, or why it can't be done here.
  plan: { prefix: string } | { reason: string };
  kind: "color" | "radius" | "spacing";
  prefix: string;
  // The value, as the token will have it ("#1d4ed8", "10px").
  value: string;
  suggested: string;
  taken: (name: string) => boolean;
  // Adds the token, and uses it where the value was.
  save: (name: string) => void;
}

// A name for the token, and the press that makes it and uses it.
function SaveAsToken({ label, save }: { label: string; save: SaveToken }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const reason = "reason" in save.plan ? save.plan.reason : null;
  const typed = name.trim();
  const problem = !typed ? "Give it a name" : save.taken(typed) ? "A token has that name" : null;
  const go = () => { if (problem || reason) return; save.save(typed); setOpen(false); };
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setName(save.suggested); }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={!!reason}
          aria-label={`Save ${label} as a token`}
          title={reason ?? "Make this value a token, and use it here"}
          className="flex items-center gap-1 rounded border border-sun/40 px-1.5 py-0.5 text-text-primary hover:bg-sun-soft disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Plus size={10} /> Save as token…
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="left" align="start" sideOffset={10} collisionPadding={8} aria-label={`Save ${label} as a token`} className="z-50 w-64 rounded-lg border border-surface-border bg-surface-raised p-3 text-xs text-text-primary shadow-2xl" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.select(); }}>
          <p className="mb-2 flex items-center gap-1.5 text-text-secondary">
            {save.kind === "color" && <Swatch color={swatchOf(save.value)} className="h-3.5 w-3.5" />}
            <span className="font-mono">{save.value}</span>
          </p>
          <label className="flex flex-col gap-1 text-2xs text-text-tertiary">
            Name
            <span className="flex items-center gap-1">
              {save.prefix && <span className="font-mono text-text-tertiary">{save.prefix}</span>}
              <input
                className={cn("input-sm min-w-0 flex-1", problem && typed && "border-danger/60")}
                aria-label={`Name of the new ${save.kind} token`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}
                autoComplete="off"
                spellCheck={false}
              />
            </span>
          </label>
          <p className="mt-1.5 min-h-[1rem] text-2xs text-text-tertiary">{problem && typed ? problem : "It goes in the tokens linked to the repository, and is sent with the next sync."}</p>
          <button type="button" disabled={!!problem} onClick={go} className="mt-1 w-full rounded bg-blaze px-2 py-1 text-xs font-medium text-on-blaze disabled:opacity-40">Save and use</button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Under a field whose value is written out: what is wrong with it, and one press to make it the token it matches.
export function RawHint({
  group, label, value, index, onUse, save, indent = true,
}: {
  save?: SaveToken | null;
  group: ClassGroup;
  label: string;
  value: string | null;
  index: TokenIndex;
  onUse: (value: string) => void;
  // Lines up under the control of a row with a label in front of it.
  indent?: boolean;
}) {
  if (!group.role || value === null || !isFlagged(group.role, value, index)) return null;
  const found = suggest(group, value, index);
  // `save` goes only to a value with no token that is the same (see `useSaveToken`).
  const palette = statusOf(group.role, value, index) === "palette";
  const name = found ? shown(found.value) : "";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-ink", indent && "pl-[90px]")} data-raw={group.id}>
      <span>{palette ? "Tailwind color, not a token" : "Not a token"}</span>
      {found && (
        <button
          type="button"
          onClick={() => onUse(found.value)}
          aria-label={`Use ${name} for ${label}`}
          title={found.exact ? `${name} is the same${found.hint ? ` (${found.hint})` : ""}` : `${name} is the closest${found.hint ? ` (${found.hint})` : ""}, not the same`}
          className="flex items-center gap-1 rounded border border-sun/40 px-1.5 py-0.5 text-text-primary hover:bg-sun-soft"
        >
          {found.swatch && <Swatch color={found.swatch} className="h-2.5 w-2.5" />}
          {found.exact ? "Use" : "Closest:"} {name}{!found.swatch && found.hint ? ` (${found.hint})` : ""}
        </button>
      )}
      {save && <SaveAsToken label={label} save={save} />}
    </div>
  );
}
