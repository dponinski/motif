"use client";

import { useEffect, useState } from "react";
import LeftPanel from "./panels/LeftPanel";
import RightPanel from "./panels/RightPanel";
import AppNav, { type NavItem } from "./AppNav";
import ActivityPanel from "./ActivityPanel";
import TokensView from "./views/TokensView";
import DocsView from "./views/DocsView";
import RepoView from "./views/RepoView";
import ComponentStage from "./stage/ComponentStage";
import ProjectOverview from "./stage/ProjectOverview";
import { useAutoRead } from "./stage/useReadRepository";
import { useLibraryStore } from "@/store/library";
import { useNavRequest } from "@/store/nav";

export default function Editor({ projectId }: { projectId: string }) {
  const [activeNav, setActiveNav] = useState<NavItem | null>("components");
  // A panel can ask for another one to be shown.
  const navRequest = useNavRequest((s) => s.request);
  useEffect(() => {
    if (!navRequest) return;
    setActiveNav(navRequest);
    useNavRequest.getState().clear();
  }, [navRequest]);
  // A project that hasn't been read yet reads its repository now.
  useAutoRead();
  const stageActive = useLibraryStore((s) => s.activeId !== null && s.components.some((c) => c.id === s.activeId));

  // Ctrl/Cmd+K opens or closes the chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setActiveNav((prev) => (prev === "chat" ? null : "chat"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
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
          {(activeNav === "chat" || activeNav === "git") && (
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
  );
}
