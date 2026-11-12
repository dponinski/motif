"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, MousePointer2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { gitBlobSha } from "@/lib/github";
import { BREAKPOINT_WIDTH, GROUPS, MODIFIERS, SECTIONS, readGroup, type ClassGroup } from "@/lib/edit/classes";
import { analyze, deleteElement, duplicateElement, moveElement, setGroup, setSlotClasses, setText, slotText, type EditResult, type ElementInfo } from "@/lib/edit/element";
import type { LibraryComponent } from "@/lib/preview/library";
import { cssName } from "@/lib/token-sync/doc";
import { readerFor } from "@/components/stage/reader";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { useDesignSystemStore } from "@/store/design-system";
import { useEditStore, currentText } from "@/store/edit";
import type { GitConnection } from "@/store/git";
import { useGitStore } from "@/store/git";
import type { LibrarySource } from "@/store/library";
import { usePreviewStore } from "@/store/preview";

// Shown for every element; anything else that is set on the element appears as well, and the rest is under "Add".
const SHOWN: Record<string, string[]> = {
  layout: ["display", "direction", "gap", "items", "justify"],
  spacing: ["p", "px", "py", "m"],
  size: ["w", "h"],
  type: ["text-size", "font-weight", "text-color"],
  fill: ["bg", "border-width", "border-color", "radius", "shadow"],
};

const PALETTE = ["white", "black", "transparent", "current"];

const starting = (g: ClassGroup): string => {
  if (g.control === "color") return "transparent";
  if (/^(p|m)[xytrbl]?$|^gap/.test(g.id)) return g.id.startsWith("m") ? "0" : "4";
  if (g.id === "w" || g.id === "h") return "full";
  return g.options?.find((o) => o !== "none") ?? g.options?.[0] ?? "";
};

function Field({ label, children, onRemove }: { label: string; children: React.ReactNode; onRemove?: () => void }) {
  return (
    <div className="grid grid-cols-[84px_1fr_16px] items-center gap-1.5">
      <span className="truncate text-xs text-text-secondary" title={label}>{label}</span>
      {children}
      {onRemove ? (
        <button onClick={onRemove} className="rounded text-text-tertiary hover:text-text-primary" aria-label={`Remove ${label}`} title="Remove">
          <X size={11} />
        </button>
      ) : <span />}
    </div>
  );
}

