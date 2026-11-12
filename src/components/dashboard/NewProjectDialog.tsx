"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Plus, X } from "lucide-react";
import { createGitHubClient } from "@/lib/github";
import { parseRepo } from "@/lib/repo-input";
import { errorMessage } from "@/components/git/hooks";
import { useProjectsStore } from "@/store/projects";

// A project is one repository. Connecting it checks that it can be reached, so a typo or a missing token shows
// here and not in the editor.
export default function NewProjectDialog({ trigger }: { trigger?: React.ReactNode }) {
  const router = useRouter();
  const projects = useProjectsStore((s) => s.projects);
  const [open, setOpen] = useState(false);
  const [repoInput, setRepoInput] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tokens already entered for other projects, so a second repository of the same owner needs no new one.
  const known = [...new Map(
    projects.flatMap((p) => (p.repo.connection?.token ? [[p.repo.connection.token, p.repo.connection] as const] : []))
  ).values()];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseRepo(repoInput);
    if (!parsed) return setError("Enter the repository as owner/name");
    setBusy(true);
    setError(null);
    try {
      const { defaultBranch } = await createGitHubClient({ ...parsed, token: token.trim() }).getRepo();
      const project = useProjectsStore.getState().create({ ...parsed, token: token.trim(), defaultBranch });
      setOpen(false);
      router.push(`/editor/${project.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setBusy(false); } }}>
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
          className="fixed left-1/2 top-1/2 z-50 w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-surface-border bg-surface-raised p-4 shadow-2xl text-text-primary"
        >
          <div className="flex items-center mb-3">
            <Dialog.Title className="text-sm font-medium flex-1">New design system</Dialog.Title>
            <Dialog.Close className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle" aria-label="Close">
              <X size={13} />
            </Dialog.Close>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-xs text-text-secondary leading-relaxed">
              A design system is a GitHub repository of React components and their tokens. Motif reads it, lets you edit it visually and document it, and sends every change back as a pull request.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-2xs text-text-tertiary">Repository</span>
              <input className="input-sm" placeholder="owner/name" aria-label="Repository" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} autoComplete="off" autoFocus />
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
            {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="h-7 bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Create project
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
