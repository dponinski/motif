import { componentPageId, pageComponentId } from "@/lib/docs";
import type { DocumentContent } from "@/lib/motif-document";
import { useCanvasStore } from "./canvas";
import { useDocsStore } from "./docs";

// The open file is spread over the canvas and docs stores; these keep the two in step.

export function loadOpenDocument(content: DocumentContent, activeComponentId?: string) {
  useCanvasStore.getState().loadDocument(content, activeComponentId);
  useDocsStore.getState().setPages(content.docs);
}

export function snapshotOpenDocument(): DocumentContent {
  const scene = useCanvasStore.getState().getDocumentContent();
  const live = new Set(scene.components.map((c) => componentPageId(c.id)));
  // Pages documenting a deleted component go with it.
  const docs = useDocsStore.getState().pages.filter((p) => pageComponentId(p.id) === null || live.has(p.id));
  return { ...scene, docs };
}
