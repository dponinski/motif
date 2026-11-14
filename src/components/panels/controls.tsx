"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlignCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignHorizontalSpaceAround, AlignHorizontalSpaceBetween,
  AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, StretchVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Choices a designer makes by looking at them: a row of small icon buttons instead of a list of words. Each button is named
// "<Group>: <value>" and the row is the group, so it reads the same to a screen reader (and to the browser suites) as the
// list it replaces. Pressing the one that is on takes it off.

export interface IconOption { value: string; label: string; Icon: LucideIcon }

// The groups that have icons, and the icon of each of their values. A group's value that isn't here (`items-baseline`, a text
// alignment of `start`) is still shown, by the list the control falls back to.
export const ICONS: Record<string, IconOption[]> = {
  direction: [
    { value: "row", label: "Row", Icon: ArrowRight },
    { value: "col", label: "Column", Icon: ArrowDown },
    { value: "row-reverse", label: "Row, reversed", Icon: ArrowLeft },
    { value: "col-reverse", label: "Column, reversed", Icon: ArrowUp },
  ],
  items: [
    { value: "start", label: "Align start", Icon: AlignVerticalJustifyStart },
    { value: "center", label: "Align center", Icon: AlignVerticalJustifyCenter },
    { value: "end", label: "Align end", Icon: AlignVerticalJustifyEnd },
    { value: "stretch", label: "Stretch", Icon: StretchVertical },
  ],
  justify: [
    { value: "start", label: "Pack at the start", Icon: AlignHorizontalJustifyStart },
    { value: "center", label: "Pack in the center", Icon: AlignHorizontalJustifyCenter },
    { value: "end", label: "Pack at the end", Icon: AlignHorizontalJustifyEnd },
    { value: "between", label: "Space between", Icon: AlignHorizontalSpaceBetween },
    { value: "around", label: "Space around", Icon: AlignHorizontalSpaceAround },
  ],
  "text-align": [
    { value: "left", label: "Left", Icon: AlignLeft },
    { value: "center", label: "Center", Icon: AlignCenter },
    { value: "right", label: "Right", Icon: AlignRight },
    { value: "justify", label: "Justify", Icon: AlignJustify },
  ],
};

// Whether a group's current value can be shown by its icons (no value is nothing to show, and can).
export const hasIcons = (groupId: string, value: string | null): boolean => !!ICONS[groupId] && (value === null || ICONS[groupId].some((o) => o.value === value));

export function IconChoice({
  groupId, label, value, inherited, onChange,
}: {
  groupId: string;
  label: string;
  value: string | null;
  // What applies until this state sets its own: shown lightly.
  inherited: string | null;
  onChange: (value: string | null) => void;
}) {
  const options = ICONS[groupId];
  return (
    <div role="group" aria-label={label} data-value={value ?? ""} className="flex w-full items-center gap-0.5 rounded-md border border-surface-border bg-surface-subtle p-0.5">
      {options.map(({ value: v, label: text, Icon }) => {
        const on = value === v;
        const shown = value === null && inherited === v;
        return (
          <button
            key={v}
            type="button"
            aria-label={`${label}: ${v}`}
            aria-pressed={on}
            title={`${text}${shown ? " (inherited)" : ""}`}
            onClick={() => onChange(on ? null : v)}
            className={cn(
              "flex h-6 flex-1 items-center justify-center rounded transition-colors",
              on ? "bg-surface-raised text-accent shadow-sm" : shown ? "text-text-secondary" : "text-text-tertiary hover:text-text-primary"
            )}
          >
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
}

// Words for the size of an element, set by one press: as small as its content ("Hug") or as large as its container ("Fill").
// The list beside it has every other size.
export function SizeShortcuts({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <div role="group" aria-label={`${label} mode`} className="flex items-center gap-0.5 rounded-md border border-surface-border bg-surface-subtle p-0.5">
      {([["fit", "Hug", "As small as what is inside it"], ["full", "Fill", "As large as the space it is in"]] as const).map(([v, text, hint]) => (
        <button
          key={v}
          type="button"
          aria-label={`${label}: ${text}`}
          aria-pressed={value === v}
          title={hint}
          onClick={() => onChange(value === v ? null : v)}
          className={cn("h-6 flex-1 rounded px-2 text-2xs transition-colors", value === v ? "bg-surface-raised text-accent shadow-sm" : "text-text-tertiary hover:text-text-primary")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
