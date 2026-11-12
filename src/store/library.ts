import { create } from "zustand";
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
  // Components as they are with the changes made in the editor, read again from the edited text. Not saved:
  // it goes away with the changes.
  live: Record<string, LibraryComponent>;
  setLive: (id: string, component: LibraryComponent | null) => void;
  importComponents: (analysis: RepoAnalysis) => number;
  updateComponents: (analysis: RepoAnalysis) => UpdateSummary;
  setActive: (id: string | null) => void;
  clear: () => void;
  load: (library: LibraryData) => void;
}

// What a project keeps of the library.
export interface LibraryData {
  source: LibrarySource | null;
  components: LibraryComponent[];
}

const sourceOf = (a: RepoAnalysis): LibrarySource => ({
  repo: a.repo,
  branch: a.ref,
  importedAt: Date.now(),
  tailwindVersion: a.stack.tailwindVersion,
  tailwindEntry: a.tailwindEntry,
  styleFiles: a.styleFiles,
});

// Held in memory for the project that is open; the project keeps `source` and `components`.
export const useLibraryStore = create<LibraryStore>()(
    (set, get) => ({
      source: null,
      components: [],
      activeId: null,
      live: {},
      setLive: (id, component) =>
        set((s) => {
          if (component === null) {
            if (!(id in s.live)) return s;
            const { [id]: _, ...rest } = s.live;
            return { live: rest };
          }
          return { live: { ...s.live, [id]: component } };
        }),

      importComponents: (analysis) => {
        const components = toLibrary(analysis.components);
        set({ source: sourceOf(analysis), components, activeId: null, live: {} });
        return components.length;
      },

      updateComponents: (analysis) => {
        const components = toLibrary(analysis.components);
        const summary = diffLibrary(get().components, components);
        const { activeId } = get();
        set({ source: sourceOf(analysis), components, live: {}, activeId: components.some((c) => c.id === activeId) ? activeId : null });
        return summary;
      },

      setActive: (activeId) => set({ activeId }),
      clear: () => set({ source: null, components: [], activeId: null, live: {} }),
      load: ({ source, components }) => set({ source, components, activeId: null, live: {} }),
    })
);

// The component being shown, with the changes made to it in the editor.
export const activeComponent = (s: Pick<LibraryStore, "components" | "activeId" | "live">): LibraryComponent | undefined =>
  s.activeId === null ? undefined : s.live[s.activeId] ?? s.components.find((c) => c.id === s.activeId);
