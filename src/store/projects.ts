import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { debouncedStorage } from "../lib/debounced-storage";
import { safeStorage } from "../lib/safe-storage";
import { storageProblem } from "./storage-problem";
import type { DocBlock, DocPage } from "../lib/motif-document";
import { emptyStoredTokenData, migrateTokenData } from "../lib/tokens/migrate";
import type { StoredTokenData } from "../lib/tokens/model";
import type { GitConnection, RepoState } from "./git";
import type { LibraryData } from "./library";

// A project is a design system: one GitHub repository and what Motif keeps about it (its tokens, documentation,
// and the components read from it). The repository's code stays the source of truth; nothing here is
// sent anywhere except as a pull request.
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  repo: RepoState;
  library: LibraryData;
  // In the typed model (tokens and compositions); the token store holds the same tokens as five lists (lib/tokens/migrate.ts).
  tokens: StoredTokenData;
  // The documentation pages the designer wrote or edited; generated pages exist without being stored.
  docs: DocPage[];
  // The team that shares it (null or missing for a person's own), and who last changed it there. They come from the
  // server and are not part of what is synced as the project's content.
  teamId?: string | null;
  updatedBy?: string | null;
}

// The parts of a project the editor works on and writes back.
export type ProjectData = Pick<Project, "repo" | "library" | "tokens" | "docs">;

interface ProjectsStore {
  projects: Project[];
  create: (connection: GitConnection, name?: string, teamId?: string | null) => Project;
  save: (id: string, data: ProjectData) => void;
  // Adds a project, or replaces the one with its id, as it is (used when projects arrive from the account).
  put: (project: Project) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

let keptOf: { projects: Project[]; saved: { projects: Project[] } } | null = null;
function keptProjects(s: ProjectsStore): { projects: Project[] } {
  if (keptOf && keptOf.projects === s.projects) return keptOf.saved;
  keptOf = { projects: s.projects, saved: { projects: s.projects } };
  return keptOf.saved;
}

export const useProjectsStore = create<ProjectsStore>()(
  persist(
    (set) => ({
      projects: [],

      create: (connection, name, teamId) => {
        const now = Date.now();
        const project: Project = {
          id: nanoid(8),
          name: name?.trim() || connection.repo,
          createdAt: now,
          updatedAt: now,
          repo: { connection, analysis: null, tokenLink: null },
          library: { source: null, components: [] },
          tokens: emptyStoredTokenData(),
          docs: [],
          ...(teamId ? { teamId } : {}),
        };
        set((s) => ({ projects: [...s.projects, project] }));
        return project;
      },

      save: (id, data) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...data, updatedAt: Date.now() } : p)) })),

      put: (project) =>
        set((s) => ({ projects: s.projects.some((p) => p.id === project.id) ? s.projects.map((p) => (p.id === project.id ? project : p)) : [...s.projects, project] })),

      rename: (id, name) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)) })),

      remove: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
    }),
    {
      name: "motif-projects",
      version: 3,
      // Written a moment after the last change, and when the page is left: a design system with its scan and components is
      // large, and the editor saves into it every half second.
      storage: debouncedStorage<{ projects: Project[] }>({
        onProblem: (failed) => storageProblem.getState().set("projects", failed ? "Your projects couldn't be saved in this browser (it is out of room, or blocks storage), so a reload would lose the latest changes." : null),
      }),
      // What is kept is the projects, as the same object for as long as they are the same.
      partialize: keptProjects as never,
      // Version 1 projects also held a free-form canvas and Motif's own components; only the documentation of the
      // repository's components and tokens is kept from them.
      migrate: (persisted) => {
        const state = persisted as { projects?: (Project & { content?: { docs?: DocPage[] } })[] };
        const native = new Set(["preview", "props", "code"]);
        const projects = (state.projects ?? []).map(({ content, ...rest }) => ({
          ...rest,
          docs: (rest.docs ?? content?.docs ?? [])
            .filter((p) => !p.id.startsWith("doc-comp-"))
            .map((p) => ({ ...p, blocks: p.blocks.filter((b: DocBlock) => !native.has(b.type)) })),
        }));
        return { ...state, projects } as ProjectsStore;
      },
      // Whatever shape the tokens of a project were saved in (the five lists of version 2, the typed model), they are read as the typed model.
      merge: (persisted, current) => {
        const saved = persisted as { projects?: Project[] } | undefined;
        if (!saved || !Array.isArray(saved.projects)) return current;
        return { ...current, projects: saved.projects.map((p) => (p.tokens && (p.tokens as { tokensVersion?: unknown }).tokensVersion === 3 ? p : { ...p, tokens: migrateTokenData(p.tokens) })) };
      },
    }
  )
);

// Left behind by the file-based versions of Motif, which kept design files, one repository connection and one
// token set for the whole browser. Projects replace them.
const LEGACY_KEYS = ["motif-files", "motif-git", "motif-library", "motif-design-system"];

export function clearLegacyStorage() {
  for (const key of LEGACY_KEYS) safeStorage.removeItem(key);
}
