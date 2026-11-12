import { create } from "zustand";
import { nanoid } from "nanoid";

export interface ComponentGroup {
  id: string;
  name: string;
}

export interface VariantProp {
  id: string;
  name: string;
  values: string[];
  default: string;
}

export interface ComponentDef {
  id: string;
  name: string;
  groupId: string | null;
  variantProps: VariantProp[];
}

const MAIN_COMPONENT_ID = "comp-main";

export type Tool =
  | "select"
  | "frame"
  | "rectangle"
  | "ellipse"
  | "text"
  | "hand";

export interface CanvasElement {
  id: string;
  type: "frame" | "rectangle" | "ellipse" | "text" | "group" | "instance";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  fillTokenId?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity: number;
  rotation: number;
  cornerRadius?: number;
  // text
  content?: string;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  fontColor?: string;
  typographyTokenId?: string;
  // hierarchy
  parentId?: string;
  children?: string[];
  locked?: boolean;
  visible?: boolean;
  // instance
  componentId?: string;
  instanceProps?: Record<string, string>;
}

interface HistoryEntry {
  elements: Record<string, CanvasElement>;
  order: string[];
}

interface SceneSnapshot {
  elements: Record<string, CanvasElement>;
  order: string[];
}

interface CanvasStore {
  activeTool: Tool;
  zoom: number;
  panX: number;
  panY: number;
  selectedIds: string[];
  elements: Record<string, CanvasElement>;
  order: string[]; // root-level z-order
  history: HistoryEntry[];
  historyIndex: number;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  clipboard: CanvasElement[];

  // Multi-component support
  componentGroups: ComponentGroup[];
  componentDefs: ComponentDef[];
  activeComponentId: string;
  componentScenes: Record<string, SceneSnapshot>;

  setActiveTool: (tool: Tool) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setSelectedIds: (ids: string[]) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  addElement: (element: Omit<CanvasElement, "id">) => string;
  updateElement: (id: string, updates: Partial<CanvasElement>) => void;
  updateElements: (updates: Record<string, Partial<CanvasElement>>) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  pasteClipboard: () => void;
  reparentElement: (id: string, newParentId: string | null, relX?: number, relY?: number) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  clearCanvas: () => void;
  loadElements: (elements: CanvasElement[]) => void;

  // Component management
  setActiveComponent: (id: string) => void;
  createComponent: (name: string, groupId?: string | null) => string;
  deleteComponent: (id: string) => void;
  renameComponent: (id: string, name: string) => void;
  createGroup: (name: string) => string;
  deleteGroup: (id: string) => void;
  renameGroup: (id: string, name: string) => void;

  // Variant props
  addVariantProp: (componentId: string, name: string) => void;
  updateVariantProp: (componentId: string, propId: string, patch: Partial<Omit<VariantProp, "id">>) => void;
  removeVariantProp: (componentId: string, propId: string) => void;

  // Instances
  placeInstance: (componentId: string) => void;
}

const DEFAULT_ELEMENTS: CanvasElement[] = [
  {
    id: "frame-1",
    type: "frame",
    name: "Frame 1",
    x: 100,
    y: 80,
    width: 375,
    height: 812,
    fill: "#ffffff",
    opacity: 1,
    rotation: 0,
    cornerRadius: 0,
    children: ["rect-1", "text-1", "btn-1"],
  },
  {
    id: "rect-1",
    type: "rectangle",
    name: "Hero Banner",
    x: 0,
    y: 0,
    width: 375,
    height: 220,
    fill: "#6366f1",
    opacity: 1,
    rotation: 0,
    cornerRadius: 0,
    parentId: "frame-1",
  },
  {
    id: "text-1",
    type: "text",
    name: "Heading",
    x: 24,
    y: 240,
    width: 327,
    height: 36,
    fill: "transparent",
    fontColor: "#0a0a0a",
    content: "Welcome to Motif",
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter",
    opacity: 1,
    rotation: 0,
    parentId: "frame-1",
  },
  {
    id: "btn-1",
    type: "rectangle",
    name: "Primary Button",
    x: 24,
    y: 300,
    width: 160,
    height: 44,
    fill: "#6366f1",
    opacity: 1,
    rotation: 0,
    cornerRadius: 8,
    parentId: "frame-1",
  },
];

