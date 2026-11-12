import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { CanvasElement } from "./canvas";
import type { DocumentContent, MotifDocument } from "@/lib/motif-document";
import type { GitLink } from "@/lib/git-sync";

export interface DesignFile extends DocumentContent {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  folderId?: string;
  isDraft?: boolean;
  git?: GitLink;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

const MAIN_COMPONENT_ID = "comp-main";

function singleComponent(elements: Record<string, CanvasElement>, order: string[]): DocumentContent {
  return {
    componentGroups: [],
    components: [{ id: MAIN_COMPONENT_ID, name: "Main", groupId: null, variantProps: [], elements, order }],
  };
}

function makeDefaultContent(): DocumentContent {
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
  return singleComponent(elements, order);
}

export function toDocument(file: DesignFile): MotifDocument {
  return {
    motif: 1,
    id: file.id,
    name: file.name,
    componentGroups: file.componentGroups,
    components: file.components,
  };
}

interface FilesStore {
  files: DesignFile[];
  folders: Folder[];
  createFile: (name?: string, opts?: { folderId?: string; isDraft?: boolean }) => DesignFile;
  saveFile: (id: string, content: DocumentContent) => void;
  applyDocument: (id: string, doc: MotifDocument) => void;
  importDocument: (doc: MotifDocument, git: GitLink) => DesignFile;
  setGitLink: (id: string, git: GitLink | undefined) => void;
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
    (set) => {
      const patchFile = (id: string, patch: (f: DesignFile) => Partial<DesignFile>) =>
        set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...patch(f) } : f)) }));

      return {
        files: [],
        folders: [],

        createFile: (name = "Untitled", opts = {}) => {
          const file: DesignFile = {
            id: nanoid(8),
            name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...makeDefaultContent(),
            folderId: opts.folderId,
            isDraft: opts.isDraft,
          };
          set((s) => ({ files: [...s.files, file] }));
          return file;
        },

        saveFile: (id, content) => {
          patchFile(id, () => ({
            componentGroups: content.componentGroups,
            components: content.components,
            updatedAt: Date.now(),
          }));
        },

        applyDocument: (id, doc) => {
          patchFile(id, () => ({
            name: doc.name,
            componentGroups: doc.componentGroups,
            components: doc.components,
            updatedAt: Date.now(),
          }));
        },

        importDocument: (doc, git) => {
          const file: DesignFile = {
            id: doc.id,
            name: doc.name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            componentGroups: doc.componentGroups,
            components: doc.components,
            git,
          };
          set((s) => ({ files: [...s.files, file] }));
          return file;
        },

        setGitLink: (id, git) => patchFile(id, () => ({ git })),

        deleteFile: (id) => {
          set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
        },

        renameFile: (id, name) => patchFile(id, () => ({ name, updatedAt: Date.now() })),

        moveFileToFolder: (fileId, folderId) => patchFile(fileId, () => ({ folderId: folderId ?? undefined })),

        toggleDraft: (fileId) => patchFile(fileId, (f) => ({ isDraft: !f.isDraft })),

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
      };
    },
    {
      name: "motif-files",
      version: 1,
      // v0 files stored a single scene as top-level elements/order.
      migrate: (persisted, version) => {
        const state = persisted as { files?: unknown[]; folders?: Folder[] };
        if (version >= 1) return state as FilesStore;
        const files = (state.files ?? []).map((raw) => {
          const { elements, order, ...rest } = raw as Omit<DesignFile, keyof DocumentContent> & {
            elements?: Record<string, CanvasElement>;
            order?: string[];
          };
          return { ...rest, ...singleComponent(elements ?? {}, order ?? []) };
        });
        return { ...state, files } as FilesStore;
      },
    }
  )
);
