"use client";

import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { controlsFor, initialProps, type PropControl } from "@/lib/preview/props";
import type { LibraryComponent } from "@/lib/preview/library";
import type { Support } from "@/lib/repo-scan/types";
import { useGitStore } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import PropsEditor from "./PropsEditor";

// The inspector brings the stylesheet editor (postcss) with it: loaded when an element is first looked at.
const ElementInspector = dynamic(() => import("./ElementInspector"), { loading: () => null });

const SUPPORT_STYLE: Record<Support, string> = {
  editable: "bg-mint-soft text-success",
  partial: "bg-sun-soft text-ink",
  "view-only": "bg-surface-subtle text-text-tertiary",
};
const SUPPORT_LABEL: Record<Support, string> = { editable: "Editable", partial: "Partly editable", "view-only": "View only" };

export function Row({ control, value, onChange }: { control: PropControl; value: unknown; onChange: (value: unknown) => void }) {
  const { name, required, defaultValue, description } = control;
  const kind = control.control;
  const label = (
    <label className="flex flex-col" title={description ?? undefined}>
      <span className="truncate font-mono text-xs text-text-secondary">{name}{required && <span className="text-danger"> *</span>}</span>
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

function PropsContent({ component }: { component: LibraryComponent }) {
  const overrides = usePreviewStore((s) => s.values[component.id]);
  const { setValue, resetValues } = usePreviewStore(useShallow((s) => ({ setValue: s.setValue, resetValues: s.resetValues })));
  const controls = controlsFor(component);
  const current = { ...initialProps(component), ...(overrides ?? {}) };
  return (
    <>
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
          {component.notes.length > 0 && <ul className="list-disc pl-4 text-2xs leading-relaxed text-ink">{component.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
    </>
  );
}

type Tab = "design" | "props" | "code";
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "design", label: "Design", hint: "Layout, spacing, size, type and color of the element you picked" },
  { id: "props", label: "Props", hint: "The component's props and variants" },
  { id: "code", label: "Code", hint: "The element's classes, and its place in the markup" },
];

export default function RepoComponentPanel({ component }: { component: LibraryComponent }) {
  const editing = usePreviewStore((s) => s.mode === "edit" || s.mode === "variants");
  const source = useLibraryStore((s) => s.source);
  const connection = useGitStore((s) => s.connection);
  const [tab, setTab] = useState<Tab>("design");

  // Outside Design there is nothing picked to change: the props are what there is.
  if (!(editing && source && connection)) {
    return <div className="flex-1 select-text overflow-y-auto"><PropsContent component={component} /></div>;
  }
  return (
    <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)} data-tour="panel" className="flex min-h-0 flex-1 flex-col">
      <Tabs.List aria-label="Component panel" className="flex flex-shrink-0 border-b border-surface-border bg-surface-raised">
        {TABS.map((t) => (
          <Tabs.Trigger
            key={t.id}
            value={t.id}
            title={t.hint}
            className="relative flex-1 px-2 py-2 text-xs text-text-tertiary outline-none transition-colors hover:text-text-secondary data-[state=active]:text-text-primary data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent"
          >
            {t.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div className="min-h-0 flex-1 select-text overflow-y-auto">
        <Tabs.Content value="design" className="outline-none"><ElementInspector component={component} source={source} connection={connection} part="design" /></Tabs.Content>
        <Tabs.Content value="props" className="outline-none">
          <PropsEditor component={component} source={source} connection={connection} />
          <PropsContent component={component} />
        </Tabs.Content>
        <Tabs.Content value="code" className="outline-none"><ElementInspector component={component} source={source} connection={connection} part="code" /></Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
