"use client";

import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { findGoogleFont, firstFamily, fontValue, KINDS, searchFonts, type FontKind } from "@/lib/fonts/google";
import { loadFonts } from "@/lib/fonts/load";
import { CommitInput } from "./fields";

// A font family field: the text as written (any font, with its fallbacks), and a list of Google Fonts to pick from, each shown in its own face.

export function FontPicker({ label, current, onPick, children }: { label: string; current: string; onPick: (value: string) => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<FontKind | "all">("all");
  const results = useMemo(() => searchFonts(query, kind), [query, kind]);
  const chosen = firstFamily(current)?.toLowerCase();
  useEffect(() => {
    if (!open || results.length === 0) return;
    const names = results.map((f) => f.family);
    loadFonts(names, [...new Set(names.join(""))].join(""));
  }, [open, results]);
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQuery(""); setKind("all"); } }}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-label={`Fonts for ${label}`} className="z-50 w-80 rounded-lg border border-surface-border bg-surface-raised p-3 shadow-xl">
          <input autoFocus aria-label="Search fonts" placeholder="Search Google Fonts" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 w-full rounded-md border border-surface-border bg-surface px-2 text-text-primary outline-none focus:border-accent" />
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Kind of font">
            {([{ id: "all", label: "All" }, ...KINDS] as { id: FontKind | "all"; label: string }[]).map((k) => (
              <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)} className={cn("rounded-full border px-2 py-0.5 text-text-secondary", kind === k.id ? "border-accent bg-accent/10 text-text-primary" : "border-surface-border hover:bg-surface-subtle")}>{k.label}</button>
            ))}
          </div>
          <ul aria-label="Google Fonts" className="mt-2 max-h-72 overflow-y-auto">
            {results.map((f) => (
              <li key={f.family}>
                <button
                  type="button"
                  data-font={f.family}
                  aria-current={chosen === f.family.toLowerCase()}
                  onClick={() => { onPick(fontValue(f.family, f.kind)); setOpen(false); }}
                  className={cn("flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-subtle", chosen === f.family.toLowerCase() && "bg-surface-subtle")}
                >
                  <span className="truncate text-lg text-text-primary" style={{ fontFamily: `"${f.family}", ${f.kind === "monospace" ? "monospace" : f.kind === "serif" ? "serif" : "sans-serif"}` }}>{f.family}</span>
                  <span className="flex-shrink-0 text-text-tertiary">{f.kind}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-2 py-3 text-text-tertiary">No Google font is called that. Type the name into the field to use any other font.</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// The button that opens the list, for a field that is there already.
export function BrowseFonts({ label, current, onPick }: { label: string; current: string; onPick: (value: string) => void }) {
  return (
    <FontPicker label={label} current={current} onPick={onPick}>
      <button type="button" aria-label={`Browse fonts for ${label}`} className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-text-secondary hover:bg-surface-subtle hover:text-text-primary"><Type size={16} /></button>
    </FontPicker>
  );
}

// A text field for a font-family value with a Browse button beside it.
export default function FontField({ label, value, onCommit, className, mono, placeholder }: { label: string; value: string; onCommit: (text: string) => boolean; className?: string; mono?: boolean; placeholder?: string }) {
  const known = findGoogleFont(firstFamily(value) ?? "");
  return (
    <span className="inline-flex items-center gap-1" data-font-field data-google={known ? known.family : undefined}>
      <CommitInput value={value} onCommit={onCommit} label={label} className={className} mono={mono} placeholder={placeholder} />
      <BrowseFonts label={label} current={value} onPick={(v) => onCommit(v)} />
    </span>
  );
}
