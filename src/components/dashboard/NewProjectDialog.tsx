"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, Loader2, Lock, Plus, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GitHostError } from "@/lib/github";
import { listAll, type InstalledRepo } from "@/lib/github-app";
import { parseRepo } from "@/lib/repo-input";
import { SignInButton } from "@/components/git/AccountControls";
import { clientFor, errorMessage } from "@/components/git/hooks";
import { appTokenSource, useAccount } from "@/store/account";
import { useProjectsStore } from "@/store/projects";

// A project is one repository. Connecting it checks that it can be reached, so a typo or a missing permission
// shows here and not in the editor. Signed in with the GitHub App, the repositories to pick from are the ones the
// app is installed on; otherwise a repository is typed in, with an access token if it is private.
export default function NewProjectDialog({ trigger }: { trigger?: React.ReactNode }) {
  const router = useRouter();
  const projects = useProjectsStore((s) => s.projects);
  const { status, login, installUrl, signOut } = useAccount();
  const [open, setOpen] = useState(false);
  const [repoInput, setRepoInput] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [filter, setFilter] = useState("");
  const [repos, setRepos] = useState<InstalledRepo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const signedIn = status === "signed-in";
  const offered = status === "signed-in" || status === "signed-out";

  // Tokens already entered for other projects, so a second repository of the same owner needs no new one.
  const known = [...new Map(
    projects.flatMap((p) => (p.repo.connection?.token ? [[p.repo.connection.token, p.repo.connection] as const] : []))
  ).values()];

  // The repositories the app can be used on. A token GitHub refuses is renewed once and the list asked for again.
  const loadRepos = useCallback(async () => {
    setRepos(null);
    setListError(null);
    try {
      let token = await appTokenSource.get();
      if (!token) { setRepos([]); return; }
      try {
        setRepos((await listAll(token)).repos);
      } catch (err) {
        if (!(err instanceof GitHostError) || err.status !== 401) throw err;
        token = await appTokenSource.get(token);
        if (!token) throw err;
        setRepos((await listAll(token)).repos);
      }
    } catch (err) {
      setRepos([]);
      setListError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void useAccount.getState().load();
  }, [open]);
  useEffect(() => {
    if (open && signedIn) void loadRepos();
  }, [open, signedIn, loadRepos]);

  const shown = useMemo(() => (repos ?? []).filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(filter.trim().toLowerCase())), [repos, filter]);

  const create = async (owner: string, repo: string, typed: string, key: string) => {
    setBusy(key);
    setError(null);
    try {
      // No token typed in means the signed-in account's, when there is one.
      const { defaultBranch } = await clientFor({ owner, repo, token: typed }).getRepo();
      const project = useProjectsStore.getState().create({ owner, repo, token: typed, defaultBranch });
      setOpen(false);
      router.push(`/editor/${project.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseRepo(repoInput);
    if (!parsed) return setError("Enter the repository as owner/name");
    void create(parsed.owner, parsed.repo, token.trim(), "manual");
  };

  const form = (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Repository</span>
        <input className="input-sm" placeholder="owner/name" aria-label="Repository" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} autoComplete="off" autoFocus={!offered} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Access token (optional)</span>
        <input className="input-sm font-mono" type="password" placeholder="github_pat_…" aria-label="Access token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        <span className="text-2xs text-text-tertiary leading-relaxed">
          Public repositories can be read without one. Private repositories and opening pull requests need a fine-grained token limited to this repository with Contents and Pull requests read and write. It is stored in this browser only.
        </span>
      </label>
      {known.length > 0 && !token && (
        <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-tertiary">
          <span>Use the token from</span>
          {known.map((c) => (
            <button key={c.token} type="button" className="underline hover:text-text-primary" onClick={() => setToken(c.token)}>
              {c.owner}/{c.repo}
            </button>
          ))}
        </div>
      )}
      <button
        type="submit"
        disabled={busy !== null}
        className="h-7 bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors"
      >
        {busy === "manual" && <Loader2 size={12} className="animate-spin" />}
        Create project
      </button>
    </form>
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setBusy(null); setFilter(""); } }}>
      <Dialog.Trigger asChild>
        {trigger ?? (
          <button className="flex items-center gap-1.5 h-7 bg-accent hover:bg-accent/90 text-white text-[12px] font-medium px-3 rounded-md transition-colors">
            <Plus size={12} /> New project
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-surface-border bg-surface-raised p-4 shadow-2xl text-text-primary"
        >
          <div className="flex items-center mb-3">
            <Dialog.Title className="text-sm font-medium flex-1">New design system</Dialog.Title>
            <Dialog.Close className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle" aria-label="Close">
              <X size={13} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-secondary leading-relaxed">
              A design system is a GitHub repository of React components and their tokens. Motif reads it, lets you edit it visually and document it, and sends every change back as a pull request.
            </p>

            {status === "signed-out" && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-surface-border p-3">
                <SignInButton className="self-start" />
                <p className="text-2xs leading-relaxed text-text-tertiary">Pick a repository from the ones the Motif GitHub App is installed on. Nothing to create or paste, and pull requests are opened as you.</p>
              </div>
            )}

            {signedIn && (
              <div className="flex flex-col gap-2" data-picker>
                <div className="flex items-center gap-2 text-2xs text-text-tertiary">
                  <span className="min-w-0 flex-1 truncate" data-signed-in>Signed in{login ? <> as <span className="text-text-secondary">{login}</span></> : ""}</span>
                  <button type="button" onClick={() => void loadRepos()} aria-label="Refresh the list" title="Refresh the list" className="rounded p-1 hover:bg-surface-subtle hover:text-text-primary"><RefreshCw size={11} className={cn(repos === null && "animate-spin")} /></button>
                  <button type="button" onClick={() => void signOut()} className="underline hover:text-text-primary">Sign out</button>
                </div>
                {repos === null ? (
                  <p className="flex items-center gap-2 py-3 text-xs text-text-tertiary"><Loader2 size={12} className="animate-spin" /> Looking for repositories…</p>
                ) : (
                  <>
                    {repos.length > 8 && <input className="input-sm" placeholder="Filter repositories" aria-label="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} />}
                    {repos.length === 0 ? (
                      <p className="rounded-md border border-surface-border px-3 py-2.5 text-xs leading-relaxed text-text-secondary" data-empty>
                        {listError ?? "The Motif GitHub App isn't installed on any repository you can use yet."}
                      </p>
                    ) : (
                      <ul className="max-h-56 overflow-y-auto rounded-md border border-surface-border divide-y divide-surface-border" aria-label="Repositories">
                        {shown.map((r) => {
                          const key = `${r.owner}/${r.name}`;
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                data-repo={key}
                                disabled={busy !== null}
                                onClick={() => void create(r.owner, r.name, "", key)}
                                className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary disabled:opacity-60"
                              >
                                <span className="min-w-0 flex-1 truncate">{key}</span>
                                {r.private && <Lock size={10} className="flex-shrink-0 text-text-tertiary" aria-label="Private" />}
                                {busy === key && <Loader2 size={12} className="flex-shrink-0 animate-spin" />}
                              </button>
                            </li>
                          );
                        })}
                        {shown.length === 0 && <li className="px-2.5 py-2 text-xs text-text-tertiary">No match.</li>}
                      </ul>
                    )}
                  </>
                )}
                {installUrl && (
                  <a href={installUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-2xs text-text-tertiary underline hover:text-text-primary">
                    Not here? Install the app on more repositories <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )}

            {offered ? (
              manual ? form : (
                <button type="button" onClick={() => setManual(true)} className="self-start text-2xs text-text-tertiary underline hover:text-text-primary">
                  Use an access token, or a public repository, instead
                </button>
              )
            ) : form}

            {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
