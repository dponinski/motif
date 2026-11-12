import { initialProps } from "@/lib/preview/props";
import type { LibraryComponent } from "@/lib/preview/library";
import { useCanvasStore, type RepoComponentRef } from "@/store/canvas";
import { useLibraryStore } from "@/store/library";

// The props a placed component starts with: the values the stage starts with, as plain data a document can hold.
export function plainProps(component: LibraryComponent): Record<string, unknown> {
  return Object.fromEntries(Object.entries(initialProps(component)).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)));
}

// Puts a repository component on the design canvas and shows the canvas, so it can be laid out.
export function placeOnCanvas(component: LibraryComponent): string | null {
  const source = useLibraryStore.getState().source;
  if (!source) return null;
  const ref: RepoComponentRef = { repo: source.repo, branch: source.branch, file: component.file, name: component.name, exported: component.exported };
  const id = useCanvasStore.getState().placeRepoInstance(ref, plainProps(component));
  useLibraryStore.getState().setActive(null);
  return id;
}
