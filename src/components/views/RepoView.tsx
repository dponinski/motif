"use client";

import { useMemo, useState } from "react";
import { Boxes, ChevronDown, ChevronRight, Loader2, RefreshCw, ScanSearch, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { readerSource } from "@/lib/repo-scan/source";
import {
  STYLING_LABEL, isColorValue, stackLine, stylingLine, supportCounts,
} from "@/lib/repo-scan/summary";
import type { RepoAnalysis, RepoComponent, RepoToken, RepoTokenKind, Support } from "@/lib/repo-scan/types";
import { importable } from "@/lib/preview/library";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { errorMessage, useGitHost } from "@/components/git/hooks";

type Tab = "setup" | "tokens" | "components" | "warnings";

const SUPPORT_STYLE: Record<Support, string> = {
  editable: "bg-emerald-500/15 text-emerald-500",
  partial: "bg-amber-500/15 text-amber-500",
  "view-only": "bg-surface-subtle text-text-tertiary",
};
const SUPPORT_LABEL: Record<Support, string> = { editable: "Editable", partial: "Partly editable", "view-only": "View only" };

const KINDS: { id: RepoTokenKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "color", label: "Colors" },
  { id: "font", label: "Fonts" },
  { id: "radius", label: "Radius" },
  { id: "shadow", label: "Shadows" },
  { id: "spacing", label: "Spacing" },
  { id: "other", label: "Other" },
];

const chip = "inline-flex items-center rounded px-1.5 py-0.5 text-2xs";

// ── Setup ─────────────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 border-b border-surface-border-subtle py-2.5 text-xs">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="min-w-0 text-text-primary">{children}</dd>
    </div>
  );
}

function editingSummary(a: RepoAnalysis): string {
  if (!a.stack.supported) return "Only React repositories are read so far.";
  const primary = a.stack.styling.primary;
  if (primary !== "tailwind") {
    return `The visual editor doesn't support ${primary ? STYLING_LABEL[primary] : "this styling"} yet. Components will be viewable but not editable.`;
  }
  const n = supportCounts(a.components);
  return `Tailwind is the first styling system the visual editor will support. ${n.editable} of ${a.components.length} components are fully editable, ${n.partial} partly, ${n["view-only"]} view only.`;
}

