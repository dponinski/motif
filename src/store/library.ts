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
  // The repository component shown in the editor on the canvas.
  activeId: string | null;
  // Components as they are with the changes made in the editor, read again from the edited text. Not saved:
  // it goes away with the changes.
  live: Record<string, LibraryComponent>;
  setLive: (id: string, component: LibraryComponent | null) => void;
  // Components made here and not in the repository yet: they stay in the list across reads until the repository has them.
  drafts: LibraryComponent[];
  addDraft: (component: LibraryComponent) => void;
  // Gives up the drafts whose files are among these.
  dropDrafts: (files: string[]) => void;
  // Drafts that are put away because their files aren't among the editor's changes any more (undone, or sent as a pull
  // request), and brought back if the files are (redone).
  parked: LibraryComponent[];
  syncDrafts: (created: Record<string, string>) => void;
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
  drafts?: LibraryComponent[];
}

// What is read from the repository, with the components made here that it doesn't have yet kept after it.
const withDrafts = (read: LibraryComponent[], drafts: LibraryComponent[]) => {
  const kept = drafts.filter((d) => !read.some((c) => c.id === d.id));
  return { components: [...read, ...kept], drafts: kept };
};

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
      drafts: [],
      addDraft: (component) =>
        set((s) => ({
          components: [...s.components.filter((c) => c.id !== component.id), component],
          drafts: [...s.drafts.filter((c) => c.id !== component.id), component],
          activeId: component.id,
        })),
      parked: [],
      syncDrafts: (created) =>
        set((s) => {
          const pool = [...s.drafts, ...s.parked];
          const keep = pool.filter((d) => d.file in created);
          const park = pool.filter((d) => !(d.file in created));
          if (keep.length === s.drafts.length && keep.every((d) => s.drafts.some((x) => x.id === d.id)) && park.length === s.parked.length) return s;
          const hidden = new Set(park.map((d) => d.id));
          const components = [...s.components.filter((c) => !hidden.has(c.id)), ...keep.filter((d) => !s.components.some((c) => c.id === d.id))];
          return { components, drafts: keep, parked: park, activeId: s.activeId && hidden.has(s.activeId) ? null : s.activeId };
        }),
      dropDrafts: (files) =>
        set((s) => {
          const gone = new Set(s.drafts.filter((d) => files.includes(d.file)).map((d) => d.id));
          if (gone.size === 0) return s;
          return {
            components: s.components.filter((c) => !gone.has(c.id)),
            drafts: s.drafts.filter((d) => !gone.has(d.id)),
            activeId: s.activeId && gone.has(s.activeId) ? null : s.activeId,
          };
        }),
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
        const read = toLibrary(analysis.components);
        const { components, drafts } = withDrafts(read, get().drafts);
        set({ source: sourceOf(analysis), components, drafts, activeId: null, live: {} });
        return read.length;
      },

      updateComponents: (analysis) => {
        const read = toLibrary(analysis.components);
        const { components, drafts } = withDrafts(read, get().drafts);
        // What was there before without the drafts, which aren't from the repository, against what it has now.
        const summary = diffLibrary(get().components.filter((c) => !get().drafts.some((d) => d.id === c.id)), read);
        const { activeId } = get();
        set({ source: sourceOf(analysis), components, drafts, live: {}, activeId: components.some((c) => c.id === activeId) ? activeId : null });
        return summary;
      },

      setActive: (activeId) => set({ activeId }),
      clear: () => set({ source: null, components: [], drafts: [], parked: [], activeId: null, live: {} }),
      load: ({ source, components, drafts }) => set({ source, components, drafts: drafts ?? [], parked: [], activeId: null, live: {} }),
    })
);

// The component being shown, with the changes made to it in the editor.
export const activeComponent = (s: Pick<LibraryStore, "components" | "activeId" | "live">): LibraryComponent | undefined =>
  s.activeId === null ? undefined : s.live[s.activeId] ?? s.components.find((c) => c.id === s.activeId);
