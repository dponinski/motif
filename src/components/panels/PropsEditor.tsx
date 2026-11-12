"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { addProp, addVariantGroup, addVariantOption, cvaNamesIn, literalFor, removeProp, removeVariantOption, renameVariantOption, setPropDefault, setVariantDefault, type PropKind } from "@/lib/edit/props";
import type { LibraryComponent } from "@/lib/preview/library";
import { currentText, useEditStore } from "@/store/edit";
import type { GitConnection } from "@/store/git";
import type { LibrarySource } from "@/store/library";
import { useEditRunner } from "./useEditRunner";

const kindOf = (type: string): PropKind => (/boolean/.test(type) ? "boolean" : /number/.test(type) ? "number" : "string");

// Text that is applied when you leave the field or press Enter.
function Field({ value, onCommit, label, placeholder, className }: { value: string; onCommit: (value: string) => void; label: string; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value);
  const [sent, setSent] = useState(value);
  useEffect(() => { setText(value); setSent(value); }, [value]);
  const commit = () => { if (text !== sent) { setSent(text); onCommit(text); } };
  return (
    <input
      className={className ?? "input-sm min-w-0 flex-1"}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
    />
  );
}

const smallButton = "flex h-7 flex-shrink-0 items-center gap-1 rounded-md border border-surface-border px-2 text-2xs text-text-secondary hover:bg-surface-subtle disabled:opacity-40";

