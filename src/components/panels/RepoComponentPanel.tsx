"use client";

import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlsFor, initialProps, type PropControl } from "@/lib/preview/props";
import type { LibraryComponent } from "@/lib/preview/library";
import type { Support } from "@/lib/repo-scan/types";
import { useGitStore } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import ElementInspector from "./ElementInspector";

const SUPPORT_STYLE: Record<Support, string> = {
  editable: "bg-emerald-500/15 text-emerald-500",
  partial: "bg-amber-500/15 text-amber-500",
  "view-only": "bg-surface-subtle text-text-tertiary",
};
const SUPPORT_LABEL: Record<Support, string> = { editable: "Editable", partial: "Partly editable", "view-only": "View only" };

function Row({ control, value, onChange }: { control: PropControl; value: unknown; onChange: (value: unknown) => void }) {
  const { name, required, defaultValue, description } = control;
  const kind = control.control;
  const label = (
    <label className="flex flex-col" title={description ?? undefined}>
      <span className="truncate font-mono text-xs text-text-secondary">{name}{required && <span className="text-red-400"> *</span>}</span>
      {defaultValue !== null && <span className="text-2xs text-text-tertiary">default {defaultValue}</span>}
    </label>
  );

  switch (kind.kind) {
    case "select":
      return (
        <div className="grid grid-cols-[1fr_120px] items-center gap-2">
          {label}
          <select className="input-sm" aria-label={name} value={(value as string | undefined) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
            {!required && <option value="">default</option>}
            {kind.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    case "boolean":
      return (
        <div className="grid grid-cols-[1fr_120px] items-center gap-2">
          {label}
          <select className="input-sm" aria-label={name} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}>
            {!required && <option value="">default</option>}
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
      );
    case "text":
    case "node":
      return (
        <div className="grid grid-cols-[1fr_120px] items-center gap-2">
          {label}
          <input className="input-sm" aria-label={name} value={(value as string | undefined) ?? ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "number":
      return (
        <div className="grid grid-cols-[1fr_120px] items-center gap-2">
          {label}
          <input className="input-sm" type="number" aria-label={name} value={(value as number | undefined) ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
        </div>
      );
    case "ignored":
      return (
        <div className="grid grid-cols-[1fr_120px] items-center gap-2 opacity-60" title={kind.reason}>
          {label}
          <span className="truncate text-2xs text-text-tertiary">{kind.reason}</span>
        </div>
      );
  }
}

export default function RepoComponentPanel({ component }: { component: LibraryComponent }) {
  const overrides = usePreviewStore((s) => s.values[component.id]);
  const { setValue, resetValues } = usePreviewStore();
  const controls = controlsFor(component);
  const current = { ...initialProps(component), ...(overrides ?? {}) };
  const editing = usePreviewStore((s) => s.mode === "edit");
  const source = useLibraryStore((s) => s.source);
  const connection = useGitStore((s) => s.connection);

  return (
    <div className="flex-1 select-text overflow-y-auto">
      {editing && source && connection && <ElementInspector component={component} source={source} connection={connection} />}
      <div className="border-b border-surface-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-sm font-medium text-text-primary">{component.name}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-2xs", SUPPORT_STYLE[component.support.level])}>{SUPPORT_LABEL[component.support.level]}</span>
        </div>
        {component.support.reasons.length > 0 && (
          <ul className="mt-1.5 list-disc pl-4 text-2xs leading-relaxed text-text-tertiary">
            {component.support.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
      </div>

      <div className="border-b border-surface-border px-3 py-2.5">
        <div className="mb-2 flex items-center">
          <p className="flex-1 text-2xs font-medium uppercase tracking-wider text-text-tertiary">Props</p>
          {overrides && Object.keys(overrides).length > 0 && (
            <button onClick={() => resetValues(component.id)} className="flex items-center gap-1 text-2xs text-text-tertiary hover:text-text-primary" title="Back to the starting values">
              <RotateCcw size={10} /> Reset
            </button>
          )}
        </div>
        {controls.length === 0 ? (
          <p className="text-xs text-text-tertiary">This component has no props of its own.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {controls.map((c) => (
              <Row key={c.name} control={c} value={current[c.name]} onChange={(v) => setValue(component.id, c.name, v)} />
            ))}
          </div>
        )}
        {component.nativeProps && <p className="mt-3 text-2xs leading-relaxed text-text-tertiary">Also accepts every attribute of <span className="font-mono">{component.nativeProps}</span>.</p>}
      </div>

      {(component.hooks.length > 0 || component.notes.length > 0) && (
        <div className="px-3 py-2.5">
          {component.hooks.length > 0 && (
            <p className="mb-1.5 text-2xs text-text-tertiary">Uses <span className="font-mono text-text-secondary">{component.hooks.join(", ")}</span></p>
          )}
          {component.notes.length > 0 && <ul className="list-disc pl-4 text-2xs leading-relaxed text-amber-500">{component.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
