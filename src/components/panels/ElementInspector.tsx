"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, MousePointer2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { gitBlobSha } from "@/lib/github";
import { BREAKPOINT_WIDTH, GROUPS, MODIFIERS, SECTIONS, readGroup, type ClassGroup } from "@/lib/edit/classes";
import { analyze, deleteElement, duplicateElement, moveElement, setGroup, setSlotClasses, setText, slotText, type EditResult, type ElementInfo } from "@/lib/edit/element";
import { HOST_TAGS, changeTag, insertElement, unwrapElement, wrapElement, type InsertPosition } from "@/lib/edit/insert";
import { SNIPPETS, WRAPPERS, componentSnippet } from "@/lib/edit/snippets";
import type { LibraryComponent } from "@/lib/preview/library";
import { activeTheme } from "@/lib/edit/tokens";
import { useTokenIndex } from "@/components/stage/preview-core";
import { readerFor } from "@/components/stage/reader";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { useEditStore, currentText } from "@/store/edit";
import type { GitConnection } from "@/store/git";
import { useLibraryStore, type LibrarySource } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import { ChoiceField, ColorField, RawHint, fieldStatus } from "./TokenField";

// Shown for every element; anything else that is set on the element appears as well, and the rest is under "Add".
const SHOWN: Record<string, string[]> = {
  layout: ["display", "direction", "gap", "items", "justify"],
  spacing: ["p", "px", "py", "m"],
  size: ["w", "h"],
  type: ["text-size", "font-weight", "text-color"],
  fill: ["bg", "border-width", "border-color", "radius", "shadow"],
};

const starting = (g: ClassGroup): string => {
  if (g.control === "color") return "transparent";
  if (/^(p|m)[xytrbl]?$|^gap/.test(g.id)) return g.id.startsWith("m") ? "0" : "4";
  if (g.id === "w" || g.id === "h") return "full";
  return g.options?.find((o) => o !== "none") ?? g.options?.[0] ?? "";
};

