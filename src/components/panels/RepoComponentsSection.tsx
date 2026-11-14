"use client";

import { useState } from "react";
import { Boxes, Loader2, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeUpdate } from "@/lib/preview/library";
import { readerSource } from "@/lib/repo-scan/source";
import type { Support } from "@/lib/repo-scan/types";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { useNavRequest } from "@/store/nav";
import NewComponentDialog from "@/components/stage/NewComponentDialog";

const DOT: Record<Support, string> = { editable: "bg-emerald-500", partial: "bg-amber-500", "view-only": "bg-text-tertiary" };
const DOT_LABEL: Record<Support, string> = { editable: "Editable", partial: "Partly editable", "view-only": "View only" };

function UpdateButton({ connection, onResult }: { connection: GitConnection; onResult: (text: string, ok: boolean) => void }) {
  const host = useGitHost(connection);
  const source = useLibraryStore((s) => s.source)!;
  const [busy, setBusy] = useState(false);

  const update = async () => {
    setBusy(true);
    try {
      const { scanRepository } = await import("@/lib/repo-scan");
      const analysis = await scanRepository(readerSource(host, source.branch), { repo: source.repo, ref: source.branch });
      const summary = useLibraryStore.getState().updateComponents(analysis);
      useGitStore.getState().setAnalysis(analysis);
      onResult(describeUpdate(summary), true);
    } catch (err) {
      onResult(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={update} disabled={busy} className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-subtle hover:text-text-primary disabled:opacity-50" title="Update from the repository" aria-label="Update from repository">
      {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
    </button>
  );
}

// Where a project's repository components are first brought in: scan and import in one step, from the
// Components panel where they will appear. (The Git panel has the same, with the scan report and the branch.)
function ImportPrompt() {
  const connection = useGitStore((s) => s.connection);
  const analysis = useGitStore((s) => s.analysis);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const host = useGitHost(connection ?? { owner: "", repo: "", token: "", defaultBranch: "" });

  // A project always has its repository; this is only here for the moment before it is loaded.
  if (!connection) return null;

  const slug = repoSlug(connection);
  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // A scan made in the Git panel is used as it is; otherwise the default branch is scanned.
      let result = analysis?.repo === slug ? analysis : null;
      if (!result) {
        const { scanRepository } = await import("@/lib/repo-scan");
        result = await scanRepository(readerSource(host, connection.defaultBranch), { repo: slug, ref: connection.defaultBranch });
        useGitStore.getState().setAnalysis(result);
      }
      const n = useLibraryStore.getState().importComponents(result);
      if (n === 0) setMessage({ text: `No React components were found in ${slug}${result.stack.framework ? "" : ". It may not be a React project, or its components may be private (a private repository needs an access token)"}.`, ok: false });
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-shrink-0 flex-col gap-2 border-b border-surface-border px-3 py-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-text-secondary"><Boxes size={12} className="text-text-tertiary" /> Repository components</p>
      <p className="text-2xs leading-relaxed text-text-tertiary">Scan {slug} and bring its components in. They appear here, under Repository.</p>
      <button onClick={run} disabled={busy} className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-60" aria-label={`Scan and import components from ${slug}`}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Boxes size={12} />} {busy ? "Scanning…" : "Scan and import components"}
      </button>
      <button onClick={() => useNavRequest.getState().ask("git")} className="self-start text-2xs text-text-tertiary underline hover:text-text-primary">Choose a branch or see the report in Git</button>
      {message && <p className={cn("text-2xs leading-relaxed", message.ok ? "text-text-tertiary" : "text-red-400")} role="status">{message.text}</p>}
    </div>
  );
}

export default function RepoComponentsSection() {
  const components = useLibraryStore((s) => s.components);
  const source = useLibraryStore((s) => s.source);
  const drafts = useLibraryStore((s) => s.drafts);
  const activeId = useLibraryStore((s) => s.activeId);
  const setActive = useLibraryStore((s) => s.setActive);
  const connection = useGitStore((s) => s.connection);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [creating, setCreating] = useState(false);

  // Until the repository has been read there is nothing to show but how to read it.
  if (!source) return <ImportPrompt />;
  const shown = components.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex flex-shrink-0 flex-col border-b border-surface-border" style={{ maxHeight: "260px" }}>
      <div className="flex h-9 flex-shrink-0 items-center gap-1.5 border-b border-surface-border px-3">
        <Boxes size={12} className="flex-shrink-0 text-text-tertiary" />
        <span className="flex-1 truncate text-xs font-medium text-text-secondary" title={`${source.repo} · ${source.branch}`}>Repository</span>
        <button onClick={() => setCreating(true)} className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-subtle hover:text-text-primary" title="New component" aria-label="New component"><Plus size={12} /></button>
        {connection && repoSlug(connection) === source.repo && <UpdateButton connection={connection} onResult={(text, ok) => setStatus({ text, ok })} />}
      </div>
      <NewComponentDialog open={creating} onOpenChange={setCreating} />
      {status && <p className={cn("flex-shrink-0 px-3 py-1 text-2xs", status.ok ? "text-text-tertiary" : "text-red-400")} role="status">{status.text}</p>}
      {components.length > 8 && (
        <div className="flex-shrink-0 px-2 pt-1.5">
          <input className="input-sm" placeholder="Filter…" aria-label="Filter repository components" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group mx-1 flex w-[calc(100%-8px)] items-center rounded transition-colors",
              c.id === activeId ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
            )}
          >
            <button onClick={() => setActive(c.id === activeId ? null : c.id)} title={`${c.file}:${c.line}`} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
              <span className="flex-1 truncate text-xs">{c.name}</span>
              {drafts.some((d) => d.id === c.id) && <span className="rounded bg-emerald-500/15 px-1 text-2xs text-emerald-500" title="Made here, not in the repository yet">new</span>}
              <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", DOT[c.support.level])} title={DOT_LABEL[c.support.level]} />
            </button>
          </div>
        ))}
        {components.length === 0 && <p className="px-3 py-2 text-2xs leading-relaxed text-text-tertiary">No components yet. Make one with the + above.</p>}
        {components.length > 0 && shown.length === 0 && <p className="px-3 py-2 text-2xs text-text-tertiary">No match.</p>}
      </div>
    </div>
  );
}
