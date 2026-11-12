import type { CanvasElement } from "../store/canvas";

// Where an element is in the scene: its own position added to that of every frame it sits in.
export function absPos(el: Pick<CanvasElement, "x" | "y" | "parentId">, elements: Record<string, Pick<CanvasElement, "x" | "y" | "parentId">>): { x: number; y: number } {
  if (!el.parentId || !elements[el.parentId]) return { x: el.x, y: el.y };
  const parent = absPos(elements[el.parentId], elements);
  return { x: parent.x + el.x, y: parent.y + el.y };
}

// A canvas viewport transform (zoom and pan) as a CSS matrix, so a layer of DOM can follow the canvas exactly.
export function matrixCss(vpt: readonly number[]): string {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = vpt;
  return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}

// Where a scene point is on screen for a given zoom and pan (pan is in scene units, as the canvas store keeps it).
export const sceneToScreen = (x: number, y: number, zoom: number, panX: number, panY: number) => ({ x: (x + panX) * zoom, y: (y + panY) * zoom });

// Where the middle of what is on screen is in the scene, for placing something new where it can be seen.
export const visibleOrigin = (zoom: number, panX: number, panY: number, offset = 100) => ({ x: Math.round(-panX + offset / zoom), y: Math.round(-panY + offset / zoom) });
