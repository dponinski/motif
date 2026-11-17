"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isColorValue } from "@/lib/repo-scan/summary";
import { displayValue, type TokenChange, type TokenConflict } from "@/lib/token-sync/merge";

// What is shown of a change and of a clash, which the sync of stylesheets and the sync of design tokens files both give.
export type ShownChange = Omit<TokenChange, "kind"> & { kind?: TokenChange["kind"] };
export type ShownConflict = Pick<TokenConflict, "path" | "label" | "mine" | "theirs">;

// How token changes and clashes are shown: what a pull brings in, and the values that were changed in both places.

export function Value({ value }: { value: string | undefined }) {
  if (value === undefined) return <span className="text-text-tertiary">—</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {isColorValue(value) && <span className="h-3.5 w-3.5 flex-shrink-0 rounded border border-surface-border" style={{ backgroundColor: value }} />}
      <span className="truncate font-mono text-2xs text-text-secondary" title={value}>{value}</span>
    </span>
  );
}

export function ChangeList({ changes, label }: { changes: ShownChange[]; label: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, 8);
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-text-tertiary">{label} ({changes.length})</p>
      <ul className="rounded-md border border-surface-border">
        {shown.map((c) => (
          <li key={`${c.name}/${c.theme}`} className="flex items-center gap-2 border-b border-surface-border-subtle px-2.5 py-1.5 text-xs last:border-b-0">
            <span className="w-40 flex-shrink-0 truncate font-mono text-text-primary" title={c.name}>{c.name}</span>
            <span className="w-14 flex-shrink-0 text-2xs text-text-tertiary">{c.theme ?? ""}</span>
            {c.type === "removed" ? (
              <span className="text-text-tertiary">removed</span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                {c.type === "changed" && <><Value value={displayValue(c.kind ?? "color", c.before)} /><ArrowRight size={10} className="flex-shrink-0 text-text-tertiary" /></>}
                <Value value={displayValue(c.kind ?? "color", c.after)} />
                {c.type === "added" && <span className="text-2xs text-text-tertiary">new</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {changes.length > 8 && (
        <button className="mt-1 text-2xs text-text-tertiary underline hover:text-text-primary" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${changes.length}`}
        </button>
      )}
    </div>
  );
}

export function Conflicts({ conflicts, takeTheirs, onToggle, keeping = "Keeping Motif's value sends it to the repository in the next pull request." }: { conflicts: ShownConflict[]; takeTheirs: Set<number>; onToggle: (i: number, theirs: boolean) => void; keeping?: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text-primary">{conflicts.length} value{conflicts.length === 1 ? "" : "s"} changed in both places</p>
      <p className="mb-2 text-2xs leading-relaxed text-text-tertiary">Choose which to keep. {keeping}</p>
      <div className="flex flex-col gap-2">
        {conflicts.map((c, i) => (
          <div key={c.path.join("/")} className="rounded-md border border-surface-border p-2">
            <p className="mb-1.5 break-words font-mono text-xs text-text-primary">{c.label}</p>
            <div className="grid grid-cols-2 gap-1">
              {(["mine", "theirs"] as const).map((side) => {
                const selected = takeTheirs.has(i) === (side === "theirs");
                return (
                  <button
                    key={side}
                    aria-pressed={selected}
                    onClick={() => onToggle(i, side === "theirs")}
                    className={cn("flex min-w-0 flex-col items-start gap-0.5 rounded border px-2 py-1 text-left text-2xs transition-colors", selected ? "border-accent bg-accent/10 text-text-primary" : "border-transparent bg-surface-subtle text-text-secondary hover:text-text-primary")}
                  >
                    <span className="uppercase tracking-wider text-text-tertiary">{side === "mine" ? "Motif" : "Repository"}</span>
                    <Value value={side === "mine" ? c.mine : c.theirs} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

