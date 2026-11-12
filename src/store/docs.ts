import { create } from "zustand";
import { isBuiltInPage } from "@/lib/docs";
import type { DocPage } from "@/lib/motif-document";

// Documentation pages of the file open in the editor; saved with the file like the canvas.
interface DocsStore {
  pages: DocPage[];
  setPages: (pages: DocPage[]) => void;
  // Adds the page when it is not stored yet: built-in pages only exist once edited.
  savePage: (page: DocPage) => void;
  deletePage: (id: string) => void;
  // Reorders among the designer's own pages.
  movePage: (id: string, delta: -1 | 1) => void;
}

export const useDocsStore = create<DocsStore>((set) => ({
  pages: [],
  setPages: (pages) => set({ pages }),
  savePage: (page) =>
    set((s) => ({
      pages: s.pages.some((p) => p.id === page.id)
        ? s.pages.map((p) => (p.id === page.id ? page : p))
        : [...s.pages, page],
    })),
  deletePage: (id) => set((s) => ({ pages: s.pages.filter((p) => p.id !== id) })),
  movePage: (id, delta) =>
    set((s) => {
      const own = s.pages.map((p, i) => (isBuiltInPage(p.id) ? -1 : i)).filter((i) => i !== -1);
      const at = own.findIndex((i) => s.pages[i].id === id);
      const swap = own[at + delta];
      if (at === -1 || swap === undefined) return s;
      const pages = [...s.pages];
      [pages[own[at]], pages[swap]] = [pages[swap], pages[own[at]]];
      return { pages };
    }),
}));
