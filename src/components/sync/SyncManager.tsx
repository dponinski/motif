"use client";

import { useShallow } from "zustand/react/shallow";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { useAuth } from "@/store/auth";
import { useProjectsStore } from "@/store/projects";
import { useSync } from "@/store/sync";

const ConflictDialog = dynamic(() => import("./ConflictDialog"), { loading: () => null });

// Starts and stops keeping the signed-in person's projects in step with the server, and speaks up when it needs them:
// once to say what was saved, and when the same part of a project was changed differently on two devices.
export default function SyncManager() {
  const authStatus = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id ?? null);
  const { conflicts, notice, resolve, dismissNotice } = useSync(useShallow((s) => ({ conflicts: s.conflicts, notice: s.notice, resolve: s.resolve, dismissNotice: s.dismissNotice })));
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

      {conflict && <ConflictDialog id={id} conflict={conflict} name={name} resolve={resolve} />}
    </>
  );
}