// `status` marks a value that is one of the repository's tokens, or one that is written out where a token could be.
function Field({ label, children, onRemove, status }: { label: string; children: React.ReactNode; onRemove?: () => void; status?: "token" | "flag" | null }) {
  return (
    <div className="grid grid-cols-[84px_1fr_16px] items-center gap-1.5">
      <span className="flex min-w-0 items-center gap-1" title={status === "token" ? `${label}: a token of the repository` : status === "flag" ? `${label}: not a token` : label}>
        <span className="truncate text-xs text-text-secondary">{label}</span>
        {status && <span data-token-status={status} className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", status === "token" ? "bg-accent" : "bg-amber-500")} />}
      </span>
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
  // The repository's tokens: what the controls offer, and what decides whether `text-display` is a size or a color.
  const index = useTokenIndex(source.repo);
  const names = index.names;
  const dark = usePreviewStore((s) => s.dark);
  const theme = activeTheme(index, dark);

  const [info, setInfo] = useState<ElementInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which state the controls edit: the plain classes, or the ones that apply on hover, in dark mode, at md and up.
  const [modifier, setModifier] = useState("");
  const [position, setPosition] = useState<InsertPosition>("last-child");
  const library = useLibraryStore((s) => s.components);
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
    const set = GROUPS.filter((g) => g.section === section && readGroup(classes, g, modifier, names) !== null).map((g) => g.id);
    const shown = [...new Set([...SHOWN[section], ...set])];
    const ordered = GROUPS.filter((g) => g.section === section && shown.includes(g.id));
    return { ordered, rest: GROUPS.filter((g) => g.section === section && !shown.includes(g.id)) };
  };
  const change = (g: ClassGroup, value: string | null) => run((code, start) => setGroup(selection.path, code, start, g.id, value, values, modifier, names));
  // Values of the state being edited that are written out where the repository has a token, or the scale a step.
  const flagged = GROUPS.filter((g) => fieldStatus(g, readGroup(classes, g, modifier, names), index) === "flag").length;
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

      <div className="border-t border-surface-border px-3 py-2.5">
        <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-tertiary">Structure</p>
        <div className="flex flex-col gap-1.5">
          <Field label="Add">
            <div className="grid grid-cols-2 gap-1.5">
              <select className="input-sm w-full" aria-label="Insert position" value={position} onChange={(e) => setPosition(e.target.value as InsertPosition)}>
                <option value="last-child">Inside, last</option>
                <option value="first-child">Inside, first</option>
                <option value="before" disabled={!info.canDelete}>Before</option>
                <option value="after" disabled={!info.canDelete}>After</option>
              </select>
              <select
                className="input-sm w-full"
                aria-label="Insert element"
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  if (id.startsWith("lib:")) {
                    const component = library.find((c) => c.id === id.slice(4));
                    if (!component) return;
                    const { jsx, imp } = componentSnippet(component);
                    void run((c, s) => insertElement(selection.path, c, s, position, jsx, imp));
                  } else {
                    const snippet = SNIPPETS.find((x) => x.id === id);
                    if (snippet) void run((c, s) => insertElement(selection.path, c, s, position, snippet.jsx));
                  }
                }}
              >
                <option value="">Element…</option>
                <optgroup label="HTML">{SNIPPETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>
                {library.length > 0 && <optgroup label="Components">{library.map((c) => <option key={c.id} value={`lib:${c.id}`}>{c.name}</option>)}</optgroup>}
              </select>
            </div>
          </Field>
          <Field label="Wrap in">
            <select
              className="input-sm w-full"
              aria-label="Wrap in"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                if (id.startsWith("lib:")) {
                  const component = library.find((c) => c.id === id.slice(4));
                  if (!component) return;
                  const { imp } = componentSnippet(component);
                  void run((c, s) => wrapElement(selection.path, c, s, component.name, null, imp));
                } else {
                  const wrapper = WRAPPERS.find((x) => x.id === id);
                  if (wrapper) void run((c, s) => wrapElement(selection.path, c, s, wrapper.tag, wrapper.classes));
                }
              }}
            >
              <option value="">Wrapper…</option>
              <optgroup label="HTML">{WRAPPERS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>
              {library.length > 0 && <optgroup label="Components">{library.map((c) => <option key={c.id} value={`lib:${c.id}`}>{c.name}</option>)}</optgroup>}
            </select>
          </Field>
          <div className="grid grid-cols-[84px_1fr] items-center gap-1.5">
            <span className="text-xs text-text-secondary">Tag</span>
            <div className="flex items-center gap-1.5">
              {/^[a-z]/.test(info.tag) ? (
                <select className="input-sm min-w-0 flex-1" aria-label="Tag" value={info.tag} onChange={(e) => { const tag = e.target.value; void run((c, s) => changeTag(selection.path, c, s, tag)); }}>
                  {!HOST_TAGS.includes(info.tag) && <option value={info.tag}>{info.tag}</option>}
                  {HOST_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : <span className="min-w-0 flex-1 truncate font-mono text-2xs text-text-tertiary">{info.tag}</span>}
              <button
                onClick={() => void run((c, s) => unwrapElement(selection.path, c, s))}
                disabled={!info.canUnwrap}
                className="h-7 flex-shrink-0 rounded-md border border-surface-border px-2 text-2xs text-text-secondary hover:bg-surface-subtle disabled:opacity-40"
                aria-label="Unwrap element"
                title="Take this element's wrapper off, keeping the element inside"
              >
                Unwrap
              </button>
            </div>
          </div>
        </div>
      </div>

      {editable && (
        <div className="border-t border-surface-border px-3 py-2.5">
          <Field label="State">
            <select className="input-sm w-full" aria-label="State" value={modifier} onChange={(e) => chooseState(e.target.value)}>
              {MODIFIERS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          {state?.hint && <p className="mt-1.5 text-2xs leading-relaxed text-text-tertiary">{state.hint}</p>}
          {flagged > 0 && (
            <p className="mt-1.5 text-2xs leading-relaxed text-amber-500" role="status" data-flagged={flagged}>
              {flagged === 1 ? "1 value here is not a token." : `${flagged} values here are not tokens.`} They are marked below.
            </p>
          )}
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
                    const value = readGroup(classes, g, modifier, names);
                    // Under a state, what the plain class gives is what applies until the state sets its own.
                    const inherited = modifier ? readGroup(classes, g, "", names) : null;
                    const Control = g.control === "color" ? ColorField : ChoiceField;
                    return (
                      <div key={g.id} className="flex flex-col gap-1">
                        <Field label={g.label} status={fieldStatus(g, value, index)} onRemove={value !== null ? () => change(g, null) : undefined}>
                          <Control group={g} label={g.label} value={value} inherited={inherited} index={index} theme={theme} onChange={(v) => change(g, v)} />
                        </Field>
                        <RawHint group={g} label={g.label} value={value} index={index} onUse={(v) => change(g, v)} />
                      </div>
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
