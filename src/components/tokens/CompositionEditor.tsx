"use client";

import { useShallow } from "zustand/react/shallow";
import { Plus, X } from "lucide-react";
import { normalizeColor } from "@/lib/token-sync/color";
import { choicesFor, newSlotName, previewStyle, slotMissing, slotText, type ComposeData } from "@/lib/tokens/compose";
import type { Composition, Slot, TokenType, Unit } from "@/lib/tokens/model";
import { isUnit, UNITS } from "@/lib/tokens/uses";
import { useDesignSystemStore } from "@/store/design-system";
import { CommitInput } from "./fields";

// The parts of a composition: each is a value of its own or another token of its type (which it then follows), and what it comes to.

const selectClass = "rounded border border-surface-border bg-surface-base px-1 min-h-11 py-0.5 text-2xs text-text-secondary outline-none focus:border-accent";

export function useComposeData(): ComposeData {
  return useDesignSystemStore(useShallow((s): ComposeData => ({ colors: s.colors, numbers: s.numbers, strings: s.strings, spacing: s.spacing, radii: s.radii })));
}

// "1.5rem" as a value and a unit.
export function splitNumber(text: string): { value: string; unit: Unit } {
  const m = /^(-?[\d.]+)(px|rem|em|%)?$/.exec(text.trim());
  return m ? { value: m[1], unit: (m[2] ?? "") as Unit } : { value: text, unit: "" };
}

// What the composition looks like.
export function Sample({ composition, small }: { composition: Composition; small?: boolean }) {
  const data = useComposeData();
  const style = previewStyle(composition, data);
  if (composition.kind === "typography") return <span data-sample className={small ? "w-24 flex-shrink-0 truncate text-text-primary" : "text-text-primary"} style={small ? { fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontSize: 14, lineHeight: 1.2 } : style}>{small ? "Aa Quick" : "The quick brown fox jumps over the lazy dog"}</span>;
  if (composition.kind === "shadow") return <span data-sample className="h-8 w-8 flex-shrink-0 rounded border border-surface-border bg-surface-base" style={style} />;
  return <span data-sample className="w-24 flex-shrink-0 truncate rounded bg-surface-subtle px-1.5 py-0.5 text-center text-2xs text-text-secondary">{composition.slots.length} {composition.slots.length === 1 ? "part" : "parts"}</span>;
}

