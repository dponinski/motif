"use client";

import { BookOpen, GitBranch, LayoutTemplate, Palette, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type NavItem = "components" | "tokens" | "docs" | "chat" | "git" | "repo";

export default function AppNav({
  activeNav,
  setActiveNav,
}: {
  activeNav: NavItem | null;
  setActiveNav: (item: NavItem | null) => void;
}) {
  const items: { id: NavItem; icon: React.ReactNode; label: string }[] = [
    { id: "components", icon: <LayoutTemplate size={16} />, label: "Components" },
    { id: "tokens", icon: <Palette size={16} />, label: "Tokens" },
    { id: "docs", icon: <BookOpen size={16} />, label: "Docs" },
    { id: "chat", icon: <Sparkles size={16} />, label: "Chat" },
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
          className={cn(
            "w-10 h-10 flex items-center justify-center transition-colors",
            (activeNav === "repo" ? "git" : activeNav) === item.id
              ? "bg-accent/15 text-accent"
              : "text-text-tertiary hover:text-text-primary hover:bg-surface-subtle"
          )}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
