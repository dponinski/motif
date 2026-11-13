"use client";

import { useEffect, useState } from "react";
import { GitBranch, Layers, Loader2, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Support } from "@/lib/repo-scan/types";
import { SignInButton } from "@/components/git/AccountControls";
import FirstCommit from "@/components/git/FirstCommit";
import FrameworkDialog from "@/components/git/FrameworkDialog";
import { useGitHost } from "@/components/git/hooks";
import { useDesignSystemStore } from "@/store/design-system";
import { repoSlug, useGitStore } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { useNavRequest } from "@/store/nav";
import { useReadStatus } from "@/store/read-status";
import { useReadRepository } from "./useReadRepository";

const DOT: Record<Support, string> = { editable: "bg-emerald-500", partial: "bg-amber-500", "view-only": "bg-text-tertiary" };
const button = "flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors disabled:opacity-60";

// What the centre shows before a component is opened: the design system's components to open one from, or, in a
// repository that has none, where to start.
export default function ProjectOverview() {
  const connection = useGitStore((s) => s.connection);
  const analysis = useGitStore((s) => s.analysis);
  const components = useLibraryStore((s) => s.components);
  const setActive = useLibraryStore((s) => s.setActive);
  const tokens = useDesignSystemStore((s) => s.colors.length + s.typography.length + s.spacing.length + s.radii.length + s.shadows.length);
  const { busy, error } = useReadStatus();
  const read = useReadRepository();
  const host = useGitHost(connection ?? { owner: "", repo: "", token: "", defaultBranch: "main" });
  const [empty, setEmpty] = useState(false);
  const [frameworkOpen, setFrameworkOpen] = useState(false);
  const none = !!analysis && components.length === 0;

  // Whether there is a repository to build on at all: asked only when there is nothing to show.
  useEffect(() => {
    if (!connection || !none) { setEmpty(false); return; }
    let live = true;
    host.isEmpty().then((e) => { if (live) setEmpty(e); }, () => { if (live) setEmpty(false); });
    return () => { live = false; };
  }, [connection, none, host]);

  const header = connection && (
    <p className="mb-1 flex items-center gap-1.5 text-xs text-text-tertiary"><GitBranch size={12} /> {repoSlug(connection)}</p>
  );

  if (!analysis) {
    return (
      <div className="h-full overflow-y-auto bg-surface-base px-8 py-10">
        <div className="mx-auto max-w-3xl">
          {header}
          {error ? (
            <>
              <h1 className="text-lg font-semibold text-text-primary">The repository couldn&apos;t be read</h1>
              <p className="mt-1 break-words text-xs leading-relaxed text-red-400" role="alert">{error}</p>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => void read()} className={cn(button, "border border-surface-border text-text-secondary hover:bg-surface-subtle hover:text-text-primary")}>Try again</button>
                <SignInButton />
              </div>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-text-secondary" role="status" data-reading>
              <Loader2 size={14} className={cn("animate-spin", !busy && "opacity-0")} /> Reading the repository…
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-surface-base px-8 py-10">
      <div className="mx-auto max-w-3xl">
        {header}
        <h1 className="text-lg font-semibold text-text-primary">{components.length > 0 ? "Choose a component" : "Start building"}</h1>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          {components.length > 0
            ? `${components.length} components and ${tokens} tokens. Open one to see it running, change it visually and send the change as a pull request.`
            : "This repository has no components yet. Add your design tokens, and every change you make is sent to the repository as a pull request."}
        </p>

        {none && connection && empty && <FirstCommit connection={connection} onDone={() => setEmpty(false)} />}

        {none && (
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2" data-start>
            <button
              onClick={() => useNavRequest.getState().ask("tokens")}
              className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-raised px-3 py-3 text-left transition-colors hover:border-accent/50"
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary"><Palette size={13} /> Add tokens</span>
              <span className="text-2xs leading-relaxed text-text-tertiary">Colors, type, spacing and more, kept as CSS variables in the repository.{tokens > 0 ? ` ${tokens} so far.` : ""}</span>
            </button>
            {analysis.stack.tailwindVersion === null && (
              <button
                onClick={() => setFrameworkOpen(true)}
                className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-raised px-3 py-3 text-left transition-colors hover:border-accent/50"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary"><Layers size={13} /> Add a framework</span>
                <span className="text-2xs leading-relaxed text-text-tertiary">Add Tailwind CSS to the repository like a dependency, to style with its classes.</span>
              </button>
            )}
          </div>
        )}
        <FrameworkDialog open={frameworkOpen} onOpenChange={setFrameworkOpen} />

        {components.length > 0 && (
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
            {components.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className="flex flex-col gap-0.5 rounded-lg border border-surface-border bg-surface-raised px-3 py-2.5 text-left transition-colors hover:border-accent/50"
              >
                <span className="flex items-center gap-1.5">
                  <span className="flex-1 truncate text-sm font-medium text-text-primary">{c.name}</span>
                  <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", DOT[c.support.level])} />
                </span>
                <span className="truncate font-mono text-2xs text-text-tertiary">{c.file}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
