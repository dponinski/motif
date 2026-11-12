"use client";

import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Support } from "@/lib/repo-scan/types";
import { useDesignSystemStore } from "@/store/design-system";
import { repoSlug, useGitStore } from "@/store/git";
import { useLibraryStore } from "@/store/library";

const DOT: Record<Support, string> = { editable: "bg-emerald-500", partial: "bg-amber-500", "view-only": "bg-text-tertiary" };

// What the centre shows before a component is opened: the design system's components, to open one from.
export default function ProjectOverview() {
  const connection = useGitStore((s) => s.connection);
  const components = useLibraryStore((s) => s.components);
  const setActive = useLibraryStore((s) => s.setActive);
  const tokens = useDesignSystemStore((s) => s.colors.length + s.typography.length + s.spacing.length + s.radii.length + s.shadows.length);

  return (
    <div className="h-full overflow-y-auto bg-surface-base px-8 py-10">
      <div className="mx-auto max-w-3xl">
        {connection && (
          <p className="mb-1 flex items-center gap-1.5 text-xs text-text-tertiary"><GitBranch size={12} /> {repoSlug(connection)}</p>
        )}
        <h1 className="text-lg font-semibold text-text-primary">{components.length > 0 ? "Choose a component" : "No components yet"}</h1>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          {components.length > 0
            ? `${components.length} components and ${tokens} tokens. Open one to see it running, change it visually and send the change as a pull request.`
            : "Scan the repository from the Components panel to bring its React components in. They open here, running as they do in the repository."}
        </p>
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
