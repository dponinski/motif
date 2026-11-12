"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Monitor, Moon, MoreHorizontal, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useThemeStore, type ThemeMode } from "@/store/theme";
import { clearLegacyStorage, useProjectsStore, type Project } from "@/store/projects";
import NewProjectDialog from "./NewProjectDialog";

function formatDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const { rename, remove } = useProjectsStore();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(project.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const connection = project.repo.connection;
  const t = project.tokens;
  const tokenCount = t.colors.length + t.typography.length + t.spacing.length + t.radii.length + t.shadows.length;
  const commit = () => { setEditing(false); rename(project.id, name.trim() || project.name); };

  return (
    <div
      className="group relative flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-4 hover:border-accent/50 transition-colors cursor-pointer"
      data-project={project.id}
      onClick={() => { if (!editing && !confirming) onOpen(); }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              className="w-full bg-transparent border-b border-accent text-[13px] font-semibold text-text-primary outline-none"
              value={name}
              autoFocus
              aria-label="Project name"
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") { setEditing(false); setName(project.name); }
              }}
            />
          ) : (
            <p className="truncate text-[13px] font-semibold text-text-primary">{project.name}</p>
          )}
          {connection && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-text-tertiary">
              <GitBranch size={11} className="flex-shrink-0" />
              {connection.owner}/{connection.repo}
            </p>
          )}
        </div>
        <div className="relative" ref={menuRef}>
          <button
            aria-label="Project actions"
            className="rounded p-1 text-text-tertiary opacity-0 hover:bg-surface-subtle hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
            onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menu && (
            <div className="absolute right-0 top-7 z-10 w-36 overflow-hidden rounded-md border border-surface-border bg-surface-raised text-[12px] shadow-lg" onClick={(e) => e.stopPropagation()}>
              <button className="w-full px-3 py-1.5 text-left text-text-secondary hover:bg-surface-subtle hover:text-text-primary" onClick={() => { setEditing(true); setMenu(false); }}>
                Rename
              </button>
              <button className="w-full px-3 py-1.5 text-left text-red-400 hover:bg-red-400/10" onClick={() => { setConfirming(true); setMenu(false); }}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-text-secondary">
        {project.library.components.length > 0
          ? `${plural(project.library.components.length, "component")} · ${plural(tokenCount, "token")}`
          : "Not scanned yet"}
      </p>
      <p className="text-[11px] text-text-tertiary">Updated {formatDate(project.updatedAt)}</p>

      {confirming && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-surface-raised/95 p-4 text-center" onClick={(e) => e.stopPropagation()}>
          <p className="text-[12px] text-text-primary">Delete this project from this browser?</p>
          <p className="text-[11px] text-text-tertiary">The repository is not touched. Unsent edits to it are kept.</p>
          <div className="flex gap-2">
            <button className="h-7 rounded-md border border-surface-border px-3 text-[12px] text-text-secondary hover:bg-surface-subtle" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="h-7 rounded-md bg-red-500 px-3 text-[12px] font-medium text-white hover:bg-red-500/90" onClick={() => remove(project.id)}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const projects = useProjectsStore((s) => s.projects);
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();

  // Design files, repository connections and token sets kept in this browser by earlier versions are not carried over.
  useEffect(() => clearLegacyStorage(), []);

  const themeOptions: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: "light", icon: <Sun size={12} />, label: "Light" },
    { mode: "system", icon: <Monitor size={12} />, label: "System" },
    { mode: "dark", icon: <Moon size={12} />, label: "Dark" },
  ];
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="min-h-screen bg-surface-base text-text-primary select-none">
      <header className="flex items-center justify-between h-12 px-6 border-b border-surface-border-subtle">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[11px] font-bold leading-none">M</span>
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-text-primary">Motif</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-surface-subtle rounded p-0.5">
            {themeOptions.map(({ mode, icon, label }) => (
              <button
                key={mode}
                title={label}
                onClick={() => setThemeMode(mode)}
                className={cn(
                  "w-6 h-6 flex items-center justify-center rounded transition-colors",
                  themeMode === mode ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                {icon}
              </button>
            ))}
          </div>
          {projects.length > 0 && <NewProjectDialog />}
        </div>
      </header>

      <main className="px-6 pt-8 pb-16">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[55vh] gap-5 text-center">
            <div>
              <p className="text-[15px] font-medium text-text-primary mb-1">Connect your design system</p>
              <p className="max-w-sm text-[12px] leading-relaxed text-text-secondary">
                Motif works on the React components and tokens in a GitHub repository. Connect one to preview, edit and document them, with every change sent back as a pull request.
              </p>
            </div>
            <NewProjectDialog
              trigger={
                <button className="bg-accent hover:bg-accent/90 text-white text-[13px] font-medium px-5 py-2 rounded-lg transition-colors">
                  Connect a repository
                </button>
              }
            />
          </div>
        ) : (
          <>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Design systems</p>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {sorted.map((project) => (
                <ProjectCard key={project.id} project={project} onOpen={() => router.push(`/editor/${project.id}`)} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
