"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { gitBlobSha } from "@/lib/github";
import { GROUPS } from "@/lib/edit/classes";
import { isFlagged } from "@/lib/edit/tokens";
import { applyChanges, parseEdit, previewChanges, signatureOf, type Row } from "@/lib/ai/proposal";
import { addProposedTokens, parseTokenProposal, targetFor } from "@/lib/ai/tokens";
import { useDesignSystemStore } from "@/store/design-system";
import { useEditStore } from "@/store/edit";
import { useGitStore } from "@/store/git";
import { useAIStore, type AIMessage } from "@/store/ai";
import { useChatSource } from "./chat-source";

const button = "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-50";
const primary = `${button} bg-accent/15 hover:bg-accent/25 text-accent border-accent/30`;
const quiet = `${button} border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-subtle`;

function Outcome({ text }: { text: string }) {
  return <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-text-secondary" role="status" data-outcome><Check size={11} className="mt-0.5 flex-shrink-0 text-emerald-500" /> <span>{text}</span></p>;
}

function Notes({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="list-disc pl-4 text-2xs leading-relaxed text-amber-500">
      {items.slice(0, 6).map((n, i) => <li key={i}>{n}</li>)}
      {items.length > 6 && <li>and {items.length - 6} more</li>}
    </ul>
  );
}

