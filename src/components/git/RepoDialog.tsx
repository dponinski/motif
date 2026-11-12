"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { FileJson, GitBranch, Loader2, X } from "lucide-react";
import type { RemoteEntry } from "@/lib/github";
import { DOCUMENT_EXTENSION, parseDocument } from "@/lib/motif-document";
import { useFilesStore } from "@/store/files";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import GitConnectForm from "./GitConnectForm";
import { errorMessage, useBranches, useGitHost } from "./hooks";

function RepoBrowser({ connection }: { connection: GitConnection }) {
  const router = useRouter();
  const host = useGitHost(connection);
  const disconnect = useGitStore((s) => s.disconnect);
  const { branches, error: branchError } = useBranches(host);
  const [branch, setBranch] = useState(connection.defaultBranch);
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setEntries(null);
    setError(null);
    host.listDocuments(connection.dir, branch).then(
      (list) => { if (!stale) setEntries(list); },
      (err) => { if (!stale) { setEntries([]); setError(errorMessage(err)); } }
    );
    return () => { stale = true; };
  }, [host, connection.dir, branch]);

  const open = async (entry: RemoteEntry) => {
    setOpening(entry.path);
    setError(null);
    try {
      const remote = await host.getFile(entry.path, branch);
      if (!remote) throw new Error(`${entry.name} is no longer on ${branch}`);
      const doc = parseDocument(remote.text);
      const { files, importDocument } = useFilesStore.getState();
      if (!files.some((f) => f.id === doc.id)) {
        importDocument(doc, { repo: repoSlug(connection), branch, path: entry.path, baseSha: remote.sha });
      }
      router.push(`/editor/${doc.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setOpening(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-text-primary truncate flex-1">{repoSlug(connection)}</span>
        <button className="text-2xs text-text-tertiary hover:text-text-primary underline" onClick={disconnect}>
          Disconnect
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Branch</span>
        <select className="input-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
          {[...new Set([connection.defaultBranch, ...branches])].map((b) => <option key={b}>{b}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">
          Design files in <span className="font-mono">{connection.dir || "/"}</span>
        </span>
        {entries === null ? (
          <div className="flex items-center gap-2 text-xs text-text-tertiary py-3">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : entries.length === 0 ? (
          <p className="text-xs text-text-tertiary py-3 leading-relaxed">
            No design files on this branch yet. Open a file and push it from the Git panel in the editor.
          </p>
        ) : (
          <ul className="border border-surface-border rounded-md divide-y divide-surface-border max-h-64 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.path}>
                <button
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle disabled:opacity-60 transition-colors"
                  onClick={() => open(entry)}
                  disabled={opening !== null}
                >
                  {opening === entry.path
                    ? <Loader2 size={12} className="animate-spin flex-shrink-0" />
                    : <FileJson size={12} className="text-text-tertiary flex-shrink-0" />}
                  <span className="truncate flex-1">{entry.name.slice(0, -DOCUMENT_EXTENSION.length)}</span>
                  <span className="text-2xs text-text-tertiary">Open</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(error ?? branchError) && <p className="text-xs text-red-400">{error ?? branchError}</p>}
    </div>
  );
}

export default function RepoDialog() {
  const connection = useGitStore((s) => s.connection);

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          className="flex items-center gap-1.5 h-7 text-text-secondary hover:text-text-primary text-[12px] font-medium px-2.5 rounded-md border border-surface-border transition-colors"
          title={connection ? repoSlug(connection) : "Connect a repository"}
        >
          <GitBranch size={12} />
          <span>{connection ? "Repository" : "Connect repo"}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[380px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-surface-border bg-surface-raised p-4 shadow-2xl text-text-primary"
        >
          <div className="flex items-center mb-3">
            <Dialog.Title className="text-sm font-medium flex-1">Repository</Dialog.Title>
            <Dialog.Close className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle" aria-label="Close">
              <X size={13} />
            </Dialog.Close>
          </div>
          {connection ? <RepoBrowser connection={connection} /> : <GitConnectForm />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
