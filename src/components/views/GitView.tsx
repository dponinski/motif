"use client";

import { useState } from "react";
import { Boxes, Loader2, Palette, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientFor, errorMessage, useBranches, useCanSend, useGitHost } from "@/components/git/hooks";
import { SignInButton } from "@/components/git/AccountControls";
import { useAccount } from "@/store/account";
import { readerSource } from "@/lib/repo-scan/source";
import { stackLine, stylingLine, supportCounts } from "@/lib/repo-scan/summary";
import { importable } from "@/lib/preview/library";
import { useLibraryStore } from "@/store/library";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import TokenSyncDialog from "@/components/git/TokenSyncDialog";

const btnPrimary = "h-7 px-3 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";
const btnSecondary = "h-7 px-3 border border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-subtle disabled:opacity-50 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors";
const fieldLabel = "text-2xs text-text-tertiary";

// ── Read the repository ───────────────────────────────────────────────────────

function ScanSection({ connection, host, initialBranch, onOpenReport }: {
  connection: GitConnection;
  host: ReturnType<typeof useGitHost>;
  initialBranch: string;
  onOpenReport: () => void;
}) {
  const { branches } = useBranches(host);
  const analysis = useGitStore((s) => s.analysis);
  const setAnalysis = useGitStore((s) => s.setAnalysis);
  const [branch, setBranch] = useState(initialBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const library = useLibraryStore((s) => s.source);
  const result = analysis?.repo === repoSlug(connection) ? analysis : null;
  const importCount = result ? importable(result.components).length : 0;

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const { scanRepository } = await import("@/lib/repo-scan");
      setAnalysis(await scanRepository(readerSource(host, branch), { repo: repoSlug(connection), ref: branch }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const counts = result ? supportCounts(result.components) : null;

  return (
    <div className="flex flex-col gap-2">
      <span className={fieldLabel}>Components and tokens</span>
      <div className="flex gap-1">
        <select className="input-sm flex-1 min-w-0" aria-label="Branch to scan" value={branch} disabled={busy} onChange={(e) => setBranch(e.target.value)}>
          {[...new Set([branch, connection.defaultBranch, ...branches])].map((b) => <option key={b}>{b}</option>)}
        </select>
        <button className={btnSecondary} onClick={scan} disabled={busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
          {result ? "Rescan" : "Scan"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && counts && (
        <div className="flex flex-col gap-1 rounded-md border border-surface-border p-2.5" role="status">
          <p className="text-xs text-text-primary">{stackLine(result.stack)}</p>
          <p className="text-xs text-text-secondary">{stylingLine(result.stack)}</p>
          <p className="text-xs text-text-secondary">{result.tokens.length} tokens · {result.components.length} components</p>
          {result.components.length > 0 && (
            <p className="text-2xs text-text-tertiary">{counts.editable} editable · {counts.partial} partly editable · {counts["view-only"]} view only</p>
          )}
          <p className="text-2xs text-text-tertiary">
            Scanned {result.ref}
            {result.warnings.length > 0 && <span className="text-amber-500"> · {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</span>}
          </p>
          <button className={cn(btnPrimary, "mt-1")} onClick={onOpenReport}>Open report</button>
        </div>
      )}
      {result && importCount > 0 && (
        <button
          className={btnSecondary}
          onClick={() => {
            const n = useLibraryStore.getState().importComponents(result);
            setImported(`Imported ${n} components. They are under Components, in the Repository group.`);
          }}
        >
          <Boxes size={12} /> {library?.repo === result.repo ? "Re-import" : "Import"} components ({importCount})
        </button>
      )}
      {imported && <p className="text-2xs leading-relaxed text-emerald-500" role="status">{imported}</p>}
      <button className={btnSecondary} onClick={() => setSyncOpen(true)}>
        <Palette size={12} /> Sync tokens
      </button>
      <TokenSyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </div>
  );
}

// ── Saving needs a token ──────────────────────────────────────────────────────

function AddToken({ connection }: { connection: GitConnection }) {
  const connect = useGitStore((s) => s.connect);
  const status = useAccount((s) => s.status);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const { canPush } = await clientFor({ owner: connection.owner, repo: connection.repo, token: value }).getRepo();
      if (!canPush) throw new Error("This token can read the repository but not write to it. It needs Contents read and write.");
      connect({ ...connection, token: value });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <SignInButton className="self-start" />
      {status === "signed-out" && <p className="text-2xs leading-relaxed text-text-tertiary">Signs you in through the Motif GitHub App: pull requests are opened as you, on the repositories the app is installed on. Nothing to create or paste.</p>}
      <form onSubmit={save} className="flex flex-col gap-3">
        <p className="text-xs text-text-secondary leading-relaxed">
          {status === "signed-out" ? "Or use an access token. " : ""}Opening pull requests (for token changes and component edits) needs an access token with Contents and Pull requests read and write. It is stored in this browser only.
        </p>
        <input className="input-sm font-mono" type="password" placeholder="github_pat_…" aria-label="Access token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button type="submit" className={btnPrimary} disabled={busy || !token.trim()}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          Add token
        </button>
      </form>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function Connected({ connection, onOpenReport }: { connection: GitConnection; onOpenReport: () => void }) {
  const host = useGitHost(connection);
  const canSend = useCanSend(connection);
  const { status, login } = useAccount();

  return (
    <div className="flex flex-col gap-4">
      <a
        href={`https://github.com/${repoSlug(connection)}`}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-text-primary hover:underline truncate"
      >
        {repoSlug(connection)}
      </a>
      <ScanSection connection={connection} host={host} initialBranch={connection.defaultBranch} onOpenReport={onOpenReport} />
      {!canSend && (
        <>
          <div className="border-t border-surface-border" />
          <AddToken connection={connection} />
        </>
      )}
      {!connection.token && status === "signed-in" && (
        <p className="text-2xs leading-relaxed text-text-tertiary" data-signed-in>Signed in with GitHub{login ? ` as ${login}` : ""}: pull requests are opened as you, through the Motif GitHub App.</p>
      )}
    </div>
  );
}

export default function GitView({ onOpenReport }: { onOpenReport: () => void }) {
  const connection = useGitStore((s) => s.connection);
  if (!connection) return null;

  return (
    <div className="flex-1 overflow-y-auto p-3 select-text">
      <Connected connection={connection} onOpenReport={onOpenReport} />
    </div>
  );
}