export default function PropsEditor({ component, source, connection }: { component: LibraryComponent; source: LibrarySource; connection: GitConnection }) {
  const { run, error, reader } = useEditRunner(source, connection);
  const revision = useEditStore((s) => s.revision);
  const file = component.file;

  const groups = component.variants.filter((v) => v.source === "cva");
  const others = component.variants.filter((v) => v.source !== "cva");
  const groupNames = new Set(component.variants.map((v) => v.name));
  const props = component.props.filter((p) => !groupNames.has(p.name) && p.name !== "children");

  const [newOption, setNewOption] = useState<Record<string, string>>({});
  const [group, setGroup] = useState({ name: "", option: "" });
  const [prop, setProp] = useState<{ name: string; kind: PropKind; value: string }>({ name: "", kind: "string", value: "" });
  const [cvas, setCvas] = useState<string[]>([]);
  const [cva, setCva] = useState("");

  useEffect(() => {
    let stale = false;
    (async () => {
      const code = currentText(useEditStore.getState(), file) ?? (await reader.readText(file, source.branch));
      const names = code ? await cvaNamesIn(file, code).catch(() => []) : [];
      if (!stale) { setCvas(names); setCva((c) => (names.includes(c) ? c : names[0] ?? "")); }
    })();
    return () => { stale = true; };
  }, [file, revision, reader, source.branch]);

  return (
    <div className="border-b border-surface-border px-3 py-2.5">
      <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-tertiary">Props and variants</p>
      {error && <p className="mb-2 break-words rounded border border-red-400/30 bg-red-400/10 px-2 py-1.5 text-2xs text-red-400">{error}</p>}

      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g.name} className="flex flex-col gap-1.5" aria-label={`Variant group ${g.name}`} role="group">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate font-mono text-xs text-text-secondary">{g.name}</span>
              <select
                className="input-sm !w-[96px]"
                aria-label={`Default ${g.name}`}
                value={g.default ?? ""}
                onChange={(e) => { const v = e.target.value; void run(file, (code) => setVariantDefault(file, code, g.name, v || null)); }}
              >
                <option value="">no default</option>
                {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {g.options.map((o) => (
              <div key={o} className="flex items-center gap-1.5 pl-3">
                <Field label={`Rename ${g.name} ${o}`} value={o} onCommit={(v) => void run(file, (code) => renameVariantOption(file, code, g.name, o, v.trim()))} />
                <button className="rounded text-text-tertiary hover:text-text-primary" aria-label={`Remove ${g.name} ${o}`} title="Remove option" onClick={() => void run(file, (code) => removeVariantOption(file, code, g.name, o))}>
                  <X size={11} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-1.5 pl-3">
              <input
                className="input-sm min-w-0 flex-1"
                aria-label={`New ${g.name} option`}
                placeholder="New option"
                value={newOption[g.name] ?? ""}
                onChange={(e) => setNewOption({ ...newOption, [g.name]: e.target.value })}
              />
              <button
                className={smallButton}
                aria-label={`Add ${g.name} option`}
                disabled={!(newOption[g.name] ?? "").trim()}
                onClick={async () => {
                  const name = (newOption[g.name] ?? "").trim();
                  if (await run(file, (code) => addVariantOption(file, code, g.name, name))) setNewOption({ ...newOption, [g.name]: "" });
                }}
              >
                <Plus size={10} /> Add
              </button>
            </div>
          </div>
        ))}

        {others.map((v) => (
          <div key={v.name} className="text-2xs leading-relaxed text-text-tertiary">
            <span className="font-mono text-text-secondary">{v.name}</span>: {v.options.join(", ")}. It comes from {v.source === "union" ? "a type" : "a lookup table"}, which is edited in code.
          </div>
        ))}

        {cvas.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-2xs text-text-tertiary">New variant group{cvas.length > 1 ? " in" : ""}</p>
            {cvas.length > 1 && (
              <select className="input-sm" aria-label="cva for the new group" value={cva} onChange={(e) => setCva(e.target.value)}>{cvas.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            )}
            <div className="flex items-center gap-1.5">
              <input className="input-sm min-w-0 flex-1" aria-label="New variant group name" placeholder="name" value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} />
              <input className="input-sm min-w-0 flex-1" aria-label="First option of the new group" placeholder="first option" value={group.option} onChange={(e) => setGroup({ ...group, option: e.target.value })} />
              <button
                className={smallButton}
                aria-label="Add variant group"
                disabled={!group.name.trim() || !group.option.trim() || !cva}
                onClick={async () => { if (await run(file, (code) => addVariantGroup(file, code, cva, group.name.trim(), group.option.trim()))) setGroup({ name: "", option: "" }); }}
              >
                <Plus size={10} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-1.5 border-t border-surface-border pt-2.5">
        {props.map((p) => {
          const kind = kindOf(p.type);
          return (
            <div key={p.name} className="grid grid-cols-[1fr_84px_16px] items-center gap-1.5">
              <span className="truncate font-mono text-xs text-text-secondary" title={p.type}>{p.name}</span>
              <Field
                className="input-sm w-full"
                label={`Default ${p.name}`}
                placeholder="no default"
                value={p.default ?? ""}
                onCommit={(v) => {
                  const source = v.trim() === "" ? null : literalFor(kind, kind === "string" ? v.replace(/^"(.*)"$/, "$1") : v);
                  void run(file, (code) => setPropDefault(file, code, component.name, p.name, source));
                }}
              />
              <button className="rounded text-text-tertiary hover:text-text-primary" aria-label={`Remove prop ${p.name}`} title="Remove prop" onClick={() => void run(file, (code) => removeProp(file, code, component.name, p.name))}>
                <X size={11} />
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-1.5">
          <input className="input-sm min-w-0 flex-1" aria-label="New prop name" placeholder="new prop" value={prop.name} onChange={(e) => setProp({ ...prop, name: e.target.value })} />
          <select className="input-sm !w-[72px]" aria-label="New prop type" value={prop.kind} onChange={(e) => setProp({ ...prop, kind: e.target.value as PropKind })}>
            <option value="string">text</option>
            <option value="boolean">boolean</option>
            <option value="number">number</option>
          </select>
          <input className="input-sm !w-[64px]" aria-label="New prop default" placeholder="default" value={prop.value} onChange={(e) => setProp({ ...prop, value: e.target.value })} />
          <button
            className={smallButton}
            aria-label="Add prop"
            disabled={!prop.name.trim()}
            onClick={async () => {
              const literal = prop.value.trim() === "" ? null : literalFor(prop.kind, prop.value);
              if (prop.value.trim() !== "" && literal === null) return;
              if (await run(file, (code) => addProp(file, code, component.name, prop.name.trim(), prop.kind, literal))) setProp({ name: "", kind: "string", value: "" });
            }}
          >
            <Plus size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}
