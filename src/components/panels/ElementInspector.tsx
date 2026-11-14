"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, MousePointer2, Trash2, X } from "lucide-react";
import { describeTag } from "@/lib/edit/names";
import ElementIcon from "./ElementIcon";
import { IconChoice, SizeShortcuts, hasIcons } from "./controls";
import { SCOPE_IDS, STATE_IDS, useElementEdit } from "./useElementEdit";
import { cn } from "@/lib/utils";
import { BREAKPOINT_WIDTH, MODIFIERS, SECTIONS, type ClassGroup } from "@/lib/edit/classes";
import { deleteElement, duplicateElement, moveElement, setSlotClasses, setText, slotText } from "@/lib/edit/element";
import { HOST_TAGS, changeTag, insertElement, unwrapElement, wrapElement, type InsertPosition } from "@/lib/edit/insert";
import { SNIPPETS, WRAPPERS, componentSnippet, plain } from "@/lib/edit/snippets";
import { type CssGroup } from "@/lib/edit/css-groups";
import type { LibraryComponent } from "@/lib/preview/library";
import type { GitConnection } from "@/store/git";
import { useLibraryStore, type LibrarySource } from "@/store/library";
import { ChoiceField, ColorField, RawHint, fieldStatus } from "./TokenField";

// The spacing controls, short: what each is for, since the section already says it is spacing.
const SPACING_CAPTION: Record<string, string> = { p: "All sides", px: "Horizontal", py: "Vertical", m: "Margin" };

