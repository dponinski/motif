"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TipProvider } from "./Tip";
import LeftPanel from "./panels/LeftPanel";
import RightPanel from "./panels/RightPanel";
import AppNav, { type NavItem } from "./AppNav";
import ActivityPanel from "./ActivityPanel";
import PullConflicts from "./sync/PullConflicts";
// What is only shown when its tab is opened is loaded then, not with the editor.
const TokensView = dynamic(() => import("./views/TokensView"), { loading: () => null });
const DocsView = dynamic(() => import("./views/DocsView"), { loading: () => null });
const RepoView = dynamic(() => import("./views/RepoView"), { loading: () => null });
import ComponentStage from "./stage/ComponentStage";
import ProjectOverview from "./stage/ProjectOverview";
import { useAutoRead } from "./stage/useReadRepository";
import { useBehindWatcher, useWorkWatcher } from "./work/useWork";
import { useStagedStack } from "./work/useStagedStack";
import { useLibraryStore } from "@/store/library";
import { useNavRequest } from "@/store/nav";
import { useAuth } from "@/store/auth";
import { createdTexts, useEditStore } from "@/store/edit";

export default function Editor({ projectId }: { projectId: string }) {
  const [activeNav, setActiveNav] = useState<NavItem | null>("components");
  // A panel can ask for another one to be shown.
  const navRequest = useNavRequest((s) => s.request);
  useEffect(() => {
    if (!navRequest) return;
    setActiveNav(navRequest);
    useNavRequest.getState().clear();
  }, [navRequest]);
  // The libraries that read and compile components, and the inspector, are fetched while the repository is being read, so
  // the first preview and the first click don't wait for them.
  useEffect(() => {
    const load = () => { void import("sucrase"); void import("@babel/parser"); void import("./panels/ElementInspector"); };
    // Not at once: the editor's own scripts and the repository's files come first.
    const timer = setTimeout(() => {
      const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
      if (idle) idle(load); else load();
    }, 1500);
    return () => clearTimeout(timer);
  }, []);
  // A project that hasn't been read yet reads its repository now.
  useAutoRead();
  // The pull request is checked now and then, and edited files that the repository has changed since are found.
  useWorkWatcher();
  // Whether the repository has moved since it was read.
  useBehindWatcher();
  // What the preview and new components build on follows the editor's changes (a Tailwind add-on that isn't merged yet).
  useStagedStack();
  // A component made here is in the list while its files are among the changes: undoing its creation, or sending it as a
  // pull request, puts it away until it is in the repository.
  useEffect(() => {
    const sync = () => useLibraryStore.getState().syncDrafts(createdTexts(useEditStore.getState()));
    sync();
    return useEditStore.subscribe(sync);
  }, []);
  const stageActive = useLibraryStore((s) => s.activeId !== null && s.components.some((c) => c.id === s.activeId));

  // Ctrl/Cmd+K opens or closes the chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && !useAuth.getState().user?.guest) {
        e.preventDefault();
        setActiveNav((prev) => (prev === "chat" ? null : "chat"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <TipProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-surface-base select-none">
        {/* Far-left nav icon rail */}
        <AppNav activeNav={activeNav} setActiveNav={setActiveNav} />

        {activeNav === "tokens" ? (
          /* Full-screen token editor */
          <TokensView onClose={() => setActiveNav(null)} />
        ) : activeNav === "docs" ? (
          <DocsView projectId={projectId} onClose={() => setActiveNav(null)} />
        ) : activeNav === "repo" ? (
          <RepoView onClose={() => setActiveNav("git")} />
        ) : (
          <>
            {/* Chat / Git activity panel */}
            {(activeNav === "chat" || activeNav === "git" || activeNav === "sync") && (
              <ActivityPanel activeNav={activeNav} onClose={() => setActiveNav(null)} onOpenReport={() => setActiveNav("repo")} />
            )}

            {/* Components + layers panel (shown when components nav is active) */}
            {activeNav === "components" && <LeftPanel />}

            {/* The open component on a canvas, or the design system's components to open one from */}
            <main className="flex-1 relative overflow-hidden">
              {stageActive ? <ComponentStage /> : <ProjectOverview />}
            </main>

            {/* Right properties panel */}
            <RightPanel />
          </>
        )}
      </div>
      <PullConflicts />
    </TipProvider>
  );
}
