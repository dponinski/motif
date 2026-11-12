"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFilesStore, type DesignFile, type Folder } from "@/store/files";
import { useThemeStore, type ThemeMode } from "@/store/theme";
import type { CanvasElement } from "@/store/canvas";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor, FolderPlus, Folder as FolderIcon, ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import RepoDialog from "@/components/git/RepoDialog";

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
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
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
  folders,
  onOpen,
  onDelete,
  onRename,
  onMove,
  onToggleDraft,
}: {
  file: DesignFile;
  folders: Folder[];
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onMove: (folderId: string | null) => void;
  onToggleDraft: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(file.name);
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const elementCount = file.components.reduce((n, c) => n + Object.keys(c.elements).length, 0);
  const cover = file.components[0];

  return (
    <div
      className="group flex flex-col"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setMenuOpen(false); }}
    >
      {/* Thumbnail */}
      <div
        className="relative rounded-xl overflow-hidden border border-surface-border-subtle bg-surface-subtle cursor-pointer hover:border-surface-border transition-colors select-none"
        style={{ aspectRatio: "16/10" }}
        onClick={onOpen}
      >
        <FileThumbnail elements={cover?.elements ?? {}} order={cover?.order ?? []} />
        {hover && (
          <div className="absolute inset-0 bg-black/20 flex items-end justify-start p-2.5">
            <span className="text-[11px] text-white/90 font-medium bg-black/50 px-2 py-1 rounded-md backdrop-blur-sm">
              Open
            </span>
          </div>
        )}
        {file.isDraft && (
          <div className="absolute top-2 left-2 bg-amber-500/90 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded">
            Draft
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
              onBlur={() => { setEditing(false); onRename(nameVal.trim() || file.name); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { setEditing(false); onRename(nameVal.trim() || file.name); }
                if (e.key === "Escape") { setEditing(false); setNameVal(file.name); }
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
                {" · "}{elementCount} layer{elementCount !== 1 ? "s" : ""}
              </span>
            )}
          </p>
          {file.git && (
            <p className="flex items-center gap-1 text-[11px] text-text-tertiary mt-0.5 min-w-0" title={`${file.git.repo} · ${file.git.path}`}>
              <GitBranch size={10} className="flex-shrink-0" />
              <span className="truncate">{file.git.branch}</span>
            </p>
          )}
        </div>

        {/* Context menu */}
        <div className="relative mt-0.5" ref={menuRef}>
          <button
            className={cn(
              "opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-secondary p-1 rounded hover:bg-surface-subtle",
              menuOpen && "opacity-100"
            )}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title="More options"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-6 z-50 w-44 bg-surface-overlay border border-surface-border rounded-lg shadow-lg py-1 text-[12px]"
              onClick={(e) => e.stopPropagation()}
            >
              <button className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-surface-subtle hover:text-text-primary transition-colors" onClick={() => { onToggleDraft(); setMenuOpen(false); }}>
                {file.isDraft ? "Remove draft mark" : "Mark as draft"}
              </button>
              <div className="border-t border-surface-border my-1" />
              <p className="px-3 py-1 text-text-tertiary text-[10px] uppercase tracking-wider font-medium">Move to folder</p>
              <button
                className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-surface-subtle hover:text-text-primary transition-colors"
                onClick={() => { onMove(null); setMenuOpen(false); }}
              >
                No folder
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-text-secondary hover:bg-surface-subtle hover:text-text-primary transition-colors",
                    file.folderId === folder.id && "text-accent"
                  )}
                  onClick={() => { onMove(folder.id); setMenuOpen(false); }}
                >
                  {folder.name}
                </button>
              ))}
              <div className="border-t border-surface-border my-1" />
              <button
                className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-400/10 transition-colors"
                onClick={() => { onDelete(); setMenuOpen(false); }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── FolderSection ─────────────────────────────────────────────────────────────

function FolderSection({
  folder,
  files,
  folders,
  onOpen,
  onDelete,
  onRename,
  onMove,
  onToggleDraft,
  onDeleteFolder,
  onRenameFolder,
  onNewFile,
}: {
  folder: Folder;
  files: DesignFile[];
  folders: Folder[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onMove: (fileId: string, folderId: string | null) => void;
  onToggleDraft: (id: string) => void;
  onDeleteFolder: () => void;
  onRenameFolder: (name: string) => void;
  onNewFile: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(folder.name);

  return (
    <div className="mb-6">
      {/* Folder header */}
      <div className="flex items-center gap-1.5 mb-3 group/folder">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 flex-1 text-left hover:text-text-primary transition-colors"
        >
          {expanded ? <ChevronDown size={12} className="text-text-tertiary flex-shrink-0" /> : <ChevronRight size={12} className="text-text-tertiary flex-shrink-0" />}
          <FolderIcon size={13} className="text-text-tertiary flex-shrink-0" />
          {editingName ? (
            <input
              className="text-[12px] font-semibold bg-transparent border-b border-accent text-text-primary outline-none flex-1"
              value={nameVal}
              autoFocus
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={() => { setEditingName(false); onRenameFolder(nameVal.trim() || folder.name); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { setEditingName(false); onRenameFolder(nameVal.trim() || folder.name); }
                if (e.key === "Escape") { setEditingName(false); setNameVal(folder.name); }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="text-[12px] font-semibold text-text-secondary uppercase tracking-wider"
              onDoubleClick={(e) => { e.stopPropagation(); setEditingName(true); }}
            >
              {folder.name}
            </span>
          )}
          <span className="text-[11px] text-text-tertiary ml-0.5">({files.length})</span>
        </button>

        <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity">
          <button
            className="p-1 text-text-tertiary hover:text-text-secondary rounded hover:bg-surface-subtle"
            title="New file in folder"
            onClick={onNewFile}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button
            className="p-1 text-text-tertiary hover:text-red-400 rounded hover:bg-red-400/10"
            title="Delete folder"
            onClick={onDeleteFolder}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {files.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              folders={folders}
              onOpen={() => onOpen(file.id)}
              onDelete={() => onDelete(file.id)}
              onRename={(name) => onRename(file.id, name)}
              onMove={(folderId) => onMove(file.id, folderId)}
              onToggleDraft={() => onToggleDraft(file.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const {
    files, folders,
    createFile, deleteFile, renameFile, moveFileToFolder, toggleDraft,
    createFolder, renameFolder, deleteFolder,
  } = useFilesStore();
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();

  const handleNewFile = useCallback((folderId?: string) => {
    const file = createFile("Untitled", { folderId });
    router.push(`/editor/${file.id}`);
  }, [createFile, router]);

  const handleNewFolder = useCallback(() => {
    createFolder("New Folder");
  }, [createFolder]);

  const themeOptions: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: "light", icon: <Sun size={12} />, label: "Light" },
    { mode: "system", icon: <Monitor size={12} />, label: "System" },
    { mode: "dark", icon: <Moon size={12} />, label: "Dark" },
  ];

  const drafts = files.filter((f) => f.isDraft).sort((a, b) => b.updatedAt - a.updatedAt);
  const folderFiles = (folderId: string) =>
    files.filter((f) => f.folderId === folderId && !f.isDraft).sort((a, b) => b.updatedAt - a.updatedAt);
  const rootFiles = files
    .filter((f) => !f.folderId && !f.isDraft)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const hasContent = files.length > 0;

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

        <div className="flex items-center gap-2">
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

          <RepoDialog />

          <button
            onClick={handleNewFolder}
            className="flex items-center gap-1.5 h-7 text-text-secondary hover:text-text-primary text-[12px] font-medium px-2.5 rounded-md border border-surface-border hover:border-surface-border transition-colors"
            title="New folder"
          >
            <FolderPlus size={12} />
            <span>Folder</span>
          </button>

          <button
            onClick={() => handleNewFile()}
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
        {!hasContent ? (
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
              <p className="text-[12px] text-text-secondary">Create a file to start designing</p>
            </div>
            <button
              onClick={() => handleNewFile()}
              className="bg-accent hover:bg-accent/90 text-white text-[13px] font-medium px-5 py-2 rounded-lg transition-colors"
            >
              Create a file
            </button>
          </div>
        ) : (
          <>
            {/* ── Drafts section ─────────────────────────────────────────── */}
            {drafts.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Drafts</p>
                  <span className="text-[11px] text-text-tertiary">({drafts.length})</span>
                </div>
                <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                  {drafts.map((file) => (
                    <FileCard
                      key={file.id}
                      file={file}
                      folders={folders}
                      onOpen={() => router.push(`/editor/${file.id}`)}
                      onDelete={() => deleteFile(file.id)}
                      onRename={(name) => renameFile(file.id, name)}
                      onMove={(folderId) => moveFileToFolder(file.id, folderId)}
                      onToggleDraft={() => toggleDraft(file.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Folders ────────────────────────────────────────────────── */}
            {folders.map((folder) => (
              <FolderSection
                key={folder.id}
                folder={folder}
                files={folderFiles(folder.id)}
                folders={folders}
                onOpen={(id) => router.push(`/editor/${id}`)}
                onDelete={deleteFile}
                onRename={renameFile}
                onMove={moveFileToFolder}
                onToggleDraft={toggleDraft}
                onDeleteFolder={() => deleteFolder(folder.id)}
                onRenameFolder={(name) => renameFolder(folder.id, name)}
                onNewFile={() => handleNewFile(folder.id)}
              />
            ))}

            {/* ── Recent / root files ────────────────────────────────────── */}
            {(rootFiles.length > 0 || folders.length === 0) && (
              <div>
                {(drafts.length > 0 || folders.length > 0) && (
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-3">
                    Recent
                  </p>
                )}
                <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                  {/* New-file card */}
                  <div className="flex flex-col cursor-pointer" onClick={() => handleNewFile()}>
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

                  {rootFiles.map((file) => (
                    <FileCard
                      key={file.id}
                      file={file}
                      folders={folders}
                      onOpen={() => router.push(`/editor/${file.id}`)}
                      onDelete={() => deleteFile(file.id)}
                      onRename={(name) => renameFile(file.id, name)}
                      onMove={(folderId) => moveFileToFolder(file.id, folderId)}
                      onToggleDraft={() => toggleDraft(file.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
