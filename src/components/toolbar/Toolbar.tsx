"use client";

import { Minus, Plus, Grid, Download, Sun, Moon, Monitor } from "lucide-react";
import Link from "next/link";
import { cn, formatZoom } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas";
import { useDesignSystemStore } from "@/store/design-system";
import { downloadString } from "@/lib/utils";
import { useThemeStore, type ThemeMode } from "@/store/theme";

export default function Toolbar() {
  const { zoom, setZoom, toggleGrid, showGrid } = useCanvasStore();
  const { exportTokens } = useDesignSystemStore();
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();

  const themeOptions: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: "light", icon: <Sun size={12} />, label: "Light" },
    { mode: "system", icon: <Monitor size={12} />, label: "System" },
    { mode: "dark", icon: <Moon size={12} />, label: "Dark" },
  ];

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

      <div className="w-px h-5 bg-surface-border" />

      {/* Theme toggle */}
      <div className="flex items-center gap-0.5 bg-surface-subtle rounded p-0.5">
        {themeOptions.map(({ mode, icon, label }) => (
          <button
            key={mode}
            title={label}
            onClick={() => setThemeMode(mode)}
            className={cn(
              "w-6 h-6 flex items-center justify-center rounded transition-colors",
              themeMode === mode
                ? "bg-surface-raised text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {icon}
          </button>
        ))}
      </div>

    </header>
  );
}
