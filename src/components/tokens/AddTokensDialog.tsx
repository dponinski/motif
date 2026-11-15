"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CornerDownRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeColor } from "@/lib/token-sync/color";
import { applyPlan, planDrafts, type Draft, type PlanItem } from "@/lib/tokens/drafts";
import { knownOf, parsePaste, type Parsed } from "@/lib/tokens/paste";
import { colorRamp, RAMP_STEPS, radiusScale, spacingScale, typeScale } from "@/lib/tokens/scale";
import { hexOf } from "@/lib/tokens/contrast";
import { snapshotTokens, useDesignSystemStore, type TokenKind, type TokenSet } from "@/store/design-system";
import { editTokens } from "@/store/token-history";

// Adding many tokens at once: paste them (CSS, a design tokens file, or lines of names and values), or make a scale from one value.
// Either way what adding them would do is shown first, and adding is one step of undo.

type Tab = "paste" | "scale";
type ScaleKind = "color" | "spacing" | "radius" | "typography";

const field = "rounded border border-surface-border bg-surface-base px-2 py-1 text-xs text-text-primary outline-none focus:border-accent";
const label = "flex flex-col gap-1 text-2xs text-text-tertiary";
const STATUS: Record<PlanItem["status"], { text: string; className: string }> = {
  new: { text: "New", className: "bg-emerald-500/15 text-emerald-500" },
  update: { text: "Changes it", className: "bg-amber-500/15 text-amber-500" },
  same: { text: "Already there", className: "bg-surface-overlay text-text-tertiary" },
};

function describe(d: Draft, themes: TokenSet["themes"]): React.ReactNode {
  switch (d.kind) {
    case "color": {
      const entries = themes.filter((t) => d.values[t.id] !== undefined).map((t) => ({ t, v: d.values[t.id] }));
      return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {entries.map(({ t, v }) => (
            <span key={t.id} className="flex items-center gap-1" title={`${t.name}: ${v}`}>
              <span className="h-3.5 w-3.5 flex-shrink-0 rounded border border-black/15" style={{ backgroundColor: v }} />
              <span className="font-mono text-2xs text-text-secondary">{hexOf(v)}</span>
              {d.aliases?.[t.id] && <span data-alias-chip className="flex items-center gap-0.5 text-2xs text-accent"><CornerDownRight size={9} aria-hidden />{d.aliases[t.id]}</span>}
            </span>
          ))}
        </span>
      );
    }
    case "spacing": case "radius": return <span className="font-mono text-2xs text-text-secondary">{d.value >= 9999 ? "full" : `${d.value}px`}</span>;
    case "shadow": return <span className="font-mono text-2xs text-text-secondary">{d.x} {d.y} {d.blur} {d.spread} {d.color}</span>;
    case "typography": return <span className="font-mono text-2xs text-text-secondary">{d.fontFamily} {d.fontSize}px / {d.lineHeight}</span>;
  }
}

