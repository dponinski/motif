"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import LeftPanel from "./panels/LeftPanel";
import RightPanel from "./panels/RightPanel";
import DesignCanvas from "./canvas/DesignCanvas";
import AppNav, { type NavItem } from "./AppNav";
import ActivityPanel from "./ActivityPanel";
import VerticalToolbar from "./toolbar/VerticalToolbar";
import TokensView from "./views/TokensView";
import { useCanvasStore, type Tool } from "@/store/canvas";
import { useFilesStore } from "@/store/files";

export default function Editor({ fileId }: { fileId?: string }) {
  const [activeNav, setActiveNav] = useState<NavItem | null>("components");

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

      // Spacebar: hold to pan, release to restore
      if (e.key === " " && !e.repeat && !spaceDown.current) {
        e.preventDefault();
        spaceDown.current = true;
        toolBeforeSpace.current = useCanvasStore.getState().activeTool;
        setActiveTool("hand");
        return;
      }

      const ctrl = e.metaKey || e.ctrlKey;

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
      } else if (ctrl && e.key === "k") {
        e.preventDefault();
        setActiveNav((prev) => prev === "chat" ? null : "chat");
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

  // Load file elements on mount; fall back to canvas store defaults if no fileId
  useEffect(() => {
    if (!fileId) {
      useCanvasStore.getState().pushHistory();
      return;
    }
    const file = useFilesStore.getState().files.find((f) => f.id === fileId);
    if (file) {
      useCanvasStore.getState().loadDocument(file);
    } else {
      useCanvasStore.getState().pushHistory();
    }
  }, [fileId]);

  // Auto-save to files store when the document changes (debounced 1.5s)
  useEffect(() => {
    if (!fileId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () =>
      useFilesStore.getState().saveFile(fileId, useCanvasStore.getState().getDocumentContent());

    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (
        state.elements === prev.elements &&
        state.order === prev.order &&
        state.componentDefs === prev.componentDefs &&
        state.componentGroups === prev.componentGroups
      ) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, 1500);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
      // Final sync on unmount
      save();
    };
  }, [fileId]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-base select-none">
      {/* Far-left nav icon rail */}
      <AppNav activeNav={activeNav} setActiveNav={setActiveNav} />

      {activeNav === "tokens" ? (
        /* Full-screen token editor */
        <TokensView onClose={() => setActiveNav(null)} />
      ) : (
        <>
          {/* Chat / Git activity panel */}
          {(activeNav === "chat" || activeNav === "git") && (
            <ActivityPanel activeNav={activeNav} fileId={fileId} onClose={() => setActiveNav(null)} />
          )}

          {/* Components + layers panel (shown when components nav is active) */}
          {activeNav === "components" && <LeftPanel />}

          {/* Vertical draw tools */}
          <VerticalToolbar />

          {/* Canvas */}
          <main className="flex-1 relative overflow-hidden">
            <DesignCanvas />
          </main>

          {/* Right properties panel */}
          <RightPanel />
        </>
      )}
    </div>
  );
}
