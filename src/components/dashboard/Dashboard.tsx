"use client";

import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Monitor, Moon, MoreHorizontal, Settings2, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useThemeStore, type ThemeMode } from "@/store/theme";
import { clearLegacyStorage, useProjectsStore, type Project } from "@/store/projects";
import { useSync } from "@/store/sync";
import { useAuth } from "@/store/auth";
import { useTeams } from "@/store/teams";
import NewTeamDialog from "@/components/teams/NewTeamDialog";
import TeamDialog from "@/components/teams/TeamDialog";
import { AccountNotices, useAccountInit } from "@/components/git/AccountControls";
import AuthDialog from "@/components/auth/AuthDialog";
import UserMenu from "@/components/auth/UserMenu";
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
  const { rename, remove } = useProjectsStore(useShallow((s) => ({ rename: s.rename, remove: s.remove })));
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

  // Signed in, a project is saved to the account, and deleting it deletes it everywhere.
  const saved = useSync((s) => s.userId !== null && s.status !== "off" && !!s.meta[project.id]);
  const teams = useTeams((s) => s.teams);
  const role = useTeams((s) => s.roleIn(project.teamId));
  const teamName = useTeams((s) => s.nameOf(project.teamId));
  const [moveError, setMoveError] = useState<string | null>(null);
  // A team's design system is deleted for everyone, by an owner; a member can't.
  const canDelete = !project.teamId || role === "owner";
  // Where it can go: from a person's own into a team they are in; from a team (as its owner) to their own or another team.
  const moves: { teamId: string | null; label: string }[] = saved && teams.length > 0
    ? [...(project.teamId && role === "owner" ? [{ teamId: null, label: "My projects" }] : []), ...teams.filter((t) => t.id !== project.teamId && (!project.teamId || role === "owner")).map((t) => ({ teamId: t.id, label: t.name }))]
    : [];
  const move = async (teamId: string | null) => { setMenu(false); setMoveError(null); const e = await useSync.getState().move(project.id, teamId); if (e) setMoveError(e); };
  const connection = project.repo.connection;
  const t = project.tokens;
  const tokenCount = t.tokens.length + t.compositions.length;
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
            <div className="absolute right-0 top-7 z-10 w-44 overflow-hidden rounded-md border border-surface-border bg-surface-raised text-[12px] shadow-lg" onClick={(e) => e.stopPropagation()}>
              <button className="w-full px-3 py-1.5 text-left text-text-secondary hover:bg-surface-subtle hover:text-text-primary" onClick={() => { setEditing(true); setMenu(false); }}>
                Rename
              </button>
              {moves.map((m) => (
                <button key={m.teamId ?? "own"} className="w-full truncate px-3 py-1.5 text-left text-text-secondary hover:bg-surface-subtle hover:text-text-primary" onClick={() => void move(m.teamId)}>
                  Move to {m.label}
                </button>
              ))}
              {canDelete && (
                <button className="w-full px-3 py-1.5 text-left text-red-400 hover:bg-red-400/10" onClick={() => { setConfirming(true); setMenu(false); }}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-text-secondary">
        {project.library.components.length > 0
          ? `${plural(project.library.components.length, "component")} · ${plural(tokenCount, "token")}`
          : "Not scanned yet"}
      </p>
      <p className="text-[11px] text-text-tertiary" data-updated>Updated {formatDate(project.updatedAt)}{project.teamId && project.updatedBy ? ` · by ${project.updatedBy}` : ""}</p>
      {moveError && <p className="text-[11px] text-red-400" role="alert">{moveError}</p>}

      {confirming && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-surface-raised/95 p-4 text-center" onClick={(e) => e.stopPropagation()}>
          <p className="text-[12px] text-text-primary">{project.teamId ? `Delete this design system for everyone in ${teamName ?? "the team"}?` : saved ? "Delete this project from your account?" : "Delete this project from this browser?"}</p>
          <p className="text-[11px] text-text-tertiary">{project.teamId ? "Every member loses it. The repository is not touched." : saved ? "It is removed from all your devices. The repository is not touched." : "The repository is not touched. Unsent edits to it are kept."}</p>
          <div className="flex gap-2">
            <button className="h-7 rounded-md border border-surface-border px-3 text-[12px] text-text-secondary hover:bg-surface-subtle" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="h-7 rounded-md bg-red-500 px-3 text-[12px] font-medium text-white hover:bg-red-500/90" onClick={() => remove(project.id)}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// A group of design systems on the dashboard: a person's own, or a team's, with who is in the team.
function Section({ title, children, team }: { title: string; children: React.ReactNode; team?: { id: string; role: string; members: number } }) {
  const [managing, setManaging] = useState(false);
  return (
    <section className="mb-8" data-section={team ? `team:${title}` : "personal"}>
      <div className="mb-3 flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{title}</p>
        {team && (
          <>
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-text-tertiary">{team.role === "owner" ? "Owner" : "Member"} · {plural(team.members, "person")}</span>
            <button className="flex items-center gap-1 rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label={`Manage ${title}`} onClick={() => setManaging(true)}>
              <Settings2 size={12} />
            </button>
            <TeamDialog teamId={team.id} open={managing} onOpenChange={setManaging} />
          </>
        )}
      </div>
      {children}
    </section>
  );
}

const GRID = "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]";

export default function Dashboard() {
  const router = useRouter();
  const projects = useProjectsStore((s) => s.projects);
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore(useShallow((s) => ({ mode: s.mode, setMode: s.setMode })));

  // Design files, repository connections and token sets kept in this browser by earlier versions are not carried over.
  useEffect(() => clearLegacyStorage(), []);
  useAccountInit();

  const themeOptions: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: "light", icon: <Sun size={12} />, label: "Light" },
    { mode: "system", icon: <Monitor size={12} />, label: "System" },
    { mode: "dark", icon: <Moon size={12} />, label: "Dark" },
  ];
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const user = useAuth((s) => s.user);
  // Who is in which team, and invitations, are looked at when the dashboard opens (sync asks only now and then).
  const signedInAs = user?.id ?? null;
  useEffect(() => { if (signedInAs) void useTeams.getState().refresh(); }, [signedInAs]);
  const teams = useTeams((s) => s.teams);
  const invites = useTeams((s) => s.invites);
  const accept = useTeams((s) => s.accept);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const personal = sorted.filter((p) => !p.teamId);
  // Design systems of a team this browser hasn't heard about yet (the list of teams arrives with the next sync).
  const strangers = [...new Set(sorted.flatMap((p) => (p.teamId && !teams.some((t) => t.id === p.teamId) ? [p.teamId] : [])))];

  return (
    <div className="min-h-screen bg-surface-base text-text-primary select-none">
      <AccountNotices />
      <AuthDialog />
      <header data-bar className="flex items-center justify-between h-bar px-6 border-b border-surface-border-subtle">
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
          <UserMenu />
          {user && !user.guest && <NewTeamDialog />}
          {(projects.length > 0 || teams.length > 0) && <NewProjectDialog />}
        </div>
      </header>

      <main className="px-6 pt-8 pb-16">
        {invites.length > 0 && (
          <section className="mb-8 flex flex-col gap-2" aria-label="Invitations for you">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Invitations for you</p>
            {invites.map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-lg border border-accent/40 bg-surface-raised px-4 py-3" data-invitation={i.teamName}>
                <p className="min-w-0 flex-1 text-[12px] text-text-primary">{i.invitedBy ?? "Someone"} invited you to the team <span className="font-semibold">{i.teamName}</span>.</p>
                <button
                  className="h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent/90"
                  onClick={async () => { setInviteError(null); const r = await accept({ inviteId: i.id }); if (r.error) setInviteError(r.error); else void useSync.getState().sync(); }}
                >
                  Join
                </button>
              </div>
            ))}
            {inviteError && <p className="text-[12px] text-red-400" role="alert">{inviteError}</p>}
          </section>
        )}
        {sorted.length === 0 && teams.length === 0 ? (
          invites.length > 0 ? null : (
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
          )
        ) : (
          <>
            {(personal.length > 0 || (teams.length === 0 && strangers.length === 0)) && (
              <Section title={teams.length > 0 ? "My design systems" : "Design systems"}>
                <div className={GRID}>
                  {personal.map((project) => (
                    <ProjectCard key={project.id} project={project} onOpen={() => router.push(`/editor/${project.id}`)} />
                  ))}
                </div>
              </Section>
            )}
            {teams.map((team) => {
              const shared = sorted.filter((p) => p.teamId === team.id);
              return (
                <Section key={team.id} title={team.name} team={{ id: team.id, role: team.role, members: team.members.length }}>
                  {shared.length === 0 ? (
                    <p className="text-[12px] text-text-tertiary">No design systems yet. Make a new one in this team, or move one of yours here.</p>
                  ) : (
                    <div className={GRID}>
                      {shared.map((project) => (
                        <ProjectCard key={project.id} project={project} onOpen={() => router.push(`/editor/${project.id}`)} />
                      ))}
                    </div>
                  )}
                </Section>
              );
            })}
            {strangers.length > 0 && (
              <Section title="Shared with you">
                <div className={GRID}>
                  {sorted.filter((p) => p.teamId && strangers.includes(p.teamId)).map((project) => (
                    <ProjectCard key={project.id} project={project} onOpen={() => router.push(`/editor/${project.id}`)} />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
