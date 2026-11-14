"use client";

import { BookOpen, GitBranch, GitPullRequest, LayoutTemplate, Palette, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { statusOf } from "@/lib/work/sync";
import { changedFiles, useEditStore } from "@/store/edit";
import { useGitStore } from "@/store/git";
import { useWorkRuntime } from "@/store/work";

export type NavItem = "components" | "tokens" | "docs" | "chat" | "git" | "repo" | "sync";

export default function AppNav({
  activeNav,
  setActiveNav,
}: {
  activeNav: NavItem | null;
  setActiveNav: (item: NavItem | null) => void;
}) {
  const history = useEditStore((s) => s.history);
  const index = useEditStore((s) => s.index);
  const bases = useEditStore((s) => s.bases);
  const work = useGitStore((s) => s.work ?? null);
  const connected = useGitStore((s) => s.connection !== null);
  const runtime = useWorkRuntime();
  const status = useMemo(() => statusOf({
    changed: changedFiles({ history, index, bases }).map((f) => ({ path: f.path, before: f.before, after: f.after, sha: f.sha })),
    work, refreshed: runtime.refreshed, syncing: runtime.syncing, error: runtime.error,
    stale: runtime.stale.filter((p) => !(work && p in work.pushed)).length,
  }), [history, index, bases, work, runtime.refreshed, runtime.syncing, runtime.error, runtime.stale]);
  const dot = { none: "", waiting: "bg-amber-500", syncing: "bg-accent", synced: "bg-emerald-500", attention: "bg-red-400" }[status.kind];

  const items: { id: NavItem; icon: React.ReactNode; label: string }[] = [
    { id: "components", icon: <LayoutTemplate size={16} />, label: "Components" },
    { id: "tokens", icon: <Palette size={16} />, label: "Tokens" },
    { id: "docs", icon: <BookOpen size={16} />, label: "Docs" },
    { id: "chat", icon: <Sparkles size={16} />, label: "Chat" },
    ...(connected ? [{ id: "sync" as const, icon: <GitPullRequest size={16} />, label: `Sync: ${status.text}` }] : []),
    { id: "git", icon: <GitBranch size={16} />, label: "Git" },
  ];

  return (
    <nav className="w-10 flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised">
      {/* Logo */}
      <Link
        href="/"
        title="Back to projects"
        className="w-10 h-10 flex items-center justify-center border-b border-surface-border hover:bg-surface-subtle transition-colors flex-shrink-0"
      >
        <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center">
          <span className="text-white text-xs font-bold leading-none">M</span>
        </div>
      </Link>

      {/* Nav items */}
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => setActiveNav(activeNav === item.id ? null : item.id)}
          title={item.label}
          aria-label={item.id === "sync" ? "Sync" : undefined}
          className={cn(
            "w-10 h-10 flex items-center justify-center transition-colors",
            (activeNav === "repo" ? "git" : activeNav) === item.id
              ? "bg-accent/15 text-accent"
              : "text-text-tertiary hover:text-text-primary hover:bg-surface-subtle"
          )}
        >
          <span className="relative">
            {item.icon}
            {item.id === "sync" && dot && <span data-testid="sync-dot" data-status={status.kind} className={cn("absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-surface-raised", dot)} />}
          </span>
        </button>
      ))}
    </nav>
  );
}