// Text that is committed when you leave the field or press Enter, so half-typed class names are never written.
function Commit({ value, onCommit, label, list, multiline, placeholder }: { value: string; onCommit: (value: string) => void; label: string; list?: string; multiline?: boolean; placeholder?: string }) {
  const [text, setTextValue] = useState(value);
  // What was last sent, so Enter followed by the blur it causes is one change.
  const sent = useRef(value);
  useEffect(() => { setTextValue(value); sent.current = value; }, [value]);
  const commit = () => {
    if (text === sent.current) return;
    sent.current = text;
    onCommit(text);
  };
  if (multiline) {
    return (
      <textarea
        className="input-sm min-h-[44px] w-full resize-y font-mono text-2xs leading-snug"
        aria-label={label}
        value={text}
        onChange={(e) => setTextValue(e.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <input
      className="input-sm w-full"
      aria-label={label}
      placeholder={placeholder}
      list={list}
      value={text}
      onChange={(e) => setTextValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

export default function ElementInspector({ component, source, connection }: { component: LibraryComponent; source: LibrarySource; connection: GitConnection }) {
  const host = useGitHost(connection);
  const reader = useMemo(() => readerFor(source, host), [source, host]);
  const selection = useEditStore((s) => s.selection);
  const revision = useEditStore((s) => s.revision);
  const overrides = usePreviewStore((s) => s.values[component.id]);
  const link = useGitStore((s) => s.tokenLink);
  const colors = useDesignSystemStore((s) => s.colors);

  const [info, setInfo] = useState<ElementInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which state the controls edit: the plain classes, or the ones that apply on hover, in dark mode, at md and up.
  const [modifier, setModifier] = useState("");
  const { setDark, setWidth } = usePreviewStore();
  const chooseState = (id: string) => {
    // The preview is put where the state can be seen: dark theme, or a width the breakpoint applies at.
    if (id === "dark:") setDark(true);
    else if (modifier === "dark:") setDark(false);
    if (BREAKPOINT_WIDTH[id]) setWidth(BREAKPOINT_WIDTH[id]);
    else if (BREAKPOINT_WIDTH[modifier]) setWidth(null);
    setModifier(id);
  };

  // What variant choices are showing, so the classes of the variant on screen are the ones edited.
  const values = useMemo(
    () => Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => ["string", "boolean", "number"].includes(typeof v)).map(([k, v]) => [k, String(v)])),
    [overrides]
  );

  const tokenNames = useMemo(() => {
    const names = link ? colors.filter((c) => c.setId === link.setId).map((c) => c.repoName ?? cssName(c.name)) : [];
    return [...new Set([...names, ...PALETTE])];
  }, [link, colors]);

  const read = async (path: string): Promise<string | null> => currentText(useEditStore.getState(), path) ?? (await reader.readText(path, source.branch));

  useEffect(() => {
    let stale = false;
    setError(null);
    if (!selection) { setInfo(null); return; }
    (async () => {
      try {
        const code = await read(selection.path);
        const next = code === null ? null : await analyze(selection.path, code, selection.start, values);
        if (!stale) setInfo(next);
      } catch (err) {
        if (!stale) { setInfo(null); setError(errorMessage(err)); }
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, revision, values, reader]);

  const run = async (op: (code: string, start: number) => Promise<EditResult | null>) => {
    if (!selection) return;
    setError(null);
    try {
      const code = await read(selection.path);
      if (code === null) throw new Error(`Couldn't read ${selection.path}`);
      const result = await op(code, selection.start);
      if (!result || result.code === code) return;
      const store = useEditStore.getState();
      const base = store.bases[selection.path] ? undefined : { text: code, sha: await gitBlobSha(code) };
      store.change(selection.path, result.code, result.selection === null ? null : { path: selection.path, start: result.selection }, result.summary, base);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!selection || !info) {
    return (
      <div className="border-b border-surface-border px-3 py-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-text-tertiary"><MousePointer2 size={11} /> Edit</p>
        <p className="text-xs leading-relaxed text-text-tertiary">
          {selection ? "That element is no longer in the file." : "Click an element in the preview to change its layout, spacing, color and text. Changes are made to the component's source and sent as a pull request."}
        </p>
        {error && <p className="mt-2 break-words text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  const editable = info.className !== "dynamic";
  const classes = info.classes;
  const groupsFor = (section: string) => {
    const set = GROUPS.filter((g) => g.section === section && readGroup(classes, g, modifier) !== null).map((g) => g.id);
    const shown = [...new Set([...SHOWN[section], ...set])];
    const ordered = GROUPS.filter((g) => g.section === section && shown.includes(g.id));
    return { ordered, rest: GROUPS.filter((g) => g.section === section && !shown.includes(g.id)) };
  };
  const change = (g: ClassGroup, value: string | null) => run((code, start) => setGroup(selection.path, code, start, g.id, value, values, modifier));
  const state = MODIFIERS.find((m) => m.id === modifier);
  const line = source ? `${selection.path}` : "";

  return (
    <div className="border-b border-surface-border">
      <div className="flex items-center gap-1 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">&lt;{info.tag}&gt;</p>
          <p className="truncate font-mono text-2xs text-text-tertiary" title={line}>{line}</p>
        </div>
        {([
          ["Move up", ArrowUp, info.canMoveUp, () => run((c, s) => moveElement(selection.path, c, s, -1))],
          ["Move down", ArrowDown, info.canMoveDown, () => run((c, s) => moveElement(selection.path, c, s, 1))],
          ["Duplicate element", Copy, info.canDelete, () => run((c, s) => duplicateElement(selection.path, c, s))],
          ["Delete element", Trash2, info.canDelete, () => run((c, s) => deleteElement(selection.path, c, s))],
        ] as const).map(([label, Icon, enabled, action]) => (
          <button key={label} onClick={action} disabled={!enabled} aria-label={label} title={label} className="tool-btn !h-7 !w-7 disabled:opacity-30">
            <Icon size={13} />
          </button>
        ))}
      </div>

      {error && <p className="mx-3 mb-2 break-words rounded border border-red-400/30 bg-red-400/10 px-2 py-1.5 text-2xs text-red-400">{error}</p>}

      {editable && (
        <div className="border-t border-surface-border px-3 py-2.5">
          <Field label="State">
            <select className="input-sm w-full" aria-label="State" value={modifier} onChange={(e) => chooseState(e.target.value)}>
              {MODIFIERS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          {state?.hint && <p className="mt-1.5 text-2xs leading-relaxed text-text-tertiary">{state.hint}</p>}
        </div>
      )}

      {info.text && (
        <div className="px-3 pb-2.5">
          <Field label="Text"><Commit label="Text" value={info.text.value} onCommit={(v) => run((c, s) => setText(selection.path, c, s, v))} /></Field>
        </div>
      )}

      {!editable ? (
        <p className="px-3 pb-3 text-xs leading-relaxed text-text-tertiary">{info.dynamicReason}</p>
      ) : (
        <>
          {SECTIONS.map((section) => {
            const { ordered, rest } = groupsFor(section.id);
            return (
              <div key={section.id} className="border-t border-surface-border px-3 py-2.5">
                <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-tertiary">{section.label}</p>
                <div className="flex flex-col gap-1.5">
                  {ordered.map((g) => {
                    const value = readGroup(classes, g, modifier);
                    // Under a state, what the plain class gives is what applies until the state sets its own.
                    const inherited = modifier ? readGroup(classes, g, "") : null;
                    return (
                      <Field key={g.id} label={g.label} onRemove={value !== null ? () => change(g, null) : undefined}>
                        {g.control === "color" ? (
                          <>
                            <Commit label={g.label} list={`motif-colors-${g.id}`} placeholder={inherited ? `inherits ${inherited}` : undefined} value={value ?? ""} onCommit={(v) => change(g, v.trim() || null)} />
                            <datalist id={`motif-colors-${g.id}`}>{tokenNames.map((n) => <option key={n} value={n} />)}</datalist>
                          </>
                        ) : (
                          <select className="input-sm w-full" aria-label={g.label} value={value ?? ""} onChange={(e) => change(g, e.target.value || null)}>
                            <option value="">{inherited ? `inherits ${inherited === "DEFAULT" ? "default" : inherited}` : "—"}</option>
                            {value !== null && !g.options!.includes(value) && <option value={value}>{value}</option>}
                            {g.options!.map((o) => <option key={o} value={o}>{o === "DEFAULT" ? "default" : o}</option>)}
                          </select>
                        )}
                      </Field>
                    );
                  })}
                  {rest.length > 0 && (
                    <select
                      className="input-sm w-full text-text-tertiary"
                      aria-label={`Add ${section.label.toLowerCase()} property`}
                      value=""
                      onChange={(e) => { const g = GROUPS.find((x) => x.id === e.target.value); if (g) change(g, starting(g)); }}
                    >
                      <option value="">Add…</option>
                      {rest.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                  )}
                </div>
              </div>
            );
          })}

          <div className="border-t border-surface-border px-3 py-2.5">
            <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-tertiary">Classes</p>
            {info.slots.length === 0 ? (
              <p className="text-xs text-text-tertiary">No classes yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {info.slots.map((slot) => (
                  <div key={slot.id} className={cn("flex flex-col gap-1", !slot.active && "opacity-50")}>
                    <span className="text-2xs text-text-tertiary">{slot.label}{slot.active ? "" : " (not shown)"}</span>
                    <Commit
                      multiline
                      label={`Classes: ${slot.label}`}
                      value={slotText(slot)}
                      onCommit={(v) => run((c, s) => setSlotClasses(selection.path, c, s, slot.id, v, values))}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
