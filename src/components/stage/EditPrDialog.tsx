"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { diffLines } from "@/lib/edit/diff";
import { openTokenPr } from "@/lib/token-sync/pr";
import { errorMessage, useCanSend, useGitHost } from "@/components/git/hooks";
import { changedFiles, editLog, useEditStore } from "@/store/edit";
import type { GitConnection } from "@/store/git";
import type { LibrarySource } from "@/store/library";

const MAX_LISTED = 60;

export function editPrBody(files: string[], log: string[], note: string): string {
  // The same change made twice in a row reads as one.
  const steps = log.filter((line, i) => line !== log[i - 1]);
  const lines = [note.trim() || "Design changes made in Motif's visual editor.", "", `### Changes (${steps.length})`, ""];
  for (const step of steps.slice(0, MAX_LISTED)) lines.push(`- ${step.replace(/\n/g, " ")}`);
  if (steps.length > MAX_LISTED) lines.push(`- …and ${steps.length - MAX_LISTED} more`);
  lines.push("", "### Files", "");
  for (const f of files) lines.push(`- \`${f}\``);
  lines.push("", "---", "Opened from Motif. Only the files listed here were changed.");
  return lines.join("\n");
}

const branchName = (now = Date.now()) => `motif/edit-${now.toString(36)}`;

function Body({ connection, source, subject, onClose, onSent }: { connection: GitConnection; source: LibrarySource; subject: string; onClose: () => void; onSent: () => void }) {
  const host = useGitHost(connection);
  const canSend = useCanSend(connection);
  const history = useEditStore((s) => s.history);
  const index = useEditStore((s) => s.index);
  const bases = useEditStore((s) => s.bases);
  const files = useMemo(() => changedFiles({ history, index, bases }), [history, index, bases]);
  // A new file is all additions: there is no empty line before it to show as taken away.
  const diffs = useMemo(
    () => files.map((f) => {
      if (!f.isNew) return { file: f, ...diffLines(f.before, f.after) };
      const lines = f.after.replace(/\n$/, "").split("\n");
      return { file: f, hunks: [lines.map((text) => ({ type: "+" as const, text }))], added: lines.length, removed: 0 };
    }),
    [files]
  );

  const [title, setTitle] = useState(`Update ${subject} from Motif`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ number: number; url: string } | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      // A file made here must still not be in the repository, or the pull request would overwrite it.
      for (const f of files.filter((x) => x.isNew)) {
        if (await host.getFile(f.path, source.branch)) throw new Error(`${f.path} has been added to the repository since it was made here. Give up that file's changes and try again.`);
      }
      const pr = await openTokenPr({
        host, base: source.branch, branch: branchName(),
        files: Object.fromEntries(files.map((f) => [f.path, { text: f.after, sha: f.sha }])),
        title, message: title,
        body: editPrBody(files.map((f) => f.path), editLog({ history, index }), note),
      });
      setOpened({ number: pr.number, url: pr.url });
      // The changes are in the pull request now. They are let go when this is closed (not before: with them gone, a
      // component made here is put away, and this would go with it).
      onSent();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (opened) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-primary">Opened pull request #{opened.number}.</p>
        <a href={opened.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent hover:underline">{opened.url} <ExternalLink size={10} /></a>
        <p className="text-xs leading-relaxed text-text-tertiary">The preview shows the branch as it is. After the pull request is merged, press Update from repository.</p>
        <button className="h-7 self-start rounded-md border border-surface-border px-3 text-xs text-text-secondary hover:bg-surface-subtle" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Title</span>
        <input className="input-sm" aria-label="Pull request title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Description (optional)</span>
        <textarea className="input-sm min-h-[52px]" aria-label="Pull request description" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <div className="flex flex-col gap-3">
        {diffs.map(({ file, hunks, added, removed }) => (
          <div key={file.path} className="overflow-hidden rounded-md border border-surface-border">
            <div className="flex items-center gap-2 border-b border-surface-border bg-surface-subtle px-2.5 py-1.5">
              <span className="flex-1 truncate font-mono text-2xs text-text-secondary">{file.path}{file.isNew && <span className="ml-1.5 rounded bg-emerald-500/15 px-1 font-sans text-emerald-500">new</span>}</span>
              <span className="text-2xs text-emerald-500">+{added}</span>
              <span className="text-2xs text-red-400">−{removed}</span>
            </div>
            <pre className="max-h-[220px] overflow-auto py-1 font-mono text-2xs leading-relaxed" aria-label={`Changes to ${file.path}`}>
              {hunks.map((hunk, i) => (
                <div key={i} className={cn(i > 0 && "mt-1 border-t border-dashed border-surface-border pt-1")}>
                  {hunk.map((l, j) => (
                    <div key={j} className={cn("whitespace-pre px-2.5", l.type === "+" && "bg-emerald-500/10 text-emerald-500", l.type === "-" && "bg-red-400/10 text-red-400", l.type === " " && "text-text-tertiary")}>
                      {l.type === " " ? "  " : `${l.type} `}{l.text}
                    </div>
                  ))}
                </div>
              ))}
            </pre>
          </div>
        ))}
      </div>

      {!canSend && <p className="text-xs text-amber-500">Opening a pull request needs you to sign in with GitHub, or an access token with Contents and Pull requests read and write. Either is in the Git panel.</p>}
      {error && <p className="break-words text-xs text-red-400">{error}</p>}
      <button
        className="flex h-7 items-center justify-center gap-1.5 self-start rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
        onClick={create}
        disabled={busy || !canSend || files.length === 0 || !title.trim()}
      >
        {busy && <Loader2 size={12} className="animate-spin" />}
        Create pull request
      </button>
    </div>
  );
}

export default function EditPrDialog({ open, onOpenChange, connection, source, subject }: { open: boolean; onOpenChange: (open: boolean) => void; connection: GitConnection; source: LibrarySource; subject: string }) {
  const [sent, setSent] = useState(false);
  // Once the pull request is open, closing this lets go of the changes: the preview goes back to the branch until it is merged.
  const change = (next: boolean) => {
    if (!next && sent) {
      setSent(false);
      useEditStore.getState().clear();
    }
    onOpenChange(next);
  };
  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 select-text flex-col rounded-xl border border-surface-border bg-surface-raised text-text-primary shadow-2xl"
        >
          <div className="flex flex-shrink-0 items-center border-b border-surface-border px-4 py-3">
            <Dialog.Title className="flex-1 text-sm font-medium">Open a pull request with your changes</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close"><X size={13} /></Dialog.Close>
          </div>
          <div className="overflow-y-auto p-4"><Body connection={connection} source={source} subject={subject} onClose={() => change(false)} onSent={() => setSent(true)} /></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
