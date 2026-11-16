"use client";

import { BookOpen, GitBranch, LayoutTemplate, Palette, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { statusOf } from "@/lib/work/sync";
import { changedFiles, useEditStore } from "@/store/edit";
import { useGitStore } from "@/store/git";
import { useAuth } from "@/store/auth";
import { usePullStatus } from "@/store/pull";
import { useWorkRuntime } from "@/store/work";
import { useTokenChanges } from "./work/useWork";

export type NavItem = "components" | "tokens" | "docs" | "chat" | "git" | "repo";

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
  const runtime = useWorkRuntime(useShallow((s) => ({ refreshed: s.refreshed, syncing: s.syncing, error: s.error, tokenNote: s.tokenNote, stale: s.stale })));
  const tokens = useTokenChanges().length;
  const behind = usePullStatus((s) => s.behind);
  const guest = useAuth((s) => !!s.user?.guest);
  const status = useMemo(() => statusOf({
    changed: changedFiles({ history, index, bases }).map((f) => ({ path: f.path, before: f.before, after: f.after, sha: f.sha })),
    work, refreshed: runtime.refreshed, syncing: runtime.syncing, error: runtime.error, tokens, tokenNote: runtime.tokenNote,
    stale: runtime.stale.filter((p) => !(work && p in work.pushed)).length,
  }), [history, index, bases, work, tokens, runtime.refreshed, runtime.syncing, runtime.error, runtime.tokenNote, runtime.stale]);
  const dot = { none: "", waiting: "bg-amber-500", syncing: "bg-accent", synced: "bg-emerald-500", attention: "bg-red-400" }[status.kind];

  const items: { id: NavItem; icon: React.ReactNode; label: string }[] = [
    { id: "components", icon: <LayoutTemplate size={16} />, label: "Components" },
    { id: "tokens", icon: <Palette size={16} />, label: "Tokens" },
    { id: "docs", icon: <BookOpen size={16} />, label: "Docs" },
    // The assistant is paid for by the server: it isn't offered to someone a team brought in.
    ...(guest ? [] : [{ id: "chat" as const, icon: <Sparkles size={16} />, label: "Chat" }]),
    // One place for the repository: pulling what it has and pushing what is waiting. The dot says how that is going.
    { id: "git", icon: <GitBranch size={16} />, label: connected ? `Source control: ${status.text}` : "Source control" },
  ];

  return (
    <nav className="w-10 flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised">
      {/* Logo */}
      <Link
        href="/"
        title="Back to projects"
        data-bar
        className="w-10 h-bar flex items-center justify-center border-b border-surface-border hover:bg-surface-subtle transition-colors flex-shrink-0"
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
          title={item.id === "git" ? "Source control" : item.label}
          aria-label={item.id === "git" ? "Source control" : undefined}
          className={cn(
            "w-10 h-10 flex items-center justify-center transition-colors",
            (activeNav === "repo" ? "git" : activeNav) === item.id
              ? "bg-accent/15 text-accent"
              : "text-text-tertiary hover:text-text-primary hover:bg-surface-subtle"
          )}
        >
          <span className="relative">
            {item.icon}
            {item.id === "git" && connected && behind && <span data-testid="behind-dot" className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-surface-raised" />}
            {item.id === "git" && connected && dot && <span data-testid="sync-dot" data-status={status.kind} className={cn("absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-surface-raised", dot)} />}
          </span>
        </button>
      ))}
    </nav>
  );
}
