"use client";

import { useEffect, useCallback } from "react";
import Toolbar from "./toolbar/Toolbar";
import LeftPanel from "./panels/LeftPanel";
import RightPanel from "./panels/RightPanel";
import AIPanel from "./panels/AIPanel";
import DesignCanvas from "./canvas/DesignCanvas";
import { useCanvasStore } from "@/store/canvas";
import { useAIStore } from "@/store/ai";

export default function Editor() {
  const { undo, redo, deleteSelected, duplicateSelected, activeTool, setActiveTool } =
    useCanvasStore();
  const { setOpen: setAIOpen, isOpen: aiOpen } = useAIStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInput) return;

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

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Push initial history entry
  useEffect(() => {
    useCanvasStore.getState().pushHistory();
  }, []);

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