const starting = (g: ClassGroup): string => {
  // A stylesheet's groups say what they start as.
  if ("start" in g) return (g as CssGroup).start;
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

export default function ElementInspector({ component, source, connection, part = "design" }: { component: LibraryComponent; source: LibrarySource; connection: GitConnection; part?: "design" | "code" }) {
  const { selection, info, sheet, error, modifier, stateValue, scopeValue, chooseStateOnly, chooseScope, values, index, theme, run, derived } = useElementEdit(component, source, connection);
  const [position, setPosition] = useState<InsertPosition>("last-child");
  const library = useLibraryStore((s) => s.components);

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

  const { editable, classes: _classes, css, groups, view, valueOf, groupsFor, change } = derived!;
  // Values of the state being edited that are written out where the repository has a token, or the scale a step.
  const flagged = groups.filter((g) => fieldStatus(g, valueOf(g, modifier), index) === "flag").length;
  const state = MODIFIERS.find((m) => m.id === modifier);
  const line = source ? `${selection.path}` : "";
  const { kind } = describeTag(info.tag);
  const row = (g: ClassGroup) => {
    const value = valueOf(g, modifier);
    // Under a state, what the plain class gives is what applies until the state sets its own.
    const inherited = modifier ? valueOf(g, "") : null;
    const control =
      g.control === "color" ? <ColorField group={g} label={g.label} value={value} inherited={inherited} index={index} theme={theme} onChange={(v) => change(g, v)} />
      : hasIcons(g.id, value) ? <IconChoice groupId={g.id} label={g.label} value={value} inherited={inherited} onChange={(v) => change(g, v)} />
      : <ChoiceField group={g} label={g.label} value={value} inherited={inherited} index={index} theme={theme} scaleLabel={css ? "Values" : undefined} onChange={(v) => change(g, v)} />;
    return { value, inherited, control };
  };

  if (part === "code") {
    return (
      <div>
        <div className="px-3 py-2.5">
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
                      if (snippet) void run((c, s) => insertElement(selection.path, c, s, position, css ? plain(snippet.jsx) : snippet.jsx));
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
                    if (wrapper) void run((c, s) => wrapElement(selection.path, c, s, wrapper.tag, css ? null : wrapper.classes));
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

        {error && <p className="mx-3 mb-2 break-words rounded border border-red-400/30 bg-red-400/10 px-2 py-1.5 text-2xs text-red-400">{error}</p>}
        {editable && (
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
        )}
        {!editable && <p className="px-3 pb-3 text-xs leading-relaxed text-text-tertiary">{info.dynamicReason}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1 px-3 py-2.5" data-element-row>
        <ElementIcon name={describeTag(info.tag).icon} size={14} className="flex-shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1.5 truncate text-sm font-medium text-text-primary">
            {kind}
            <span className="font-mono text-2xs font-normal text-text-tertiary">&lt;{info.tag}&gt;</span>
          </p>
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
      {sheet && editable && (
        <p className="mx-3 mb-2 text-2xs leading-relaxed text-text-tertiary" data-styles-in>
          Styles in <span className="font-mono">{sheet.path.slice(sheet.path.lastIndexOf("/") + 1)}</span>
          {view?.cls ? <> as <span className="font-mono">.{view.cls}</span></> : " (this element gets a class of its own when you style it)"}
          {view && view.sharedWith > 0 && <span className="text-amber-500"> · also used by {view.sharedWith} other element{view.sharedWith === 1 ? "" : "s"}, which change with it</span>}
        </p>
      )}

      {editable && (
        <div className="border-t border-surface-border px-3 py-2.5" data-editing-for>
          <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-tertiary">Editing the style for</p>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex flex-col gap-0.5 text-2xs text-text-tertiary">
              State
              <select className="input-sm w-full text-xs text-text-primary" aria-label="State" value={stateValue} onChange={(e) => chooseStateOnly(e.target.value)}>
                {MODIFIERS.filter((m) => m.id === "" || STATE_IDS.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-2xs text-text-tertiary">
              Applies to
              <select className="input-sm w-full text-xs text-text-primary" aria-label="Applies to" value={scopeValue} onChange={(e) => chooseScope(e.target.value)}>
                {MODIFIERS.filter((m) => m.id === "" || SCOPE_IDS.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.id === "" ? "Always" : m.label}</option>)}
              </select>
            </label>
          </div>
          {state?.hint && <p className="mt-1.5 text-2xs leading-relaxed text-text-tertiary">{state.hint}{BREAKPOINT_WIDTH[modifier] ? ` The frame is set to ${BREAKPOINT_WIDTH[modifier]} px so you can see it.` : ""}</p>}
          {modifier && <p className="mt-1 text-2xs leading-relaxed text-text-tertiary">A state and a screen size are edited one at a time.</p>}
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
        SECTIONS.map((section) => {
          const { ordered, rest } = groupsFor(section.id);
          return (
            <div key={section.id} className="border-t border-surface-border px-3 py-2.5" data-section={section.id}>
              <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-tertiary">{section.label}</p>
              <div className={cn(section.id === "spacing" ? "grid grid-cols-2 gap-x-2 gap-y-1.5" : "flex flex-col gap-1.5")}>
                {ordered.map((g) => {
                  const { value, control } = row(g);
                  if (section.id === "spacing") {
                    return (
                      <div key={g.id} className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center gap-1 text-2xs text-text-tertiary" title={g.label}>
                          <span className="truncate">{SPACING_CAPTION[g.id] ?? g.label}</span>
                          {fieldStatus(g, value, index) && <span data-token-status={fieldStatus(g, value, index)} className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", fieldStatus(g, value, index) === "token" ? "bg-accent" : "bg-amber-500")} />}
                          {value !== null && (
                            <button onClick={() => change(g, null)} aria-label={`Remove ${g.label}`} title="Remove" className="ml-auto rounded text-text-tertiary hover:text-text-primary"><X size={10} /></button>
                          )}
                        </span>
                        {control}
                        <RawHint group={g} label={g.label} value={value} index={index} onUse={(v) => change(g, v)} indent={false} />
                      </div>
                    );
                  }
                  return (
                    <div key={g.id} className="flex flex-col gap-1">
                      <Field label={g.label} status={fieldStatus(g, value, index)} onRemove={value !== null ? () => change(g, null) : undefined}>
                        {g.id === "w" || g.id === "h" ? (
                          <div className="flex min-w-0 flex-col gap-1">
                            {control}
                            <SizeShortcuts label={g.label} value={value} onChange={(v) => change(g, v)} />
                          </div>
                        ) : control}
                      </Field>
                      <RawHint group={g} label={g.label} value={value} index={index} onUse={(v) => change(g, v)} />
                    </div>
                  );
                })}
                {rest.length > 0 && (
                  <select
                    className={cn("input-sm w-full text-text-tertiary", section.id === "spacing" && "col-span-2")}
                    aria-label={`Add ${section.label.toLowerCase()} property`}
                    value=""
                    onChange={(e) => { const g = groups.find((x) => x.id === e.target.value); if (g) change(g, starting(g)); }}
                  >
                    <option value="">Add…</option>
                    {rest.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
