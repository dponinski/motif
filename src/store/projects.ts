import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { safeStorage } from "../lib/safe-storage";
import type { DocumentContent } from "@/lib/motif-document";
import { emptyTokenData, type TokenData } from "./design-system";
import type { GitConnection, RepoState } from "./git";
import type { LibraryData } from "./library";

// A project is a design system: one GitHub repository and what Motif keeps about it (its tokens, documentation,
// the components read from it, and the canvas). The repository's code stays the source of truth; nothing here is
// sent anywhere except as a pull request.
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  repo: RepoState;
  library: LibraryData;
  tokens: TokenData;
  content: DocumentContent;
}

// The parts of a project the editor works on and writes back.
export type ProjectData = Pick<Project, "repo" | "library" | "tokens" | "content">;

interface ProjectsStore {
  projects: Project[];
  create: (connection: GitConnection, name?: string) => Project;
  save: (id: string, data: ProjectData) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

const emptyContent = (): DocumentContent => ({ componentGroups: [], components: [], docs: [] });

export const useProjectsStore = create<ProjectsStore>()(
  persist(
    (set) => ({
      projects: [],

      create: (connection, name) => {
        const now = Date.now();
        const project: Project = {
          id: nanoid(8),
          name: name?.trim() || connection.repo,
          createdAt: now,
          updatedAt: now,
          repo: { connection, analysis: null, tokenLink: null },
          library: { source: null, components: [] },
          tokens: emptyTokenData(),
          content: emptyContent(),
        };
        set((s) => ({ projects: [...s.projects, project] }));
        return project;
      },

      save: (id, data) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...data, updatedAt: Date.now() } : p)) })),

      rename: (id, name) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)) })),

      remove: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
    }),
    {
      name: "motif-projects",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
    }
  )
);

// Left behind by the file-based versions of Motif, which kept design files, one repository connection and one
// token set for the whole browser. Projects replace them.
const LEGACY_KEYS = ["motif-files", "motif-git", "motif-library", "motif-design-system"];

export function clearLegacyStorage() {
  for (const key of LEGACY_KEYS) safeStorage.removeItem(key);
}
