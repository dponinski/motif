import { create } from "zustand";
import { persist } from "zustand/middleware";
import { diffLibrary, toLibrary, type LibraryComponent, type UpdateSummary } from "@/lib/preview/library";
import type { RepoAnalysis } from "@/lib/repo-scan/types";

// What previews need to know about the repository the components came from.
export interface LibrarySource {
  repo: string;
  branch: string;
  importedAt: number;
  tailwindVersion: 3 | 4 | null;
  tailwindEntry: string | null;
  styleFiles: string[];
}

interface LibraryStore {
  source: LibrarySource | null;
  components: LibraryComponent[];
  // The repository component shown in the editor in place of the canvas.
  activeId: string | null;
  importComponents: (analysis: RepoAnalysis) => number;
  updateComponents: (analysis: RepoAnalysis) => UpdateSummary;
  setActive: (id: string | null) => void;
  clear: () => void;
}

const sourceOf = (a: RepoAnalysis): LibrarySource => ({
  repo: a.repo,
  branch: a.ref,
  importedAt: Date.now(),
  tailwindVersion: a.stack.tailwindVersion,
  tailwindEntry: a.tailwindEntry,
  styleFiles: a.styleFiles,
});

export const useLibraryStore = create<LibraryStore>()(
  persist(
    (set, get) => ({
      source: null,
      components: [],
      activeId: null,

      importComponents: (analysis) => {
        const components = toLibrary(analysis.components);
        set({ source: sourceOf(analysis), components, activeId: null });
        return components.length;
      },

      updateComponents: (analysis) => {
        const components = toLibrary(analysis.components);
        const summary = diffLibrary(get().components, components);
        const { activeId } = get();
        set({ source: sourceOf(analysis), components, activeId: components.some((c) => c.id === activeId) ? activeId : null });
        return summary;
      },

      setActive: (activeId) => set({ activeId }),
      clear: () => set({ source: null, components: [], activeId: null }),
    }),
    { name: "motif-library", partialize: (s) => ({ source: s.source, components: s.components }) }
  )
);