function SlotRow({ composition, slot, data, sets, onSlot, onRemove, onRename }: {
  composition: Composition; slot: Slot; data: ComposeData; sets: { id: string; name: string }[];
  onSlot: (patch: Partial<Slot> & { ref?: string | undefined }) => void; onRemove?: () => void; onRename?: (name: string) => boolean;
}) {
  const label = `${slot.name} of ${composition.name}`;
  const choices = choicesFor(data, slot.type);
  const linked = slot.ref ? choices.find((c) => c.id === slot.ref) : undefined;
  const missing = slotMissing(slot, data);
  const text = slotText(slot, data);
  const bySet = sets.map((s) => ({ set: s, items: choices.filter((c) => c.setId === s.id) })).filter((g) => g.items.length);

  // Back to a value of its own: the value the token is now.
  const own = () => {
    const now = text ?? "";
    onSlot(slot.type === "number" ? { ref: undefined, ...splitNumber(now) } : { ref: undefined, value: now });
  };

  return (
    <div data-slot={slot.name} className="flex flex-wrap items-center gap-2">
      {onRename
        ? <CommitInput value={slot.name} label={`Name of ${label}`} frame className="w-28" invalidHint="A name this composition doesn't have yet" onCommit={(t) => onRename(t.trim())} />
        : <span className="w-28 flex-shrink-0 truncate text-xs text-text-secondary" title={slot.name}>{slot.name}</span>}
      {onRename && (
        <select aria-label={`Type of ${label}`} value={slot.type} onChange={(e) => onSlot({ type: e.target.value as TokenType, ref: undefined, value: e.target.value === "color" ? "#000000" : e.target.value === "number" ? "0" : "", unit: e.target.value === "number" ? "px" : undefined })} className={selectClass}>
          <option value="color">Color</option><option value="number">Number</option><option value="string">String</option>
        </select>
      )}
      {!slot.ref && slot.type === "number" && (
        <>
          <CommitInput value={slot.value ?? ""} label={label} mono frame className="w-16 text-right" invalidHint="A number" onCommit={(t) => { const n = parseFloat(t); if (!Number.isFinite(n)) return false; onSlot({ value: String(n) }); return true; }} />
          <select aria-label={`Unit of ${label}`} value={slot.unit ?? ""} onChange={(e) => { if (isUnit(e.target.value)) onSlot({ unit: e.target.value }); }} className={selectClass}>
            {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </>
      )}
      {!slot.ref && slot.type === "string" && (
        <CommitInput value={slot.value ?? ""} label={label} frame className="w-56" invalidHint="Can't be empty" onCommit={(t) => { if (!t.trim()) return false; onSlot({ value: t.trim() }); return true; }} />
      )}
      {!slot.ref && slot.type === "color" && (
        <>
          <span aria-hidden className="h-4 w-4 flex-shrink-0 rounded border border-surface-border" style={{ background: slot.value }} />
          <CommitInput value={slot.value ?? ""} label={label} mono frame className="w-36" invalidHint="Not a color" onCommit={(t) => { if (normalizeColor(t.trim()) === null) return false; onSlot({ value: t.trim() }); return true; }} />
        </>
      )}
      {slot.ref && (
        <span data-slot-token className={missing ? "rounded bg-danger/10 px-1.5 py-0.5 text-2xs text-danger" : "rounded bg-accent/10 px-1.5 py-0.5 text-2xs text-accent"}>
          {linked ? `${linked.setId === composition.setId ? "" : `${sets.find((s) => s.id === linked.setId)?.name ?? "Another set"} / `}${linked.name}` : "A token that is gone"}
        </span>
      )}
      <select
        aria-label={`Make ${label} a token`}
        value={slot.ref && linked ? slot.ref : ""}
        onChange={(e) => { if (e.target.value === "") own(); else onSlot({ ref: e.target.value }); }}
        className={selectClass}
      >
        <option value="">{slot.ref ? "A value of its own" : choices.length ? "Make it a token…" : "No tokens of this type"}</option>
        {bySet.map((g) => (
          <optgroup key={g.set.id} label={g.set.name}>
            {g.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        ))}
      </select>
      <span data-slot-text className="min-w-0 truncate text-2xs text-text-tertiary">{text ?? "—"}</span>
      {onRemove && <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="rounded p-1 text-text-tertiary hover:bg-danger/10 hover:text-danger"><X size={10} /></button>}
    </div>
  );
}

// The editor under a composition's row.
export default function CompositionEditor({ composition, onChange }: { composition: Composition; onChange: (patch: Partial<Composition>) => void }) {
  const data = useComposeData();
  const sets = useDesignSystemStore((s) => s.sets);
  const custom = composition.kind === "custom";
  const setSlot = (name: string, patch: Partial<Slot> & { ref?: string | undefined }) =>
    onChange({ slots: composition.slots.map((s) => (s.name === name ? Object.fromEntries(Object.entries({ ...s, ...patch }).filter(([, v]) => v !== undefined)) as unknown as Slot : s)) });
  const add = (type: TokenType) => onChange({ slots: [...composition.slots, { name: newSlotName(composition.slots), type, value: type === "color" ? "#000000" : type === "number" ? "0" : "text", ...(type === "number" ? { unit: "px" as Unit } : {}) }] });

  return (
    <div data-composition-editor className="flex flex-col gap-2 border-t border-surface-border bg-surface-subtle/50 px-4 py-3 pl-11">
      {composition.kind !== "custom" && (
        <div className="flex items-center gap-4 pb-1">
          <Sample composition={composition} />
          {composition.kind === "shadow" && (
            <label className="flex items-center gap-1.5 text-2xs text-text-tertiary">
              <input type="checkbox" aria-label={`Inset ${composition.name}`} checked={!!composition.inset} onChange={(e) => onChange({ inset: e.target.checked })} className="h-3 w-3 accent-[var(--cobalt)]" /> Inset
            </label>
          )}
        </div>
      )}
      {composition.slots.map((slot) => (
        <SlotRow
          key={slot.name}
          composition={composition}
          slot={slot}
          data={data}
          sets={sets}
          onSlot={(patch) => setSlot(slot.name, patch)}
          onRemove={custom ? () => onChange({ slots: composition.slots.filter((s) => s.name !== slot.name) }) : undefined}
          onRename={custom ? (name) => { if (!name || composition.slots.some((s) => s.name === name && s !== slot)) return false; setSlot(slot.name, { name }); return true; } : undefined}
        />
      ))}
      {custom && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-2xs text-text-tertiary">Add a part</span>
          {(["color", "number", "string"] as TokenType[]).map((t) => (
            <button key={t} type="button" aria-label={`Add a ${t} part to ${composition.name}`} onClick={() => add(t)} className="flex items-center gap-1 rounded border border-line px-2 min-h-11 py-0.5 text-2xs text-text-secondary hover:border-accent/40 hover:text-text-primary"><Plus size={9} /> {t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      )}
      {composition.slots.length === 0 && !custom && <p className="text-2xs text-text-tertiary">No parts.</p>}
    </div>
  );
}