// Changes to the open component, as the inspector would make them: each is shown with what it changes, and they are
// made together, as one step that can be undone.
export function EditProposal({ message }: { message: AIMessage }) {
  const src = useChatSource();
  const revision = useEditStore((s) => s.revision);
  const setOutcome = useAIStore((s) => s.setOutcome);
  const basis = message.basis ?? null;
  const parsed = useMemo(() => (basis ? parseEdit(message.structured, basis.elements) : null), [message.structured, basis]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const here = !!basis && src.component?.id === basis.componentId && src.scope === basis.scope;

  // What the changes would do to the file as it is now. They are for the elements as they were when it was asked.
  useEffect(() => {
    if (!parsed || !basis || message.outcome) return;
    if (!here) { setRows(null); setProblem(`Open ${src.component ? "the component this was about" : "it"} to see and apply this (${basis.file}).`); return; }
    let stale = false;
    (async () => {
      try {
        const code = await src.readCode(basis.file);
        if (code === null) throw new Error("The file can't be read right now");
        const elements = await src.elementsOf(code);
        if (signatureOf(elements) !== basis.signature) {
          if (!stale) { setRows(null); setProblem("The component has changed since this was suggested, so its elements no longer match. Ask again to get changes for it as it is now."); }
          return;
        }
        const next = await previewChanges(basis.file, code, elements, parsed.changes, src.names, src.values);
        if (!stale) { setRows(next); setProblem(null); }
      } catch (err) {
        if (!stale) { setRows(null); setProblem(err instanceof Error ? err.message : "The changes can't be shown right now"); }
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, basis, here, message.outcome, revision, src.readCode, src.elementsOf]);

  if (!basis) return <p className="text-2xs leading-relaxed text-text-tertiary">Open a component and ask again, to get changes for it.</p>;
  if (!parsed) return null;
  if (message.outcome) return <Outcome text={message.outcome} />;
  if (parsed.changes.length === 0) return <Notes items={parsed.rejected.length ? parsed.rejected : ["There were no changes in it"]} />;

  const apply = async () => {
    setBusy(true);
    try {
      const code = await src.readCode(basis.file);
      if (code === null) throw new Error("The file can't be read right now");
      const elements = await src.elementsOf(code);
      if (signatureOf(elements) !== basis.signature) throw new Error("The component has changed since this was suggested. Ask again.");
      const done = await applyChanges(basis.file, code, elements, parsed.changes, src.names, src.values);
      const store = useEditStore.getState();
      if (done.changed > 0) {
        const base = store.bases[basis.file] ? undefined : { text: code, sha: await gitBlobSha(code) };
        store.change(basis.file, done.code, null, `AI: ${parsed.summary || "changes to the component"}`, base);
      }
      const left = done.skipped.map((s) => s.reason);
      setOutcome(
        message.id,
        done.changed > 0
          ? `Applied ${done.changed} of ${parsed.changes.length} change${parsed.changes.length === 1 ? "" : "s"} to ${src.component?.name}. Undo takes them back together.${left.length ? ` Not made: ${[...new Set(left)].join("; ")}.` : ""}`
          : `Nothing changed: ${left.length ? [...new Set(left)].join("; ") : "the component already has these values"}.`
      );
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The changes could not be made");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-surface-border p-2" data-proposal="edit">
      <p className="text-2xs font-medium uppercase tracking-wider text-text-tertiary">Changes to {src.component?.name ?? "the component"}</p>
      {parsed.summary && <p className="text-xs text-text-primary">{parsed.summary}</p>}
      {rows ? (
        <ul className="flex flex-col gap-1">
          {rows.map((row, i) => {
            const group = "group" in row.change ? GROUPS.find((g) => g.id === (row.change as { group: string }).group) : undefined;
            const raw = group?.role && row.after && isFlagged(group.role, row.after, src.index);
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-text-secondary" data-change>
                <span className="font-mono text-2xs text-text-tertiary">&lt;{row.tag}&gt;</span>
                <span>{row.label}</span>
                <span className="font-mono text-2xs">{row.before ?? "none"} <span className="text-text-tertiary">→</span> <span className="text-text-primary">{row.after ?? "none"}</span></span>
                {raw && <span className="text-2xs text-amber-500">not a token</span>}
              </li>
            );
          })}
        </ul>
      ) : !problem && <p className="flex items-center gap-1.5 text-2xs text-text-tertiary"><Loader2 size={10} className="animate-spin" /> Reading the component…</p>}
      {problem && <p className="text-2xs leading-relaxed text-amber-500" role="alert">{problem}</p>}
      <Notes items={parsed.rejected} />
      <div className="flex gap-1.5">
        <button onClick={apply} disabled={busy || !rows} className={primary}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Apply {parsed.changes.length} change{parsed.changes.length === 1 ? "" : "s"}
        </button>
        <button onClick={() => setOutcome(message.id, "Dismissed.")} disabled={busy} className={quiet}>Dismiss</button>
      </div>
    </div>
  );
}

// New design tokens, added to Motif's token set. Nothing that exists is changed.
export function TokenProposal({ message }: { message: AIMessage }) {
  const setOutcome = useAIStore((s) => s.setOutcome);
  const ds = useDesignSystemStore();
  const link = useGitStore((s) => s.tokenLink);
  const parsed = useMemo(() => parseTokenProposal(message.structured), [message.structured]);
  const target = useMemo(() => targetFor(ds.sets, link), [ds.sets, link]);
  const preview = useMemo(() => (parsed && target ? addProposedTokens(ds, parsed.proposal, target) : null), [parsed, target, ds]);

  if (!parsed) return null;
  if (message.outcome) return <Outcome text={message.outcome} />;
  const set = ds.sets.find((s) => s.id === target?.setId);
  const { proposal } = parsed;
  const lines = [
    ...proposal.colors.map((c) => ({ kind: "color", name: c.name, value: c.dark ? `${c.value} · dark ${c.dark}` : c.value, swatch: c.value })),
    ...proposal.spacing.map((s) => ({ kind: "spacing", name: s.name, value: `${s.value}px`, swatch: null })),
    ...proposal.radii.map((r) => ({ kind: "radius", name: r.name, value: `${r.value}px`, swatch: null })),
    ...proposal.shadows.map((s) => ({ kind: "shadow", name: s.name, value: `${s.x} ${s.y} ${s.blur} ${s.spread} ${s.color}`, swatch: null })),
  ];
  if (lines.length === 0) return <Notes items={parsed.rejected.length ? parsed.rejected : ["There were no tokens in it"]} />;

  const apply = () => {
    if (!preview) return;
    useDesignSystemStore.setState(preview.next);
    const skipped = preview.skipped.length ? ` ${preview.skipped.length} already existed and were left as they are.` : "";
    setOutcome(message.id, preview.added > 0 ? `Added ${preview.added} token${preview.added === 1 ? "" : "s"} to ${set?.name ?? "the token set"}.${skipped} Send them to the repository with Sync tokens, as a pull request.` : `Nothing added.${skipped}`);
  };

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-surface-border p-2" data-proposal="tokens">
      <p className="text-2xs font-medium uppercase tracking-wider text-text-tertiary">New tokens{set ? ` for ${set.name}` : ""}</p>
      <ul className="flex flex-col gap-1">
        {lines.map((l, i) => {
          const exists = preview?.skipped.some((s) => s.name.toLowerCase() === l.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""));
          return (
            <li key={i} className={cn("flex items-baseline gap-1.5 text-xs", exists ? "text-text-tertiary line-through" : "text-text-secondary")} data-token>
              <span className="w-12 flex-shrink-0 text-2xs text-text-tertiary">{l.kind}</span>
              <span className="text-text-primary">{l.name}</span>
              <span className="min-w-0 truncate font-mono text-2xs">{l.value}</span>
              {exists && <span className="text-2xs no-underline">already a token</span>}
            </li>
          );
        })}
      </ul>
      <Notes items={parsed.rejected} />
      {!target && <p className="text-2xs text-amber-500" role="alert">There is no token set to add them to.</p>}
      <div className="flex gap-1.5">
        <button onClick={apply} disabled={!preview || preview.added === 0} className={primary}><Wand2 size={11} /> Add {preview?.added ?? lines.length} token{(preview?.added ?? lines.length) === 1 ? "" : "s"}</button>
        <button onClick={() => setOutcome(message.id, "Dismissed.")} className={quiet}>Dismiss</button>
      </div>
    </div>
  );
}
