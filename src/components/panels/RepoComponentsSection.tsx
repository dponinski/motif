"use client";

import { useState } from "react";
import { Boxes, LayoutTemplate, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeUpdate } from "@/lib/preview/library";
import { readerSource } from "@/lib/repo-scan/source";
import type { Support } from "@/lib/repo-scan/types";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { placeOnCanvas } from "./place";

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

export default function RepoComponentsSection() {
  const components = useLibraryStore((s) => s.components);
  const source = useLibraryStore((s) => s.source);
  const activeId = useLibraryStore((s) => s.activeId);
  const setActive = useLibraryStore((s) => s.setActive);
  const connection = useGitStore((s) => s.connection);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  if (!source || components.length === 0) return null;
  const shown = components.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex flex-shrink-0 flex-col border-b border-surface-border" style={{ maxHeight: "260px" }}>
      <div className="flex h-9 flex-shrink-0 items-center gap-1.5 border-b border-surface-border px-3">
        <Boxes size={12} className="flex-shrink-0 text-text-tertiary" />
        <span className="flex-1 truncate text-xs font-medium text-text-secondary" title={`${source.repo} · ${source.branch}`}>Repository</span>
        {connection && repoSlug(connection) === source.repo && <UpdateButton connection={connection} onResult={(text, ok) => setStatus({ text, ok })} />}
      </div>
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
              <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", DOT[c.support.level])} title={DOT_LABEL[c.support.level]} />
            </button>
            <button
              onClick={() => placeOnCanvas(c)}
              className="mr-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-tertiary opacity-0 transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Place ${c.name} on canvas`}
              title="Place on the design canvas"
            >
              <LayoutTemplate size={11} />
            </button>
          </div>
        ))}
        {shown.length === 0 && <p className="px-3 py-2 text-2xs text-text-tertiary">No match.</p>}
      </div>
    </div>
  );
}