// What is about to be added, with a checkbox for each, and the button that does it.
function PlanPanel({ drafts, notes, set, onDone }: { drafts: Draft[]; notes: string[]; set: TokenSet; onDone: () => void }) {
  const colors = useDesignSystemStore((s) => s.colors);
  const spacing = useDesignSystemStore((s) => s.spacing);
  const radii = useDesignSystemStore((s) => s.radii);
  const shadows = useDesignSystemStore((s) => s.shadows);
  const typography = useDesignSystemStore((s) => s.typography);
  const plan = useMemo(
    () => planDrafts(drafts, { ...snapshotTokens(useDesignSystemStore.getState()), colors, spacing, radii, shadows, typography }, set.id),
    [drafts, set.id, colors, spacing, radii, shadows, typography]
  );
  // The boxes the person has changed; the rest are ticked unless the token is there as it is.
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  const keyOf = (p: PlanItem) => `${p.draft.kind}:${p.name}`;
  const on = (p: PlanItem) => changed[keyOf(p)] ?? p.status !== "same";
  const chosen = plan.filter(on);
  const added = chosen.filter((p) => p.status === "new").length;
  const updated = chosen.filter((p) => p.status === "update").length;

  const add = () => {
    const actions: PlanItem[] = plan.map((p) => ({ ...p, action: !on(p) ? "skip" : p.status === "update" ? "update" : p.status === "new" ? "add" : "skip" }));
    editTokens(() => useDesignSystemStore.getState().replaceTokenData(applyPlan(snapshotTokens(useDesignSystemStore.getState()), set.id, actions)));
    onDone();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {notes.length > 0 && (
        <details className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-2xs text-amber-500" data-notes>
          <summary className="cursor-pointer select-none">{notes.length} left out</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-secondary">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      )}
      {plan.length === 0 ? (
        <p className="py-6 text-center text-xs text-text-tertiary" data-plan-empty>Nothing to add yet.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-surface-border" data-plan>
          {plan.map((p) => (
            <label key={keyOf(p)} className="flex cursor-pointer items-center gap-2 border-b border-surface-border px-2.5 py-1.5 last:border-0 hover:bg-surface-subtle" data-plan-row={p.name}>
              <input type="checkbox" checked={on(p)} onChange={(e) => setChanged((c) => ({ ...c, [keyOf(p)]: e.target.checked }))} aria-label={`Include ${p.name}`} className="h-3 w-3 flex-shrink-0 accent-[var(--accent,#6366f1)]" />
              <span className="w-40 flex-shrink-0 truncate text-xs text-text-primary" title={p.name}>{p.name}</span>
              <span className="min-w-0 flex-1">{describe(p.draft, set.themes)}</span>
              <span className={cn("flex-shrink-0 rounded px-1.5 py-0.5 text-2xs", STATUS[p.status].className)}>{STATUS[p.status].text}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-2xs text-text-tertiary" data-plan-summary>
          {chosen.length === 0 ? "Nothing selected" : [added ? `${added} to add` : "", updated ? `${updated} to change` : ""].filter(Boolean).join(" · ")}
        </span>
        <button type="button" onClick={onDone} className="rounded px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary">Cancel</button>
        <button type="button" onClick={add} disabled={chosen.length === 0} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-40">
          {chosen.length === 0 ? "Add tokens" : `Add ${chosen.length} ${chosen.length === 1 ? "token" : "tokens"}`}
        </button>
      </div>
    </div>
  );
}

// ── Paste ─────────────────────────────────────────────────────────────────────

function PasteTab({ set, onDone }: { set: TokenSet; onDone: () => void }) {
  const [text, setText] = useState("");
  const [prefix, setPrefix] = useState("color");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const colors = useDesignSystemStore((s) => s.colors);
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => { void parsePaste(text, set.themes, { prefix, known: knownOf(colors, set.id) }).then((p) => { if (!stale) setParsed(p); }); }, 120);
    return () => { stale = true; clearTimeout(timer); };
  }, [text, prefix, set.themes, colors, set.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <label className={label}>
        Paste CSS custom properties, a design tokens (W3C) file, or lines
        <textarea
          aria-label="Paste tokens"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={7}
          placeholder={":root {\n  --primary-500: #6366f1;\n  --radius-md: 8px;\n}\n.dark { --primary-500: #818cf8; }\n\n…or lines:  primary #6366f1   |   #111827, #374151, #6b7280"}
          className={cn(field, "resize-none font-mono leading-relaxed")}
        />
      </label>
      <div className="flex items-center gap-3 text-2xs text-text-tertiary">
        <span>{parsed && parsed.format !== "empty" ? `Read as ${parsed.format === "css" ? "CSS" : parsed.format === "json" ? "a design tokens file" : "lines"}` : "A `.dark` block fills the dark theme, `:root` the light"}</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5">Name colors that have no name
          <input aria-label="Name for unnamed colors" value={prefix} onChange={(e) => setPrefix(e.target.value)} className={cn(field, "w-24 py-0.5")} />
        </label>
      </div>
      <PlanPanel drafts={parsed?.drafts ?? []} notes={parsed?.notes ?? []} set={set} onDone={onDone} />
    </div>
  );
}

// ── Scale ─────────────────────────────────────────────────────────────────────

const RATIOS: [string, number][] = [["Major second 1.125", 1.125], ["Minor third 1.2", 1.2], ["Major third 1.25", 1.25], ["Perfect fourth 1.333", 1.333], ["Perfect fifth 1.5", 1.5]];

function ScaleTab({ set, initial, onDone }: { set: TokenSet; initial: ScaleKind; onDone: () => void }) {
  const [kind, setKind] = useState<ScaleKind>(initial);
  const [base, setBase] = useState("#6366f1");
  const [stem, setStem] = useState("primary");
  const [steps, setSteps] = useState<number[]>(RAMP_STEPS);
  const [dark, setDark] = useState(true);
  const [unit, setUnit] = useState("4");
  const [spaceSteps, setSpaceSteps] = useState("1, 2, 3, 4, 5, 6, 8, 10, 12, 16");
  const [medium, setMedium] = useState("8");
  const [size, setSize] = useState("16");
  const [ratio, setRatio] = useState(1.25);
  const [family, setFamily] = useState("Inter");

  const light = set.themes[0];
  const darkTheme = set.themes.find((t) => t.id !== light?.id && /dark/i.test(t.name)) ?? set.themes[1];

  const { drafts, problem, ramp } = useMemo(() => {
    const out: { drafts: Draft[]; problem: string | null; ramp: ReturnType<typeof colorRamp> } = { drafts: [], problem: null, ramp: null };
    if (kind === "color") {
      if (normalizeColor(base.trim()) === null) { out.problem = "That isn't a color Motif can read."; return out; }
      const r = colorRamp(base.trim(), steps);
      if (!r) { out.problem = "Pick at least one step."; return out; }
      out.ramp = r;
      const name = (stem.trim() || "color").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      out.drafts = r.map((s) => ({ kind: "color", name: `${name}-${s.step}`, group: name, values: { [light.id]: s.light, ...(dark && darkTheme ? { [darkTheme.id]: s.dark } : {}) } }));
    } else if (kind === "spacing") {
      const n = parseFloat(unit);
      const list = spaceSteps.split(/[\s,]+/).map(parseFloat).filter((x) => Number.isFinite(x) && x > 0);
      if (!Number.isFinite(n) || n <= 0) { out.problem = "The unit is a number of px."; return out; }
      out.drafts = spacingScale(n, list).map((s) => ({ kind: "spacing", name: s.name, value: s.value }));
    } else if (kind === "radius") {
      const n = parseFloat(medium);
      if (!Number.isFinite(n) || n <= 0) { out.problem = "The medium radius is a number of px."; return out; }
      out.drafts = radiusScale(n).map((s) => ({ kind: "radius", name: s.name, value: s.value }));
    } else {
      const n = parseFloat(size);
      if (!Number.isFinite(n) || n <= 0) { out.problem = "The base size is a number of px."; return out; }
      out.drafts = typeScale({ base: n, ratio, fontFamily: family.trim() || "Inter" }).map((t) => ({ kind: "typography", name: t.name, fontFamily: t.fontFamily, fontSize: t.fontSize, fontWeight: t.fontWeight, lineHeight: t.lineHeight }));
    }
    return out;
  }, [kind, base, stem, steps, dark, darkTheme, light, unit, spaceSteps, medium, size, ratio, family]);

  const tabs: [ScaleKind, string][] = [["color", "Color ramp"], ["spacing", "Spacing"], ["radius", "Radius"], ["typography", "Type"]];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-0.5 rounded bg-surface-subtle p-0.5" role="group" aria-label="Kind of scale">
        {tabs.map(([k, name]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("flex-1 rounded px-2 py-1 text-xs", kind === k ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}>{name}</button>
        ))}
      </div>

      {kind === "color" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <label className={label}>Color
              <span className="flex items-center gap-1.5">
                <input type="color" aria-label="Pick the base color" value={(normalizeColor(base.trim()) ?? "#6366f1").slice(0, 7)} onChange={(e) => setBase(e.target.value)} className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0" />
                <input aria-label="Base color" value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} className={cn(field, "w-32 font-mono")} />
              </span>
            </label>
            <label className={label}>Name
              <input aria-label="Name of the ramp" value={stem} onChange={(e) => setStem(e.target.value)} className={cn(field, "w-36")} />
            </label>
            {darkTheme && (
              <label className="mb-1.5 flex items-center gap-1.5 text-xs text-text-secondary">
                <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} className="h-3 w-3 accent-[var(--accent,#6366f1)]" /> Turn it over for {darkTheme.name}
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Steps">
            {RAMP_STEPS.map((s) => (
              <button key={s} type="button" aria-pressed={steps.includes(s)} onClick={() => setSteps((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))} className={cn("rounded-full border px-2 py-0.5 text-2xs tabular-nums", steps.includes(s) ? "border-accent/50 bg-accent/15 text-accent" : "border-surface-border text-text-tertiary hover:text-text-secondary")}>{s}</button>
            ))}
          </div>
          {ramp && (
            <div className="flex overflow-hidden rounded-md border border-black/10" data-ramp-preview aria-label="Preview of the ramp">
              {ramp.map((s) => <div key={s.step} className="flex h-10 flex-1 items-end justify-center pb-0.5 text-[9px] tabular-nums" style={{ backgroundColor: s.light, color: s.step >= 500 ? "#fff" : "#000" }}>{s.step}</div>)}
            </div>
          )}
        </div>
      )}
      {kind === "spacing" && (
        <div className="flex items-end gap-3">
          <label className={label}>Unit (px)<input aria-label="Spacing unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={cn(field, "w-20 font-mono")} /></label>
          <label className={cn(label, "flex-1")}>Steps<input aria-label="Spacing steps" value={spaceSteps} onChange={(e) => setSpaceSteps(e.target.value)} className={cn(field, "font-mono")} /></label>
        </div>
      )}
      {kind === "radius" && (
        <label className={label}>Medium radius (px)<input aria-label="Medium radius" value={medium} onChange={(e) => setMedium(e.target.value)} className={cn(field, "w-24 font-mono")} /></label>
      )}
      {kind === "typography" && (
        <div className="flex items-end gap-3">
          <label className={label}>Base size (px)<input aria-label="Base size" value={size} onChange={(e) => setSize(e.target.value)} className={cn(field, "w-20 font-mono")} /></label>
          <label className={label}>Ratio
            <select aria-label="Ratio" value={ratio} onChange={(e) => setRatio(parseFloat(e.target.value))} className={field}>
              {RATIOS.map(([name, v]) => <option key={v} value={v}>{name}</option>)}
            </select>
          </label>
          <label className={label}>Font<input aria-label="Font family" value={family} onChange={(e) => setFamily(e.target.value)} className={cn(field, "w-32")} /></label>
        </div>
      )}
      {problem && <p className="text-xs text-red-400" data-problem>{problem}</p>}
      <PlanPanel drafts={drafts} notes={[]} set={set} onDone={onDone} />
    </div>
  );
}

// ── The dialog ────────────────────────────────────────────────────────────────

export default function AddTokensDialog({ open, onOpenChange, set, kind }: { open: boolean; onOpenChange: (open: boolean) => void; set: TokenSet; kind: TokenKind }) {
  const [tab, setTab] = useState<Tab>("paste");
  const scaleKind: ScaleKind = kind === "spacing" || kind === "radius" || kind === "typography" ? kind : "color";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] min-h-[420px] w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 select-text flex-col rounded-xl border border-surface-border bg-surface-raised text-text-primary shadow-2xl">
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-surface-border px-4 py-2.5">
            <Dialog.Title className="text-sm font-medium">Add tokens to {set.name}</Dialog.Title>
            <div className="ml-3 flex gap-0.5 rounded bg-surface-subtle p-0.5" role="tablist" aria-label="How to add">
              {([["paste", "Paste"], ["scale", "Scale"]] as [Tab, string][]).map(([id, name]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("rounded px-2.5 py-1 text-xs", tab === id ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}>{name}</button>
              ))}
            </div>
            <div className="flex-1" />
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close"><X size={13} /></Dialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            {tab === "paste" ? <PasteTab set={set} onDone={() => onOpenChange(false)} /> : <ScaleTab set={set} initial={scaleKind} onDone={() => onOpenChange(false)} />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