function Setup({ a }: { a: RepoAnalysis }) {
  const { stack } = a;
  return (
    <dl className="mx-auto max-w-3xl px-6 py-4">
      <Row label="Repository">{a.repo} <span className="text-text-tertiary">· {a.ref}</span></Row>
      <Row label="Stack">{stackLine(stack)}{!stack.supported && <span className="ml-2 text-amber-500">Not supported yet</span>}</Row>
      <Row label="Styling">
        <p>{stylingLine(stack)}</p>
        {stack.styling.evidence.length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-text-secondary">
            {stack.styling.evidence.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </Row>
      <Row label="Visual editing">{editingSummary(a)}</Row>
      <Row label="Packages">{stack.packages.length ? stack.packages.join(", ") : "None found"}</Row>
      <Row label="Entry files">
        {stack.entryFiles.length
          ? <span className="font-mono text-2xs">{stack.entryFiles.join(", ")}</span>
          : <span className="text-text-secondary">None found, so exports can&apos;t be marked public or internal</span>}
      </Row>
      <Row label="Themes">{a.themes.length ? a.themes.join(", ") : "No tokens found"}</Row>
      <Row label="Read">
        {a.stats.filesRead} of {a.stats.filesInRepo} files · {new Date(a.scannedAt).toLocaleString()}
      </Row>
    </dl>
  );
}

// ── Tokens ────────────────────────────────────────────────────────────────────

function ValueCell({ token, theme }: { token: RepoToken; theme: string }) {
  const value = token.values[theme];
  if (value === undefined) return <span className="text-text-tertiary">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {token.kind === "color" && isColorValue(value) && (
        <span className="h-4 w-4 flex-shrink-0 rounded border border-surface-border" style={{ backgroundColor: value }} />
      )}
      <span className="truncate font-mono text-2xs text-text-secondary" title={value}>{value}</span>
    </span>
  );
}

function Tokens({ a }: { a: RepoAnalysis }) {
  const [kind, setKind] = useState<RepoTokenKind | "all">("all");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: a.tokens.length };
    for (const t of a.tokens) c[t.kind] = (c[t.kind] ?? 0) + 1;
    return c;
  }, [a.tokens]);
  const shown = a.tokens.filter((t) => kind === "all" || t.kind === kind);
  const themes = a.themes.length ? a.themes : ["default"];
  const columns = `minmax(150px,1.1fr) repeat(${themes.length}, minmax(150px,1fr)) minmax(120px,0.8fr)`;

  if (a.tokens.length === 0) {
    return <p className="px-6 py-8 text-center text-xs text-text-tertiary">No design tokens were found in this repository.</p>;
  }

  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex flex-wrap gap-1">
        {KINDS.filter((k) => counts[k.id]).map((k) => (
          <button
            key={k.id}
            onClick={() => setKind(k.id)}
            aria-pressed={kind === k.id}
            className={cn("rounded px-2.5 py-1 text-xs transition-colors", kind === k.id ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-surface-subtle hover:text-text-primary")}
          >
            {k.label} <span className="text-text-tertiary">{counts[k.id]}</span>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid gap-4 border-b border-surface-border px-2 py-2 text-2xs font-semibold uppercase tracking-wider text-text-tertiary" style={{ gridTemplateColumns: columns }}>
            <span>Name</span>
            {themes.map((t) => <span key={t}>{t}</span>)}
            <span>Defined in</span>
          </div>
          {shown.map((t) => (
            <div key={t.name} className="grid items-center gap-4 border-b border-surface-border-subtle px-2 py-2 text-xs" style={{ gridTemplateColumns: columns }}>
              <span className="min-w-0">
                <span className="block truncate font-mono text-text-primary" title={t.name}>{t.name}</span>
                {t.tailwind && t.tailwind !== t.name && <span className="block truncate text-2xs text-text-tertiary">Tailwind: {t.tailwind}</span>}
              </span>
              {themes.map((theme) => <ValueCell key={theme} token={t} theme={theme} />)}
              <span className="truncate font-mono text-2xs text-text-tertiary" title={`${t.file}${t.line ? `:${t.line}` : ""}`}>
                {t.file}{t.line ? `:${t.line}` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Components ────────────────────────────────────────────────────────────────

function ComponentCard({ c }: { c: RepoComponent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised">
      <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={12} className="flex-shrink-0 text-text-tertiary" /> : <ChevronRight size={12} className="flex-shrink-0 text-text-tertiary" />}
        <span className="text-sm font-medium text-text-primary">{c.name}</span>
        <span className={cn(chip, SUPPORT_STYLE[c.support.level])}>{SUPPORT_LABEL[c.support.level]}</span>
        {c.public !== null && <span className={cn(chip, "bg-surface-subtle text-text-tertiary")}>{c.public ? "Public" : "Internal"}</span>}
        {c.variants.length > 0 && <span className="text-2xs text-text-tertiary">{c.variants.length} variant{c.variants.length === 1 ? "" : "s"}</span>}
        <span className="ml-auto min-w-0 truncate font-mono text-2xs text-text-tertiary">{c.file}:{c.line}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-surface-border px-4 py-3 text-xs">
          {c.support.reasons.length > 0 && (
            <ul className="list-disc pl-4 text-text-secondary">{c.support.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          )}

          {c.variants.map((v) => (
            <div key={v.name} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 flex-shrink-0 font-mono text-text-secondary">{v.name}</span>
              {v.options.map((o) => (
                <span key={o} className={cn(chip, o === v.default ? "bg-accent/15 text-accent" : "bg-surface-subtle text-text-secondary")}>{o}</span>
              ))}
              <span className="text-2xs text-text-tertiary">from {v.source === "cva" ? "a variants table" : v.source === "lookup" ? "a lookup object" : "a type union"}</span>
            </div>
          ))}

          {c.props.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-2xs uppercase tracking-wider text-text-tertiary">
                    <th className="py-1 pr-3 font-semibold">Prop</th><th className="py-1 pr-3 font-semibold">Type</th><th className="py-1 pr-3 font-semibold">Default</th><th className="py-1 font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {c.props.map((p) => (
                    <tr key={p.name} className="border-t border-surface-border-subtle align-top">
                      <td className="py-1.5 pr-3 font-mono text-text-primary">{p.name}{p.required && <span className="text-red-400" title="Required"> *</span>}</td>
                      <td className="py-1.5 pr-3 font-mono text-2xs text-text-secondary">{p.type}</td>
                      <td className="py-1.5 pr-3 font-mono text-2xs text-text-secondary">{p.default ?? "—"}</td>
                      <td className="py-1.5 text-text-secondary">{p.description ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-text-tertiary">No props of its own.</p>
          )}

          {c.nativeProps && <p className="text-text-secondary">Also accepts <span className="font-mono text-2xs">{c.nativeProps}</span></p>}
          <div className="flex flex-wrap items-center gap-1.5 text-text-tertiary">
            {c.root && <span>Renders <span className="font-mono text-text-secondary">&lt;{c.root}&gt;</span></span>}
            {c.hooks.length > 0 && <span>· uses {c.hooks.map((h) => <span key={h} className={cn(chip, "mr-1 bg-surface-subtle font-mono text-text-secondary")}>{h}</span>)}</span>}
          </div>
          {c.notes.length > 0 && <ul className="list-disc pl-4 text-amber-500">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

function Components({ a }: { a: RepoAnalysis }) {
  const [query, setQuery] = useState("");
  const [publicOnly, setPublicOnly] = useState(false);
  const knowsPublic = a.components.some((c) => c.public !== null);
  const shown = a.components.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) && (!publicOnly || c.public !== false));

  if (a.components.length === 0) {
    return <p className="px-6 py-8 text-center text-xs text-text-tertiary">No components were found{a.stack.supported ? "" : " because only React repositories are read so far"}.</p>;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-4">
      <div className="mb-3 flex items-center gap-3">
        <input className="input-sm max-w-xs" placeholder="Filter components…" aria-label="Filter components" value={query} onChange={(e) => setQuery(e.target.value)} />
        {knowsPublic && (
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input type="checkbox" checked={publicOnly} onChange={(e) => setPublicOnly(e.target.checked)} /> Public only
          </label>
        )}
        <span className="ml-auto text-xs text-text-tertiary">{shown.length} of {a.components.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {shown.map((c) => <ComponentCard key={`${c.file}::${c.name}`} c={c} />)}
      </div>
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

function Report({ analysis, connection, onClose }: { analysis: RepoAnalysis; connection: GitConnection; onClose: () => void }) {
  const host = useGitHost(connection);
  const setAnalysis = useGitStore((s) => s.setAnalysis);
  const [tab, setTab] = useState<Tab>("setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const importCount = importable(analysis.components).length;

  const rescan = async () => {
    setBusy(true);
    setError(null);
    try {
      const { scanRepository } = await import("@/lib/repo-scan");
      setAnalysis(await scanRepository(readerSource(host, analysis.ref), { repo: analysis.repo, ref: analysis.ref }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "setup", label: "Setup" },
    { id: "tokens", label: "Tokens", count: analysis.tokens.length },
    { id: "components", label: "Components", count: analysis.components.length },
    ...(analysis.warnings.length ? [{ id: "warnings" as Tab, label: "Warnings", count: analysis.warnings.length }] : []),
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-surface-base">
      <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-surface-border bg-surface-raised px-4">
        <ScanSearch size={14} className="flex-shrink-0 text-accent" />
        <span className="text-sm font-semibold text-text-primary">Repository</span>
        <span className="truncate text-xs text-text-tertiary">{analysis.repo} · {analysis.ref}</span>
        <div className="flex-1" />
        {error && <span className="text-xs text-red-400">{error}</span>}
        {importCount > 0 && (
          <button
            onClick={() => setImported(useLibraryStore.getState().importComponents(analysis))}
            className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary"
          >
            <Boxes size={11} /> {imported === null ? `Import ${importCount} components` : `Imported ${imported}`}
          </button>
        )}
        <button onClick={rescan} disabled={busy} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary disabled:opacity-60">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Rescan
        </button>
        <div className="h-5 w-px bg-surface-border" />
        <button onClick={onClose} className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-surface-subtle hover:text-text-primary" title="Back to Git">
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-shrink-0 gap-0.5 border-b border-surface-border bg-surface-raised px-4 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "rounded-t px-3 py-1.5 text-xs transition-colors",
              tab === t.id ? "border-b-2 border-accent text-text-primary" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {t.label}{t.count !== undefined && <span className="ml-1.5 text-text-tertiary">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 select-text overflow-y-auto">
        {tab === "setup" && <Setup a={analysis} />}
        {tab === "tokens" && <Tokens a={analysis} />}
        {tab === "components" && <Components a={analysis} />}
        {tab === "warnings" && (
          <ul className="mx-auto max-w-3xl list-disc px-10 py-4 text-xs text-amber-500">
            {analysis.warnings.map((w) => <li key={w} className="py-1">{w}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function RepoView({ onClose }: { onClose: () => void }) {
  const analysis = useGitStore((s) => s.analysis);
  const connection = useGitStore((s) => s.connection);

  if (!analysis || !connection || analysis.repo !== repoSlug(connection)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface-base">
        <p className="text-xs text-text-tertiary">Nothing has been scanned yet. Scan a repository from the Git panel.</p>
        <button onClick={onClose} className="rounded-md border border-surface-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary">Back to Git</button>
      </div>
    );
  }
  return <Report analysis={analysis} connection={connection} onClose={onClose} />;
}
