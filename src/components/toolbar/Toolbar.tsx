"use client";

import {
  MousePointer2,
  Square,
  Circle,
  Type,
  Hand,
  Frame,
  Minus,
  Plus,
  Undo2,
  Redo2,
  Grid,
  Sparkles,
  Download,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { cn, formatZoom } from "@/lib/utils";
import { useCanvasStore, type Tool } from "@/store/canvas";
import { useAIStore } from "@/store/ai";
import { useDesignSystemStore } from "@/store/design-system";
import { downloadString } from "@/lib/utils";

const tools: { id: Tool; icon: React.ReactNode; label: string; key: string }[] = [
  { id: "select", icon: <MousePointer2 size={14} />, label: "Select (V)", key: "V" },
  { id: "frame", icon: <Frame size={14} />, label: "Frame (F)", key: "F" },
  { id: "rectangle", icon: <Square size={14} />, label: "Rectangle (R)", key: "R" },
  { id: "ellipse", icon: <Circle size={14} />, label: "Ellipse (O)", key: "O" },
  { id: "text", icon: <Type size={14} />, label: "Text (T)", key: "T" },
  { id: "hand", icon: <Hand size={14} />, label: "Hand (H)", key: "H" },
];

export default function Toolbar() {
  const { activeTool, setActiveTool, zoom, setZoom, toggleGrid, showGrid, undo, redo } =
    useCanvasStore();
  const { setOpen: setAIOpen, isOpen: aiOpen } = useAIStore();
  const { exportTokens } = useDesignSystemStore();

  const handleExport = () => {
    downloadString(exportTokens(), "motif-tokens.json", "application/json");
  };

  return (
    <header className="flex items-center h-11 border-b border-surface-border bg-surface-raised px-3 gap-2 flex-shrink-0 z-20">
      {/* Logo — links back to dashboard */}
      <Link
        href="/"
        className="flex items-center gap-2 mr-3 opacity-90 hover:opacity-100 transition-opacity"
        title="Back to files"
      >
        <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center">
          <span className="text-white text-xs font-bold leading-none">M</span>
        </div>
        <span className="text-sm font-semibold text-text-primary">Motif</span>
      </Link>

      <div className="w-px h-5 bg-surface-border" />

      {/* Tools */}
      <div className="flex items-center gap-0.5">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            title={tool.label}
            className={cn(
              "tool-btn",
              activeTool === tool.id && "active"
            )}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-surface-border" />

      {/* History */}
      <div className="flex items-center gap-0.5">
        <button onClick={undo} title="Undo (⌘Z)" className="tool-btn">
          <Undo2 size={14} />
        </button>
        <button onClick={redo} title="Redo (⌘⇧Z)" className="tool-btn">
          <Redo2 size={14} />
        </button>
      </div>

      <div className="w-px h-5 bg-surface-border" />

      {/* Grid toggle */}
      <button
        onClick={toggleGrid}
        title="Toggle Grid"
        className={cn("tool-btn", showGrid && "active")}
      >
        <Grid size={14} />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setZoom(zoom - 0.1)}
          className="tool-btn"
          title="Zoom out"
        >
          <Minus size={12} />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="px-2 h-7 text-xs text-text-secondary hover:text-text-primary transition-colors min-w-[52px] text-center"
          title="Reset zoom"
        >
          {formatZoom(zoom)}
        </button>
        <button
          onClick={() => setZoom(zoom + 0.1)}
          className="tool-btn"
          title="Zoom in"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="w-px h-5 bg-surface-border" />

      {/* Export tokens */}
      <button
        onClick={handleExport}
        title="Export design tokens"
        className="flex items-center gap-1.5 h-7 px-2.5 text-xs text-text-secondary hover:text-text-primary rounded hover:bg-surface-subtle transition-colors"
      >
        <Download size={12} />
        <span>Export</span>
      </button>

      {/* AI button */}
      <button
        onClick={() => setAIOpen(!aiOpen)}
        className={cn(
          "flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded transition-all",
          aiOpen
            ? "bg-accent text-white"
            : "bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30"
        )}
      >
        <Sparkles size={12} />
        <span>AI</span>
      </button>
    </header>
  );
}
