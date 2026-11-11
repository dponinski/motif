"use client";

import { useEffect, useCallback, useRef } from "react";
import Toolbar from "./toolbar/Toolbar";
import LeftPanel from "./panels/LeftPanel";
import RightPanel from "./panels/RightPanel";
import AIPanel from "./panels/AIPanel";
import DesignCanvas from "./canvas/DesignCanvas";
import { useCanvasStore, type Tool } from "@/store/canvas";
import { useFilesStore } from "@/store/files";
import { useAIStore } from "@/store/ai";

export default function Editor({ fileId }: { fileId?: string }) {
  const { undo, redo, deleteSelected, duplicateSelected, setActiveTool } =
    useCanvasStore();
  const { setOpen: setAIOpen, isOpen: aiOpen } = useAIStore();

  // Spacebar temporary-pan state (not React state — avoids re-renders)
  const spaceDown = useRef(false);
  const toolBeforeSpace = useRef<Tool>("select");

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
      } else if (e.key === "Backspace" || e.key === "Delete") {
        deleteSelected();
      } else if (e.key === "v" || e.key === "Escape") {
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
        setAIOpen(!aiOpen);
      }
    },
    [undo, redo, deleteSelected, duplicateSelected, setActiveTool, setAIOpen, aiOpen]
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
      useCanvasStore.getState().loadElements(Object.values(file.elements));
    } else {
      useCanvasStore.getState().pushHistory();
    }
  }, [fileId]);

  // Auto-save to files store when elements/order change (debounced 1.5s)
  useEffect(() => {
    if (!fileId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastElements = useCanvasStore.getState().elements;
    let lastOrder = useCanvasStore.getState().order;

    const unsub = useCanvasStore.subscribe((state) => {
      if (state.elements === lastElements && state.order === lastOrder) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        lastElements = state.elements;
        lastOrder = state.order;
        useFilesStore.getState().saveFile(fileId, state.elements, state.order);
      }, 1500);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
      // Final sync on unmount
      const { elements, order } = useCanvasStore.getState();
      useFilesStore.getState().saveFile(fileId, elements, order);
    };
  }, [fileId]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0a0a] select-none">
      {/* Top toolbar */}
      <Toolbar />

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <LeftPanel />

        {/* Canvas */}
        <main className="flex-1 relative overflow-hidden bg-[#141414]">
          <DesignCanvas />
        </main>

        {/* Right panel */}
        <RightPanel />
      </div>

      {/* AI Panel */}
      <AIPanel />
    </div>
  );
}
