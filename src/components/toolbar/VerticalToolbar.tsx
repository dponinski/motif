"use client";

import { MousePointer2, Square, Circle, Type, Hand, Frame, Undo2, Redo2, Grid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore, type Tool } from "@/store/canvas";

const tools: { id: Tool; icon: React.ReactNode; label: string }[] = [
  { id: "select", icon: <MousePointer2 size={14} />, label: "Select (V)" },
  { id: "frame", icon: <Frame size={14} />, label: "Frame (F)" },
  { id: "rectangle", icon: <Square size={14} />, label: "Rectangle (R)" },
  { id: "ellipse", icon: <Circle size={14} />, label: "Ellipse (O)" },
  { id: "text", icon: <Type size={14} />, label: "Text (T)" },
  { id: "hand", icon: <Hand size={14} />, label: "Hand (H)" },
];

export default function VerticalToolbar() {
  const { activeTool, setActiveTool, toggleGrid, showGrid, undo, redo } = useCanvasStore();

  return (
    <div className="w-10 flex-shrink-0 flex flex-col items-center border-r border-surface-border bg-surface-raised py-1 gap-0.5">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => setActiveTool(tool.id)}
          title={tool.label}
          className={cn("tool-btn", activeTool === tool.id && "active")}
        >
          {tool.icon}
        </button>
      ))}

      <div className="w-5 h-px bg-surface-border my-1" />

      <button onClick={undo} title="Undo (⌘Z)" className="tool-btn">
        <Undo2 size={14} />
      </button>
      <button onClick={redo} title="Redo (⌘⇧Z)" className="tool-btn">
        <Redo2 size={14} />
      </button>

      <div className="w-5 h-px bg-surface-border my-1" />

      <button
        onClick={toggleGrid}
        title="Toggle Grid"
        className={cn("tool-btn", showGrid && "active")}
      >
        <Grid size={14} />
      </button>
    </div>
  );
}
