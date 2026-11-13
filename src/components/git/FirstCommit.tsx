"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createFirstCommit } from "@/lib/repo-init";
import { SignInButton } from "@/components/git/AccountControls";
import { errorMessage, useCanSend, useGitHost } from "@/components/git/hooks";
import { useReadRepository } from "@/components/stage/useReadRepository";
import type { GitConnection } from "@/store/git";

// A repository with no commits has nothing to build on: a branch, and so a pull request, needs a first commit. It is made
// here, on the person's say-so, and it is a README only.
export default function FirstCommit({ connection, onDone }: { connection: GitConnection; onDone: () => void }) {
  const host = useGitHost(connection);
  const canSend = useCanSend(connection);
  const read = useReadRepository();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createFirstCommit(host, connection.repo);
      onDone();
      await read();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-surface-border bg-surface-raised p-4" data-first-commit>
      <p className="text-sm font-medium text-text-primary">This repository has no commits yet</p>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Changes are sent as a branch and a pull request, which need something to start from. Motif can create the first commit for you: a
        README.md on <span className="font-mono">{connection.defaultBranch}</span>, nothing else. This is the only change Motif makes straight to that branch.
      </p>
      {canSend ? (
        <button onClick={() => void create()} disabled={busy} className={cn("flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-60", "mt-3")}>
          {busy && <Loader2 size={12} className="animate-spin" />} Create README.md on {connection.defaultBranch}
        </button>
      ) : (
        <div className="mt-3 flex flex-col items-start gap-2">
          <SignInButton />
          <p className="text-2xs text-text-tertiary">Sign in with GitHub (or add an access token in the Git panel) to write to the repository.</p>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400" role="alert">{error}</p>}
    </div>
  );
}

