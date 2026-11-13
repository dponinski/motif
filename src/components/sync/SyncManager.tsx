"use client";

import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { SECTIONS, type Section } from "@/lib/sync/payload";
import { useAuth } from "@/store/auth";
import { useProjectsStore } from "@/store/projects";
import { useSync } from "@/store/sync";

const PARTS: Record<Section, string> = {
  name: "the name",
  connection: "the repository",
  tokenLink: "the link to the repository's tokens",
  tokens: "the tokens",
  docs: "the documentation",
};
const listOf = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

// Starts and stops keeping the signed-in person's projects in step with the server, and speaks up when it needs them:
// once to say what was saved, and when the same part of a project was changed differently on two devices.
export default function SyncManager() {
  const authStatus = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id ?? null);
  const { conflicts, notice, resolve, dismissNotice } = useSync();
  const projects = useProjectsStore((s) => s.projects);

  useEffect(() => { void useAuth.getState().load(); }, []);
  useEffect(() => {
    if (userId) useSync.getState().start(userId);
    // Signed out, or the session ended: what is on this browser stays, and nothing is sent.
    else if (authStatus === "ready" || authStatus === "unavailable") void useSync.getState().stop();
  }, [userId, authStatus]);

  const id = Object.keys(conflicts)[0];
  const conflict = id ? conflicts[id] : null;
  const name = projects.find((p) => p.id === id)?.name ?? "This project";

  return (
    <>
      {notice && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50 max-w-sm">
          <div role="status" data-sync-notice className="pointer-events-auto flex items-start gap-3 rounded-md border border-surface-border bg-surface-raised px-3 py-2 text-xs text-text-primary shadow-lg">
            <span className="min-w-0 flex-1">{notice}</span>
            <button onClick={dismissNotice} aria-label="Dismiss" className="flex-shrink-0 text-text-tertiary hover:text-text-primary"><X size={12} /></button>
          </div>
        </div>
      )}

      <Dialog.Root open={!!conflict}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-surface-border bg-surface-raised p-4 text-text-primary shadow-2xl"
          >
            {conflict && (
              <div className="flex flex-col gap-3" data-sync-conflict>
                <Dialog.Title className="text-sm font-medium">
                  {conflict.deleted ? `“${name}” was deleted on another device` : `“${name}” was changed on another device`}
                </Dialog.Title>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {conflict.deleted
                    ? "You have changes to it here that were never saved to your account. You can delete it here too, or keep this copy and save it to your account again."
                    : `You and another device both changed ${listOf(SECTIONS.filter((s) => conflict.sections.includes(s)).map((s) => PARTS[s]))}. Choose which version to keep for ${conflict.sections.length === 1 ? "it" : "them"}; anything else you changed is kept.`}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row-reverse">
                  <button onClick={() => void resolve(id, "local")} data-keep="local" className="h-8 flex-1 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent/90">
                    {conflict.deleted ? "Keep this copy" : "Keep this device's version"}
                  </button>
                  <button onClick={() => void resolve(id, "server")} data-keep="server" className="h-8 flex-1 rounded-md border border-surface-border px-3 text-xs font-medium text-text-secondary hover:bg-surface-subtle hover:text-text-primary">
                    {conflict.deleted ? "Delete it here too" : "Use the other version"}
                  </button>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
