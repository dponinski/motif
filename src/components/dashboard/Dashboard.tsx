"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useFilesStore, type DesignFile } from "@/store/files";
import { useThemeStore, type ThemeMode } from "@/store/theme";
import type { CanvasElement } from "@/store/canvas";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor } from "lucide-react";

// ── Mini SVG thumbnail ────────────────────────────────────────────────────────

function FileThumbnail({
  elements,
  order,
}: {
  elements: Record<string, CanvasElement>;
  order: string[];
}) {
  const W = 220;
  const H = 140;
  const roots = order.map((id) => elements[id]).filter(Boolean);

  if (roots.length === 0) {
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        <rect width={W} height={H} fill="var(--canvas-bg)" />
        <text x={W / 2} y={H / 2 + 5} textAnchor="middle" fill="var(--text-tertiary)" fontSize="12">
          Empty
        </text>
      </svg>
    );
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of roots) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }

  const sceneW = Math.max(maxX - minX, 1);
  const sceneH = Math.max(maxY - minY, 1);
  const scale = Math.min(W / sceneW, H / sceneH) * 0.82;
  const offsetX = (W - sceneW * scale) / 2 - minX * scale;
  const offsetY = (H - sceneH * scale) / 2 - minY * scale;

  const allEls = Object.values(elements).filter(
    (el) => el.visible !== false && el.fill !== "transparent"
  );

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={W} height={H} fill="var(--canvas-bg)" />
      {allEls.map((el) => {
        const parentEl = el.parentId ? elements[el.parentId] : null;
        const absX = parentEl ? parentEl.x + el.x : el.x;
        const absY = parentEl ? parentEl.y + el.y : el.y;
        return (
          <rect
            key={el.id}
            x={absX * scale + offsetX}
            y={absY * scale + offsetY}
            width={Math.max(el.width * scale, 0)}
            height={Math.max(el.height * scale, 0)}
            fill={el.fill || "#6366f1"}
            stroke={el.type === "frame" ? "var(--surface-border)" : "none"}
            strokeWidth={el.type === "frame" ? 1 : 0}
            rx={(el.cornerRadius ?? 0) * scale}
            opacity={el.opacity ?? 1}
          />
        );
      })}
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ── FileCard ──────────────────────────────────────────────────────────────────

function FileCard({
  file,
  onOpen,
  onDelete,
  onRename,
}: {
  file: DesignFile;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(file.name);
  const [hover, setHover] = useState(false);

  const elementCount = Object.keys(file.elements).length;

  return (
    <div
      className="group flex flex-col"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Thumbnail */}
      <div
        className="relative rounded-xl overflow-hidden border border-surface-border-subtle bg-surface-subtle cursor-pointer hover:border-surface-border transition-colors select-none"
        style={{ aspectRatio: "16/10" }}
        onClick={onOpen}
      >
        <FileThumbnail elements={file.elements} order={file.order} />
        {hover && (
          <div className="absolute inset-0 bg-black/20 flex items-end justify-start p-2.5">
            <span className="text-[11px] text-white/90 font-medium bg-black/50 px-2 py-1 rounded-md backdrop-blur-sm">
              Open
            </span>
          </div>
        )}
      </div>

      {/* Info row */}
      <div className="mt-2.5 flex items-start justify-between gap-1.5">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              className="text-[13px] text-text-primary bg-surface-overlay border border-surface-border rounded px-1.5 py-0.5 w-full focus:outline-none focus:border-accent transition-colors"
              value={nameVal}
              autoFocus
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={() => {
                setEditing(false);
                onRename(nameVal.trim() || file.name);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setEditing(false);
                  onRename(nameVal.trim() || file.name);
                }
                if (e.key === "Escape") {
                  setEditing(false);
                  setNameVal(file.name);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <p
              className="text-[13px] text-text-primary font-medium truncate cursor-default"
              onDoubleClick={() => setEditing(true)}
              title="Double-click to rename"
            >
              {file.name}
            </p>
          )}
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {formatDate(file.updatedAt)}
            {elementCount > 0 && (
              <span className="text-text-tertiary opacity-60">
                {" · "}
                {elementCount} layer{elementCount !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>

        <button
          className="mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-red-400 p-1 rounded hover:bg-red-400/10"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete file"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const { files, createFile, deleteFile, renameFile } = useFilesStore();
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();

  const handleNewFile = useCallback(() => {
    const file = createFile("Untitled");
    router.push(`/editor/${file.id}`);
  }, [createFile, router]);

  const sorted = [...files].sort((a, b) => b.updatedAt - a.updatedAt);

  const themeOptions: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: "light", icon: <Sun size={12} />, label: "Light" },
    { mode: "system", icon: <Monitor size={12} />, label: "System" },
    { mode: "dark", icon: <Moon size={12} />, label: "Dark" },
  ];

  return (
    <div className="min-h-screen bg-surface-base text-text-primary select-none">
      {/* Top bar */}
      <header className="flex items-center justify-between h-12 px-6 border-b border-surface-border-subtle">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[11px] font-bold leading-none">M</span>
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-text-primary">Motif</span>
        </div>

        <div className="flex items-center gap-3">
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

          <button
            onClick={handleNewFile}
            className="flex items-center gap-1.5 h-7 bg-accent hover:bg-accent/90 text-white text-[12px] font-medium px-3 rounded-md transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New file
          </button>
        </div>
      </header>

      {/* Body */}
      <main className="px-6 pt-8 pb-16">
        {sorted.length === 0 ? (
          // ── Empty state ──────────────────────────────────────────────────
          <div className="flex flex-col items-center justify-center min-h-[55vh] gap-5">
            <div className="text-center">
              <div className="w-14 h-14 bg-surface-raised rounded-2xl flex items-center justify-center mx-auto mb-4 border border-surface-border-subtle">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
              </div>
              <p className="text-[15px] font-medium text-text-primary mb-1">No files yet</p>
              <p className="text-[12px] text-text-secondary">
                Create a file to start designing
              </p>
            </div>
            <button
              onClick={handleNewFile}
              className="bg-accent hover:bg-accent/90 text-white text-[13px] font-medium px-5 py-2 rounded-lg transition-colors"
            >
              Create a file
            </button>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-5">
              Recent
            </p>

            <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
              {/* New-file card */}
              <div className="flex flex-col cursor-pointer" onClick={handleNewFile}>
                <div
                  className="rounded-xl border border-dashed border-surface-border bg-surface-raised hover:border-surface-border hover:bg-surface-overlay transition-colors flex items-center justify-center"
                  style={{ aspectRatio: "16/10" }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <div className="mt-2.5">
                  <p className="text-[13px] text-text-tertiary font-medium">New file</p>
                </div>
              </div>

              {/* File cards */}
              {sorted.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  onOpen={() => router.push(`/editor/${file.id}`)}
                  onDelete={() => deleteFile(file.id)}
                  onRename={(name) => renameFile(file.id, name)}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
