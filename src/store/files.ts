import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { CanvasElement } from "./canvas";

export interface DesignFile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elements: Record<string, CanvasElement>;
  order: string[];
  folderId?: string;
  isDraft?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

function makeDefaultContent(): { elements: Record<string, CanvasElement>; order: string[] } {
  const seed: CanvasElement[] = [
    { id: "frame-1", type: "frame", name: "Frame 1", x: 100, y: 80, width: 375, height: 812, fill: "#ffffff", opacity: 1, rotation: 0, cornerRadius: 0, children: ["rect-1", "text-1", "btn-1"] },
    { id: "rect-1", type: "rectangle", name: "Hero Banner", x: 0, y: 0, width: 375, height: 220, fill: "#6366f1", opacity: 1, rotation: 0, cornerRadius: 0, parentId: "frame-1" },
    { id: "text-1", type: "text", name: "Heading", x: 24, y: 240, width: 327, height: 36, fill: "transparent", fontColor: "#0a0a0a", content: "Welcome to Motif", fontSize: 28, fontWeight: "700", fontFamily: "Inter", opacity: 1, rotation: 0, parentId: "frame-1" },
    { id: "btn-1", type: "rectangle", name: "Primary Button", x: 24, y: 300, width: 160, height: 44, fill: "#6366f1", opacity: 1, rotation: 0, cornerRadius: 8, parentId: "frame-1" },
  ];
  const elements: Record<string, CanvasElement> = {};
  const order: string[] = [];
  for (const el of seed) {
    elements[el.id] = el;
    if (!el.parentId) order.push(el.id);
  }
  return { elements, order };
}

interface FilesStore {
  files: DesignFile[];
  folders: Folder[];
  createFile: (name?: string, opts?: { folderId?: string; isDraft?: boolean }) => DesignFile;
  saveFile: (id: string, elements: Record<string, CanvasElement>, order: string[]) => void;
  deleteFile: (id: string) => void;
  renameFile: (id: string, name: string) => void;
  moveFileToFolder: (fileId: string, folderId: string | null) => void;
  toggleDraft: (fileId: string) => void;
  createFolder: (name: string) => Folder;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
}

export const useFilesStore = create<FilesStore>()(
  persist(
    (set) => ({
      files: [],
      folders: [],

      createFile: (name = "Untitled", opts = {}) => {
        const { elements, order } = makeDefaultContent();
        const file: DesignFile = {
          id: nanoid(8),
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          elements,
          order,
          folderId: opts.folderId,
          isDraft: opts.isDraft,
        };
        set((s) => ({ files: [...s.files, file] }));
        return file;
      },

      saveFile: (id, elements, order) => {
        set((s) => ({
          files: s.files.map((f) =>
            f.id === id ? { ...f, elements, order, updatedAt: Date.now() } : f
          ),
        }));
      },

      deleteFile: (id) => {
        set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
      },

      renameFile: (id, name) => {
        set((s) => ({
          files: s.files.map((f) =>
            f.id === id ? { ...f, name, updatedAt: Date.now() } : f
          ),
        }));
      },

      moveFileToFolder: (fileId, folderId) => {
        set((s) => ({
          files: s.files.map((f) =>
            f.id === fileId ? { ...f, folderId: folderId ?? undefined } : f
          ),
        }));
      },

      toggleDraft: (fileId) => {
        set((s) => ({
          files: s.files.map((f) =>
            f.id === fileId ? { ...f, isDraft: !f.isDraft } : f
          ),
        }));
      },

      createFolder: (name) => {
        const folder: Folder = { id: nanoid(8), name, createdAt: Date.now() };
        set((s) => ({ folders: [...s.folders, folder] }));
        return folder;
      },

      renameFolder: (id, name) => {
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        }));
      },

      deleteFolder: (id) => {
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          // Move files in deleted folder back to root
          files: s.files.map((f) => (f.folderId === id ? { ...f, folderId: undefined } : f)),
        }));
      },
    }),
    { name: "motif-files" }
  )
);
