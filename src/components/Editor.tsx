"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import LeftPanel from "./panels/LeftPanel";
import RightPanel from "./panels/RightPanel";
import DesignCanvas from "./canvas/DesignCanvas";
import AppNav, { type NavItem } from "./AppNav";
import ActivityPanel from "./ActivityPanel";
import VerticalToolbar from "./toolbar/VerticalToolbar";
import TokensView from "./views/TokensView";
import DocsView from "./views/DocsView";
import RepoView from "./views/RepoView";
import ComponentStage from "./stage/ComponentStage";
import { useLibraryStore } from "@/store/library";
import { useCanvasStore, type Tool } from "@/store/canvas";
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
  // Canvas shortcuts must not fire while a full-screen view covers the canvas.
  const canvasHidden = useRef(false);
  const stageActive = useLibraryStore((s) => s.activeId !== null && s.components.some((c) => c.id === s.activeId));
  useEffect(() => {
    canvasHidden.current = activeNav === "tokens" || activeNav === "docs" || activeNav === "repo" || stageActive;
  }, [activeNav, stageActive]);

  const { undo, redo, deleteSelected, duplicateSelected, copySelected, pasteClipboard, setActiveTool } =
    useCanvasStore();

  // Spacebar temporary-pan state (not React state — avoids re-renders)
  const spaceDown = useRef(false);
  const toolBeforeSpace = useRef<Tool>("select");
  // Arrow key: push history on release after nudging
  const arrowDown = useRef(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInput) return;

      const ctrl = e.metaKey || e.ctrlKey;
      if (ctrl && e.key === "k") {
        e.preventDefault();
        setActiveNav((prev) => prev === "chat" ? null : "chat");
        return;
      }
      if (canvasHidden.current) return;

      // Spacebar: hold to pan, release to restore
      if (e.key === " " && !e.repeat && !spaceDown.current) {
        e.preventDefault();
        spaceDown.current = true;
        toolBeforeSpace.current = useCanvasStore.getState().activeTool;
        setActiveTool("hand");
        return;
      }

      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (ctrl && e.key === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (ctrl && e.key === "c") {
        e.preventDefault();
        copySelected();
      } else if (ctrl && e.key === "v") {
        e.preventDefault();
        pasteClipboard();
      } else if (ctrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const s = useCanvasStore.getState();
        s.setZoom(Math.min(32, s.zoom * 1.25));
      } else if (ctrl && e.key === "-") {
        e.preventDefault();
        const s = useCanvasStore.getState();
        s.setZoom(Math.max(0.05, s.zoom / 1.25));
      } else if (ctrl && e.key === "0") {
        e.preventDefault();
        useCanvasStore.getState().setZoom(1);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        deleteSelected();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (useCanvasStore.getState().selectedIds.length > 0) {
          e.preventDefault();
          arrowDown.current = true;
          const dist = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -dist : e.key === "ArrowRight" ? dist : 0;
          const dy = e.key === "ArrowUp" ? -dist : e.key === "ArrowDown" ? dist : 0;
          useCanvasStore.getState().nudgeSelected(dx, dy);
        }
      } else if (e.key === "Escape") {
        setActiveTool("select");
        useCanvasStore.getState().setSelectedIds([]);
      } else if (e.key === "v" && !ctrl) {
        setActiveTool("select");
      } else if (e.key === "r") {
        setActiveTool("rectangle");
      } else if (e.key === "o") {
        setActiveTool("ellipse");
      } else if (e.key === "t") {
        setActiveTool("text");
      } else if (e.key === "f") {
        setActiveTool("frame");
      } else if (e.key === "h") {
        setActiveTool("hand");
      }
    },
    [undo, redo, deleteSelected, duplicateSelected, copySelected, pasteClipboard, setActiveTool, setActiveNav]
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === " " && spaceDown.current) {
        spaceDown.current = false;
        // Only restore if still in hand mode (user may have pressed H explicitly)
        if (useCanvasStore.getState().activeTool === "hand") {
          setActiveTool(toolBeforeSpace.current);
        }
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && arrowDown.current) {
        arrowDown.current = false;
        useCanvasStore.getState().pushHistory();
      }
    },
    [setActiveTool]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

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

          {/* Vertical draw tools (they draw on the canvas, which a repository component replaces) */}
          {!stageActive && <VerticalToolbar />}

          {/* Canvas, or the stage when a repository component is open */}
          <main className="flex-1 relative overflow-hidden">
            {stageActive ? <ComponentStage /> : <DesignCanvas />}
          </main>

          {/* Right properties panel */}
          <RightPanel />
        </>
      )}
    </div>
  );
}
