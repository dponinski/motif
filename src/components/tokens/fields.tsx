"use client";

import { useRef, useState } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Row } from "./rows";

// The small editable things a token row is made of.

// A name that becomes a field when pressed. A token the repository names can't be renamed here: Sync matches it by that name.
export function InlineName({ row, taken, onRename, className }: { row: Row; taken: string[]; onRename: (name: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.name);
  const [bad, setBad] = useState(false);

  if (row.linked) {
    return (
      <span className={cn("flex min-w-0 items-center gap-1 truncate", className)} title={`Named by the repository (${row.name}). Rename it there.`}>
        <span className="truncate">{row.name}</span>
        {row.readonly && <Lock size={9} className="flex-shrink-0 text-text-tertiary" aria-label="Can't be edited here" />}
      </span>
    );
  }
  if (!editing) {
    return (
      <button type="button" onClick={() => { setText(row.name); setBad(false); setEditing(true); }} title="Rename" aria-label={`Rename ${row.name}`} className={cn("min-w-0 truncate rounded px-0.5 text-left hover:bg-surface-overlay", className)}>
        {row.name}
      </button>
    );
  }
  const commit = () => {
    const name = text.trim();
    if (name && name !== row.name && taken.includes(name)) { setBad(true); return false; }
    if (name && name !== row.name) onRename(name);
    setEditing(false);
    return true;
  };
  return (
    <input
      autoFocus
      aria-label={`Name of ${row.name}`}
      value={text}
      onChange={(e) => { setText(e.target.value); setBad(false); }}
      onBlur={() => { if (!commit()) setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
      }}
      title={bad ? "There is a token with this name already" : undefined}
      className={cn("min-w-0 rounded border bg-surface-base px-1 outline-none", bad ? "border-danger" : "border-accent", className)}
    />
  );
}

// A text field that keeps what is typed until Enter or leaving, and then gives it to `onCommit`, which says whether it was taken.
export function CommitInput({ value, onCommit, label, className, mono, frame, invalidHint }: { value: string; onCommit: (text: string) => boolean; label: string; className?: string; mono?: boolean; frame?: boolean; invalidHint?: string }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  // When the value changes from outside (another edit, an undo), what is shown follows it.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setText(value); setBad(false); }
  // Enter and Escape leave the field themselves; the leaving that follows must not take the text a second time.
  const leaving = useRef(false);
  const commit = (): boolean => {
    if (text.trim() === value) { setBad(false); return true; }
    const ok = onCommit(text);
    setBad(!ok);
    return ok;
  };
  return (
    <input
      aria-label={label}
      value={text}
      onChange={(e) => { setText(e.target.value); setBad(false); }}
      onBlur={() => { if (leaving.current) { leaving.current = false; return; } commit(); }}
      onKeyDown={(e) => {
        // Enter takes what was typed and leaves the field; if it isn't taken the field stays, marked.
        if (e.key === "Enter") { e.preventDefault(); if (commit()) { leaving.current = true; (e.target as HTMLInputElement).blur(); } }
        if (e.key === "Escape") { e.stopPropagation(); leaving.current = true; setText(value); setBad(false); (e.target as HTMLInputElement).blur(); }
      }}
      title={bad ? invalidHint : undefined}
      spellCheck={false}
      className={cn("min-w-0 rounded border bg-transparent px-1.5 py-0.5 text-xs text-text-primary outline-none transition-colors hover:border-surface-border focus:border-accent", frame ? "border-surface-border" : "border-transparent", mono && "font-mono", className, bad && "border-danger hover:border-danger focus:border-danger")}
    />
  );
}

// The row of fields that adds a token: Enter adds it and the row stays for the next one, with the name already suggested.
export interface AddField { key: string; label: string; placeholder: string; width?: string; mono?: boolean; validate?: (v: string) => boolean; options?: { value: string; label: string }[] }

export function AddRow({ fields, initial, focus, onAdd, onClose, detect, onField }: {
  fields: AddField[];
  initial: Record<string, string>;
  // The field the pointer starts in, and returns to after each add.
  focus: string;
  // Adds the token; what it returns is what the fields hold for the next one.
  onAdd: (values: Record<string, string>) => Record<string, string> | void;
  onClose: () => void;
  // Lets what was typed in one field belong in another (a color pasted where the name goes).
  detect?: (key: string, value: string, values: Record<string, string>) => Record<string, string> | null;
  // Told when a field changes (the type of what is being added decides which fields there are).
  onField?: (key: string, value: string) => void;
}) {
  const [values, setValues] = useState(initial);
  const [bad, setBad] = useState<string | null>(null);
  const refs = new Map<string, HTMLInputElement | null>();

  const set = (key: string, value: string) => {
    const next = { ...values, [key]: value };
    const moved = detect?.(key, value, next);
    setValues(moved ? { ...next, ...moved } : next);
    setBad(null);
    onField?.(key, value);
  };
  const submit = () => {
    const wrong = fields.find((f) => (f.validate ? !f.validate(values[f.key] ?? "") : false));
    if (wrong) { setBad(wrong.key); refs.get(wrong.key)?.focus(); return; }
    const next = onAdd(values);
    if (next) setValues(next);
    requestAnimationFrame(() => refs.get(focus)?.focus());
  };

  return (
    <div className="flex items-center gap-2 border-y border-accent/30 bg-accent/5 px-4 py-1.5" data-add-row>
      {fields.map((f) => f.options ? (
        <select
          key={f.key}
          aria-label={f.label}
          value={values[f.key] ?? ""}
          onChange={(e) => set(f.key, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
          className={cn("rounded border border-surface-border bg-surface-base px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent", f.width ?? "w-28")}
        >
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          key={f.key}
          ref={(el) => { refs.set(f.key, el); }}
          autoFocus={f.key === focus}
          aria-label={f.label}
          placeholder={f.placeholder}
          value={values[f.key] ?? ""}
          spellCheck={false}
          onChange={(e) => set(f.key, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            if (e.key === "Escape") { e.stopPropagation(); onClose(); }
          }}
          className={cn("rounded border bg-surface-base px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent", f.width ?? "w-40", f.mono && "font-mono", bad === f.key ? "border-danger" : "border-surface-border")}
        />
      ))}
      <button type="button" onClick={submit} className="rounded bg-blaze px-2 min-h-11 py-1 text-xs font-medium text-on-blaze hover:bg-blaze/90">Add</button>
      <button type="button" onClick={onClose} className="rounded px-2 min-h-11 py-1 text-xs text-text-tertiary hover:bg-surface-subtle hover:text-text-primary">Done</button>
      <span className="text-2xs text-text-tertiary">Enter adds it and stays for the next</span>
    </div>
  );
}
