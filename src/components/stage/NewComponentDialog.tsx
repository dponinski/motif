"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { checkName, componentDir, libraryEntry, planComponent } from "@/lib/edit/create";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { useEditStore } from "@/store/edit";
import { useGitStore } from "@/store/git";
import { useLibraryStore } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import { loadTree } from "./preview-core";
import { readerFor } from "./reader";

// Where a component starts: a name, and the files it will be made of. Nothing is written to the repository; the new
// files join the editor's changes and leave as a pull request with everything else.
function Body({ onClose }: { onClose: () => void }) {
  const connection = useGitStore((s) => s.connection)!;
  const analysis = useGitStore((s) => s.analysis);
  const source = useLibraryStore((s) => s.source);
  const components = useLibraryStore((s) => s.components);
  const host = useGitHost(connection);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Said after the component is made, when there is something the person should do about what it was made in.
  const [notes, setNotes] = useState<string[]>([]);

  const dir = useMemo(() => componentDir(components), [components]);
  const tailwind = analysis?.stack.tailwindVersion === 4;
  const problem = name ? checkName(name, { components: components.map((c) => c.name), paths: [] }, dir) : null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!analysis || !source || busy) return;
    setBusy(true);
    setError(null);
    try {
      const reader = readerFor(source, host);
      const paths = await loadTree(source, host);
      const plan = await planComponent({ name, analysis, components, paths, reader, ref: source.branch });
      const entry = await libraryEntry(plan, { reader, ref: source.branch, paths });
      // The editor's changes belong to a repository and branch; they are set before anything is put in them.
      useEditStore.getState().adopt(`${source.repo}@${source.branch}`);
      useEditStore.getState().changeMany(plan.texts, { path: plan.file, start: plan.rootStart }, `Create the ${plan.name} component`, plan.bases);
      useLibraryStore.getState().addDraft(entry);
      usePreviewStore.getState().setMode("edit");
      if (plan.notes.length > 0) setNotes(plan.notes);
      else onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (notes.length > 0) {
    return (
      <div className="flex flex-col gap-3" data-created-notes>
        <p className="text-sm text-text-primary">{name} is made.</p>
        {notes.map((n) => <p key={n} className="text-xs leading-relaxed text-amber-500">{n}</p>)}
        <button onClick={onClose} className="h-8 self-start rounded-md border border-surface-border px-3 text-xs text-text-secondary hover:bg-surface-subtle">Close</button>
      </div>
    );
  }

  return (
    <form onSubmit={create} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-text-tertiary">Name</span>
        <input className="input-sm" aria-label="Component name" placeholder="Button" value={name} onChange={(e) => setName(e.target.value.trim())} autoComplete="off" autoFocus />
      </label>
      {problem && <p className="text-xs text-red-400" role="alert" data-name-problem>{problem}</p>}
      <div className="rounded-md border border-surface-border px-3 py-2.5">
        <p className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-text-tertiary">Files it will be made of</p>
        <ul className="flex flex-col gap-0.5 font-mono text-2xs text-text-secondary">
          <li>{dir}/{name || "Name"}.tsx</li>
          {!tailwind && <li>{dir}/{name || "Name"}.css</li>}
          <li className="text-text-tertiary">and a line in {analysis?.stack.entryFiles[0] ?? (dir.startsWith("src") ? "src/index.ts" : "index.ts")}</li>
          <li className="text-text-tertiary">and package.json, if it doesn&apos;t list React yet</li>
        </ul>
        <p className="mt-2 text-2xs leading-relaxed text-text-tertiary">
          {tailwind ? "Styled with Tailwind classes, like the rest of this repository." : "Its styles go in the CSS file next to it, using your tokens as CSS variables."} Nothing is sent to the repository until you open a pull request.
        </p>
      </div>
      {error && <p className="break-words text-xs text-red-400" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !name || !!problem || !analysis || !source} className="flex h-8 items-center justify-center gap-1.5 self-start rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50">
        {busy && <Loader2 size={12} className="animate-spin" />} Create component
      </button>
    </form>
  );
}

export default function NewComponentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 select-text rounded-xl border border-surface-border bg-surface-raised p-4 text-text-primary shadow-2xl"
        >
          <div className="mb-3 flex items-center">
            <Dialog.Title className="flex-1 text-sm font-medium">New component</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary" aria-label="Close"><X size={13} /></Dialog.Close>
          </div>
          <Body onClose={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
