"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createGitHubClient } from "@/lib/github";
import { useGitStore } from "@/store/git";
import { errorMessage } from "./hooks";

function parseRepo(input: string): { owner: string; repo: string } | null {
  const match = input.trim().replace(/\/$/, "").replace(/\.git$/, "").match(/(?:^|github\.com[/:])([\w.-]+)\/([\w.-]+)$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

export default function GitConnectForm() {
  const connect = useGitStore((s) => s.connect);
  const [repoInput, setRepoInput] = useState("");
  const [token, setToken] = useState("");
  const [dir, setDir] = useState("design");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseRepo(repoInput);
    if (!parsed) return setError("Enter the repository as owner/name");
    if (!token.trim()) return setError("Enter an access token");
    setBusy(true);
    setError(null);
    try {
      const conn = { ...parsed, token: token.trim() };
      const { defaultBranch } = await createGitHubClient(conn).getRepo();
      connect({ ...conn, dir: dir.trim().replace(/^\/+|\/+$/g, ""), defaultBranch });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-xs text-text-secondary leading-relaxed">
        Connect a GitHub repository to store design files as JSON on a branch.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Repository</span>
        <input className="input-sm" placeholder="owner/name" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Access token</span>
        <input className="input-sm font-mono" type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        <span className="text-2xs text-text-tertiary leading-relaxed">
          Use a fine-grained token limited to this repository with Contents read and write. It is stored in this browser only.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Design folder</span>
        <input className="input-sm font-mono" value={dir} onChange={(e) => setDir(e.target.value)} autoComplete="off" />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="h-7 bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors"
      >
        {busy && <Loader2 size={12} className="animate-spin" />}
        Connect
      </button>
    </form>
  );
}