function buildInitialState() {
  const elements: Record<string, CanvasElement> = {};
  const order: string[] = [];

  for (const el of DEFAULT_ELEMENTS) {
    elements[el.id] = el;
    if (!el.parentId) {
      order.push(el.id);
    }
  }

  return { elements, order };
}

const { elements: initElements, order: initOrder } = buildInitialState();

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  activeTool: "select",
  zoom: 1,
  panX: 0,
  panY: 0,
  selectedIds: [],
  elements: initElements,
  order: initOrder,
  history: [],
  historyIndex: -1,
  showGrid: true,
  snapToGrid: false,
  gridSize: 8,
  clipboard: [],

  componentGroups: [],
  componentDefs: [{ id: MAIN_COMPONENT_ID, name: "Main", groupId: null, variantProps: [] }],
  activeComponentId: MAIN_COMPONENT_ID,
  componentScenes: {
    [MAIN_COMPONENT_ID]: { elements: initElements, order: initOrder },
  },

  setActiveTool: (tool) => set({ activeTool: tool }),
  setZoom: (zoom) => set({ zoom: Math.min(256, Math.max(0.02, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  nudgeSelected: (dx, dy) => {
    const { selectedIds, elements } = get();
    if (!selectedIds.length) return;
    const updates: Record<string, Partial<CanvasElement>> = {};
    for (const id of selectedIds) {
      const el = elements[id];
      if (el) updates[id] = { x: el.x + dx, y: el.y + dy };
    }
    get().updateElements(updates);
  },

  addElement: (element) => {
    const id = nanoid(8);
    const newEl: CanvasElement = { ...element, id };
    set((state) => {
      const nextElements: Record<string, CanvasElement> = { ...state.elements, [id]: newEl };
      // Register with parent's children list
      if (newEl.parentId && state.elements[newEl.parentId]) {
        nextElements[newEl.parentId] = {
          ...state.elements[newEl.parentId],
          children: [...(state.elements[newEl.parentId].children ?? []), id],
        };
      }
      return {
        elements: nextElements,
        order: newEl.parentId ? state.order : [...state.order, id],
        selectedIds: [id],
      };
    });
    get().pushHistory();
    return id;
  },

  updateElement: (id, updates) => {
    set((state) => ({
      elements: {
        ...state.elements,
        [id]: { ...state.elements[id], ...updates },
      },
    }));
  },

  updateElements: (updates) => {
    set((state) => {
      const next = { ...state.elements };
      for (const [id, patch] of Object.entries(updates)) {
        if (next[id]) next[id] = { ...next[id], ...patch };
      }
      return { elements: next };
    });
  },

  deleteSelected: () => {
    const { selectedIds, elements, order } = get();
    if (!selectedIds.length) return;

    const toDelete = new Set(selectedIds);
    const newElements = { ...elements };
    const newOrder = order.filter((id) => !toDelete.has(id));

    for (const id of toDelete) {
      // Remove from parent children
      const el = elements[id];
      if (el.parentId && newElements[el.parentId]) {
        newElements[el.parentId] = {
          ...newElements[el.parentId],
          children: newElements[el.parentId].children?.filter((c) => c !== id),
        };
      }
      delete newElements[id];
    }

    set({ elements: newElements, order: newOrder, selectedIds: [] });
    get().pushHistory();
  },

  duplicateSelected: () => {
    const { selectedIds, elements, order } = get();
    if (!selectedIds.length) return;

    const newElements = { ...elements };
    const newOrder = [...order];
    const newSelectedIds: string[] = [];

    for (const id of selectedIds) {
      const original = elements[id];
      if (!original) continue;
      const newId = nanoid(8);
      newElements[newId] = {
        ...original,
        id: newId,
        name: `${original.name} Copy`,
        x: original.x + 20,
        y: original.y + 20,
      };
      if (!original.parentId) newOrder.push(newId);
      newSelectedIds.push(newId);
    }

    set({ elements: newElements, order: newOrder, selectedIds: newSelectedIds });
    get().pushHistory();
  },

  copySelected: () => {
    const { selectedIds, elements } = get();
    if (!selectedIds.length) return;
    set({ clipboard: selectedIds.map((id) => elements[id]).filter(Boolean) as CanvasElement[] });
  },

  pasteClipboard: () => {
    const { clipboard, elements, order } = get();
    if (!clipboard.length) return;
    const newElements = { ...elements };
    const newOrder = [...order];
    const newSelectedIds: string[] = [];
    for (const el of clipboard) {
      const newId = nanoid(8);
      newElements[newId] = {
        ...el,
        id: newId,
        x: el.x + 20,
        y: el.y + 20,
        parentId: undefined,
        children: el.type === "frame" ? [] : undefined,
      };
      newOrder.push(newId);
      newSelectedIds.push(newId);
    }
    set({ elements: newElements, order: newOrder, selectedIds: newSelectedIds });
    get().pushHistory();
  },

  reparentElement: (id, newParentId, relX, relY) => {
    set((state) => {
      const el = state.elements[id];
      if (!el) return {};
      const nextElements = { ...state.elements };
      let nextOrder = [...state.order];
      // Remove from old parent or root order
      if (el.parentId && nextElements[el.parentId]) {
        nextElements[el.parentId] = {
          ...nextElements[el.parentId],
          children: nextElements[el.parentId].children?.filter((c) => c !== id) ?? [],
        };
      } else {
        nextOrder = nextOrder.filter((i) => i !== id);
      }
      // Add to new parent or root
      if (newParentId && nextElements[newParentId]) {
        nextElements[newParentId] = {
          ...nextElements[newParentId],
          children: [...(nextElements[newParentId].children ?? []), id],
        };
        nextElements[id] = { ...el, parentId: newParentId, x: relX ?? el.x, y: relY ?? el.y };
      } else {
        nextElements[id] = { ...el, parentId: undefined, x: relX ?? el.x, y: relY ?? el.y };
        nextOrder.push(id);
      }
      return { elements: nextElements, order: nextOrder };
    });
    get().pushHistory();
  },

  bringForward: (id) => {
    set((state) => {
      const idx = state.order.indexOf(id);
      if (idx < state.order.length - 1) {
        const order = [...state.order];
        [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
        return { order };
      }
      return {};
    });
  },

  sendBackward: (id) => {
    set((state) => {
      const idx = state.order.indexOf(id);
      if (idx > 0) {
        const order = [...state.order];
        [order[idx], order[idx - 1]] = [order[idx - 1], order[idx]];
        return { order };
      }
      return {};
    });
  },

  bringToFront: (id) => {
    set((state) => ({
      order: [...state.order.filter((i) => i !== id), id],
    }));
  },

  sendToBack: (id) => {
    set((state) => ({
      order: [id, ...state.order.filter((i) => i !== id)],
    }));
  },

  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),

  pushHistory: () => {
    const { elements, order, history, historyIndex } = get();
    const entry = { elements: { ...elements }, order: [...order] };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(entry);
    // Keep last 50 history entries
    if (newHistory.length > 50) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { historyIndex, history } = get();
    if (historyIndex <= 0) return;
    const entry = history[historyIndex - 1];
    set({
      elements: { ...entry.elements },
      order: [...entry.order],
      historyIndex: historyIndex - 1,
      selectedIds: [],
    });
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex >= history.length - 1) return;
    const entry = history[historyIndex + 1];
    set({
      elements: { ...entry.elements },
      order: [...entry.order],
      historyIndex: historyIndex + 1,
      selectedIds: [],
    });
  },

  clearCanvas: () => {
    set({ elements: {}, order: [], selectedIds: [] });
    get().pushHistory();
  },

  setActiveComponent: (id) => {
    const { activeComponentId, elements, order, componentScenes, componentDefs } = get();
    if (id === activeComponentId || !componentDefs.find((c) => c.id === id)) return;
    // Save current scene before switching
    const nextScenes: Record<string, SceneSnapshot> = {
      ...componentScenes,
      [activeComponentId]: { elements, order },
    };
    const scene = nextScenes[id] ?? { elements: {}, order: [] };
    set({
      componentScenes: nextScenes,
      activeComponentId: id,
      elements: scene.elements,
      order: scene.order,
      selectedIds: [],
      history: [],
      historyIndex: -1,
    });
  },

  createComponent: (name, groupId = null) => {
    const id = nanoid(8);
    set((state) => ({
      componentDefs: [...state.componentDefs, { id, name, groupId: groupId ?? null, variantProps: [] }],
      componentScenes: { ...state.componentScenes, [id]: { elements: {}, order: [] } },
    }));
    return id;
  },

  deleteComponent: (id) => {
    const { componentDefs, activeComponentId, componentScenes } = get();
    if (componentDefs.length <= 1) return; // keep at least one
    const nextDefs = componentDefs.filter((c) => c.id !== id);
    const nextScenes = { ...componentScenes };
    delete nextScenes[id];
    // If deleting active component, switch to first remaining
    if (activeComponentId === id) {
      const fallback = nextDefs[0];
      const scene = nextScenes[fallback.id] ?? { elements: {}, order: [] };
      set({
        componentDefs: nextDefs,
        componentScenes: nextScenes,
        activeComponentId: fallback.id,
        elements: scene.elements,
        order: scene.order,
        selectedIds: [],
        history: [],
        historyIndex: -1,
      });
    } else {
      set({ componentDefs: nextDefs, componentScenes: nextScenes });
    }
  },

  renameComponent: (id, name) => {
    set((state) => ({
      componentDefs: state.componentDefs.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
  },

  createGroup: (name) => {
    const id = nanoid(8);
    set((state) => ({
      componentGroups: [...state.componentGroups, { id, name }],
    }));
    return id;
  },

  deleteGroup: (id) => {
    set((state) => ({
      componentGroups: state.componentGroups.filter((g) => g.id !== id),
      // Move components to ungrouped
      componentDefs: state.componentDefs.map((c) =>
        c.groupId === id ? { ...c, groupId: null } : c
      ),
    }));
  },

  renameGroup: (id, name) => {
    set((state) => ({
      componentGroups: state.componentGroups.map((g) => (g.id === id ? { ...g, name } : g)),
    }));
  },

  addVariantProp: (componentId, name) => {
    const id = nanoid(6);
    const prop: VariantProp = { id, name, values: ["Default"], default: "Default" };
    set((state) => ({
      componentDefs: state.componentDefs.map((c) =>
        c.id === componentId ? { ...c, variantProps: [...c.variantProps, prop] } : c
      ),
    }));
  },

  updateVariantProp: (componentId, propId, patch) => {
    set((state) => ({
      componentDefs: state.componentDefs.map((c) =>
        c.id === componentId
          ? {
              ...c,
              variantProps: c.variantProps.map((p) =>
                p.id === propId ? { ...p, ...patch } : p
              ),
            }
          : c
      ),
    }));
  },

  removeVariantProp: (componentId, propId) => {
    set((state) => ({
      componentDefs: state.componentDefs.map((c) =>
        c.id === componentId
          ? { ...c, variantProps: c.variantProps.filter((p) => p.id !== propId) }
          : c
      ),
    }));
  },

  placeInstance: (componentId) => {
    const { componentDefs } = get();
    const def = componentDefs.find((c) => c.id === componentId);
    if (!def) return;
    const instanceProps: Record<string, string> = {};
    for (const p of def.variantProps) instanceProps[p.name] = p.default;
    const id = nanoid(8);
    const el: CanvasElement = {
      id,
      type: "instance",
      name: `${def.name} instance`,
      x: 100,
      y: 100,
      width: 200,
      height: 80,
      fill: "rgba(99,102,241,0.08)",
      opacity: 1,
      rotation: 0,
      componentId,
      instanceProps,
    };
    set((state) => ({
      elements: { ...state.elements, [id]: el },
      order: [...state.order, id],
      selectedIds: [id],
    }));
    get().pushHistory();
  },

  loadElements: (elList) => {
    const elements: Record<string, CanvasElement> = {};
    const order: string[] = [];
    for (const el of elList) {
      elements[el.id] = el;
      if (!el.parentId) order.push(el.id);
    }
    set({ elements, order, selectedIds: [] });
    get().pushHistory();
  },
}));
