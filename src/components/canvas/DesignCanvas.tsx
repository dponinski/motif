"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasStore, type CanvasElement } from "@/store/canvas";
import { cn } from "@/lib/utils";

// Fabric.js is loaded dynamically to avoid SSR issues
type FabricCanvas = import("fabric").Canvas;
type FabricObject = import("fabric").FabricObject;

const CANVAS_BG = "#141414";
const GRID_COLOR = "rgba(255,255,255,0.04)";
const FRAME_BG = "#ffffff";

export default function DesignCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const drawingRef = useRef(false);
  const startPtRef = useRef({ x: 0, y: 0 });
  const activeShapeRef = useRef<FabricObject | null>(null);
  const isPanningRef = useRef(false);
  const lastPanRef = useRef({ x: 0, y: 0 });

  const {
    activeTool,
    zoom,
    panX,
    panY,
    elements,
    order,
    selectedIds,
    showGrid,
    setSelectedIds,
    addElement,
    updateElement,
    setActiveTool,
    setPan,
    pushHistory,
  } = useCanvasStore();

  // Initialize fabric canvas
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || fabricRef.current) return;

    const container = containerRef.current;

    import("fabric").then(({ Canvas }) => {
      if (!canvasRef.current || fabricRef.current) return;

      const canvas = new Canvas(canvasRef.current, {
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundColor: CANVAS_BG,
        selection: true,
        preserveObjectStacking: true,
        stopContextMenu: true,
      });

      fabricRef.current = canvas;

      // Handle selection
      canvas.on("selection:created", (e) => {
        const ids = (e.selected || [])
          .map((o: FabricObject) => (o as FabricObject & { motifId?: string }).motifId)
          .filter(Boolean) as string[];
        setSelectedIds(ids);
      });

      canvas.on("selection:updated", (e) => {
        const ids = (e.selected || [])
          .map((o: FabricObject) => (o as FabricObject & { motifId?: string }).motifId)
          .filter(Boolean) as string[];
        setSelectedIds(ids);
      });

      canvas.on("selection:cleared", () => {
        setSelectedIds([]);
      });

      canvas.on("object:modified", (e) => {
        const obj = e.target as FabricObject & { motifId?: string };
        if (!obj?.motifId) return;

        const bounds = obj.getBoundingRect();
        updateElement(obj.motifId, {
          x: Math.round(obj.left ?? 0),
          y: Math.round(obj.top ?? 0),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          rotation: Math.round(obj.angle ?? 0),
        });
        pushHistory();
      });

      // Render grid on background
      renderGrid(canvas, container.clientWidth, container.clientHeight);
    });

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (fabricRef.current) {
        fabricRef.current.setWidth(width);
        fabricRef.current.setHeight(height);
        renderGrid(fabricRef.current, width, height);
        fabricRef.current.renderAll();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Sync elements to fabric canvas
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    syncElementsToCanvas(canvas, elements, order);
  }, [elements, order]);

  // Sync zoom/pan
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.setZoom(zoom);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canvas.absolutePan({ x: -panX * zoom, y: -panY * zoom } as any);
    canvas.renderAll();
  }, [zoom, panX, panY]);

  // Sync grid visibility
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !containerRef.current) return;
    renderGrid(canvas, containerRef.current.clientWidth, containerRef.current.clientHeight);
    canvas.renderAll();
  }, [showGrid]);

  // Handle tool-based mouse interactions
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = false;

    if (activeTool === "select") {
      canvas.defaultCursor = "default";
      canvas.hoverCursor = "move";
      canvas.selection = true;
      canvas.getObjects().forEach((o) => { o.selectable = true; o.evented = true; });
    } else if (activeTool === "hand") {
      canvas.defaultCursor = "grab";
      canvas.hoverCursor = "grab";
      canvas.selection = false;
      canvas.getObjects().forEach((o) => { o.selectable = false; o.evented = false; });
    } else {
      canvas.defaultCursor = "crosshair";
      canvas.hoverCursor = "crosshair";
      canvas.selection = false;
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  }, [activeTool]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      if (activeTool === "hand") {
        isPanningRef.current = true;
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (activeTool === "select") return;

      // Drawing mode
      const rect = (e.target as HTMLElement).closest("canvas")?.getBoundingClientRect();
      if (!rect) return;

      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const x = (clientX - vpt[4]) / zoom;
      const y = (clientY - vpt[5]) / zoom;

      startPtRef.current = { x, y };
      drawingRef.current = true;

      import("fabric").then(({ Rect, Ellipse, Textbox, Group }) => {
        const fill =
          activeTool === "text" ? "transparent" : activeTool === "frame" ? FRAME_BG : "#6366f1";

        let shape: FabricObject;

        if (activeTool === "rectangle" || activeTool === "frame") {
          shape = new Rect({
            left: x,
            top: y,
            width: 1,
            height: 1,
            fill,
            stroke: activeTool === "frame" ? "#c7d2fe" : undefined,
            strokeWidth: activeTool === "frame" ? 1 : 0,
            selectable: false,
            evented: false,
          });
        } else if (activeTool === "ellipse") {
          shape = new Ellipse({
            left: x,
            top: y,
            rx: 0,
            ry: 0,
            fill,
            selectable: false,
            evented: false,
          });
        } else if (activeTool === "text") {
          // Text is placed on mouse up
          return;
        } else {
          return;
        }

        canvas.add(shape);
        activeShapeRef.current = shape;
      });
    },
    [activeTool, zoom]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      if (activeTool === "hand" && isPanningRef.current) {
        const dx = e.clientX - lastPanRef.current.x;
        const dy = e.clientY - lastPanRef.current.y;
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        const { panX: curPanX, panY: curPanY } = useCanvasStore.getState();
        setPan(curPanX + dx / zoom, curPanY + dy / zoom);
        return;
      }

      if (!drawingRef.current || !activeShapeRef.current) return;

      const rect = (e.target as HTMLElement).closest("canvas")?.getBoundingClientRect();
      if (!rect) return;

      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const x = (clientX - vpt[4]) / zoom;
      const y = (clientY - vpt[5]) / zoom;

      const { x: sx, y: sy } = startPtRef.current;
      const w = Math.abs(x - sx);
      const h = Math.abs(y - sy);
      const left = Math.min(x, sx);
      const top = Math.min(y, sy);

      const shape = activeShapeRef.current as FabricObject & {
        set: (props: Record<string, unknown>) => void;
        rx?: number;
        ry?: number;
      };

      if ("rx" in shape) {
        shape.set({ left, top, rx: w / 2, ry: h / 2 });
      } else {
        shape.set({ left, top, width: Math.max(1, w), height: Math.max(1, h) });
      }

      canvas.renderAll();
    },
    [activeTool, zoom, setPan]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      if (activeTool === "hand") {
        isPanningRef.current = false;
        return;
      }

      if (activeTool === "text" && !drawingRef.current) {
        const rect = (e.target as HTMLElement).closest("canvas")?.getBoundingClientRect();
        if (!rect) return;
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;
        const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        const x = (clientX - vpt[4]) / zoom;
        const y = (clientY - vpt[5]) / zoom;

        const id = addElement({
          type: "text",
          name: "Text",
          x,
          y,
          width: 200,
          height: 32,
          fill: "transparent",
          fontColor: "#0a0a0a",
          content: "Type something",
          fontSize: 16,
          fontWeight: "400",
          fontFamily: "Inter",
          opacity: 1,
          rotation: 0,
        });
        setActiveTool("select");
        drawingRef.current = false;
        return;
      }

      if (!drawingRef.current || !activeShapeRef.current) return;
      drawingRef.current = false;

      const shape = activeShapeRef.current as FabricObject & { motifId?: string };
      activeShapeRef.current = null;

      const bounds = shape.getBoundingRect();

      // Minimum size check
      if (bounds.width < 4 || bounds.height < 4) {
        canvas.remove(shape);
        canvas.renderAll();
        return;
      }

      // Remove temp fabric object and add to store instead
      canvas.remove(shape);

      const typeMap: Record<string, CanvasElement["type"]> = {
        rectangle: "rectangle",
        frame: "frame",
        ellipse: "ellipse",
      };

      addElement({
        type: typeMap[activeTool] ?? "rectangle",
        name:
          activeTool === "frame"
            ? "Frame"
            : activeTool === "rectangle"
            ? "Rectangle"
            : "Ellipse",
        x: Math.round(bounds.left),
        y: Math.round(bounds.top),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        fill: activeTool === "frame" ? FRAME_BG : "#6366f1",
        stroke: activeTool === "frame" ? "#c7d2fe" : undefined,
        strokeWidth: activeTool === "frame" ? 1 : 0,
        cornerRadius: 0,
        opacity: 1,
        rotation: 0,
        children: activeTool === "frame" ? [] : undefined,
      });

      setActiveTool("select");
    },
    [activeTool, zoom, addElement, setActiveTool]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const { zoom: curZoom, panX: curPanX, panY: curPanY } = useCanvasStore.getState();

      if (e.ctrlKey || e.metaKey) {
        // Zoom
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        const newZoom = Math.min(8, Math.max(0.1, curZoom + delta));
        useCanvasStore.getState().setZoom(newZoom);
      } else {
        // Pan
        setPan(curPanX - e.deltaX / curZoom, curPanY - e.deltaY / curZoom);
      }
    },
    [setPan]
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "canvas-wrap w-full h-full relative overflow-hidden",
        `tool-${activeTool}`,
        activeTool === "hand" && isPanningRef.current && "panning"
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} />

      {/* Zoom info overlay */}
      <div className="absolute bottom-3 left-3 text-2xs text-text-tertiary pointer-events-none select-none">
        {Math.round(zoom * 100)}% · {selectedIds.length > 0 ? `${selectedIds.length} selected` : ""}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="absolute bottom-3 right-3 text-2xs text-text-tertiary pointer-events-none select-none flex items-center gap-3">
        <span>⌘K AI</span>
        <span>V Select</span>
        <span>R Rect</span>
        <span>F Frame</span>
        <span>T Text</span>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function syncElementsToCanvas(
  canvas: FabricCanvas,
  elements: Record<string, CanvasElement>,
  order: string[]
) {
  const { Rect, Ellipse, Textbox, Circle } = await import("fabric");

  // Build set of motifIds currently on canvas
  const existing = new Map<string, FabricObject>();
  for (const obj of canvas.getObjects()) {
    const o = obj as FabricObject & { motifId?: string };
    if (o.motifId) existing.set(o.motifId, obj);
  }

  const wanted = new Set<string>();

  // Flatten all elements to render (in order)
  const toRender = flattenOrder(order, elements);

  for (const id of toRender) {
    const el = elements[id];
    if (!el || el.visible === false) {
      if (existing.has(id)) {
        canvas.remove(existing.get(id)!);
        existing.delete(id);
      }
      continue;
    }

    wanted.add(id);

    if (existing.has(id)) {
      // Update existing
      updateFabricObject(existing.get(id)!, el);
    } else {
      // Create new
      const obj = createFabricObject(el, { Rect, Ellipse, Textbox, Circle });
      if (obj) {
        (obj as FabricObject & { motifId: string }).motifId = id;
        canvas.add(obj);
      }
    }
  }

  // Remove objects no longer in elements
  for (const [id, obj] of existing) {
    if (!wanted.has(id)) {
      canvas.remove(obj);
    }
  }

  canvas.renderAll();
}

function flattenOrder(
  order: string[],
  elements: Record<string, CanvasElement>
): string[] {
  const result: string[] = [];
  for (const id of order) {
    result.push(id);
    const el = elements[id];
    if (el?.children?.length) {
      result.push(...flattenOrder(el.children, elements));
    }
  }
  return result;
}

function createFabricObject(
  el: CanvasElement,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fabric: Record<string, any>
): FabricObject | null {
  const common = {
    left: el.x,
    top: el.y,
    angle: el.rotation ?? 0,
    opacity: el.opacity ?? 1,
    cornerSize: 7,
    cornerColor: "#6366f1",
    cornerStrokeColor: "white",
    transparentCorners: false,
    borderColor: "#6366f1",
    padding: 1,
  };

  if (el.type === "rectangle" || el.type === "frame") {
    return new fabric.Rect({
      ...common,
      width: el.width,
      height: el.height,
      fill: el.fill ?? (el.type === "frame" ? "#ffffff" : "#6366f1"),
      stroke: el.stroke,
      strokeWidth: el.strokeWidth ?? 0,
      rx: el.cornerRadius ?? 0,
      ry: el.cornerRadius ?? 0,
    });
  }

  if (el.type === "ellipse") {
    return new fabric.Ellipse({
      ...common,
      rx: el.width / 2,
      ry: el.height / 2,
      fill: el.fill ?? "#6366f1",
      stroke: el.stroke,
      strokeWidth: el.strokeWidth ?? 0,
    });
  }

  if (el.type === "text") {
    return new fabric.Textbox(el.content ?? "Text", {
      ...common,
      width: el.width,
      fill: el.fontColor ?? el.fill ?? "#0a0a0a",
      fontSize: el.fontSize ?? 16,
      fontWeight: el.fontWeight ?? "400",
      fontFamily: el.fontFamily ?? "Inter",
    });
  }

  return null;
}

function updateFabricObject(obj: FabricObject, el: CanvasElement) {
  const o = obj as FabricObject & {
    set: (props: Record<string, unknown>) => void;
    text?: string;
    rx?: number;
    ry?: number;
  };

  o.set({
    left: el.x,
    top: el.y,
    angle: el.rotation ?? 0,
    opacity: el.opacity ?? 1,
    fill: el.type === "text" ? (el.fontColor ?? "#0a0a0a") : (el.fill ?? "#6366f1"),
    stroke: el.stroke,
    strokeWidth: el.strokeWidth ?? 0,
  });

  if (el.type === "rectangle" || el.type === "frame") {
    o.set({ width: el.width, height: el.height, rx: el.cornerRadius ?? 0, ry: el.cornerRadius ?? 0 });
  } else if (el.type === "ellipse") {
    o.set({ rx: el.width / 2, ry: el.height / 2 });
  } else if (el.type === "text") {
    o.set({
      width: el.width,
      fontSize: el.fontSize ?? 16,
      fontWeight: el.fontWeight ?? "400",
      fontFamily: el.fontFamily ?? "Inter",
    });
    if ("text" in o && o.text !== el.content) {
      o.set({ text: el.content ?? "" });
    }
  }
}

function renderGrid(canvas: FabricCanvas, width: number, height: number) {
  if (!useCanvasStore.getState().showGrid) {
    canvas.backgroundColor = CANVAS_BG;
    return;
  }

  // Draw grid as a background pattern using HTML canvas
  const gridSize = 20;
  const bgCanvas = document.createElement("canvas");
  bgCanvas.width = width;
  bgCanvas.height = height;
  const ctx = bgCanvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;

  // Vertical lines
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Horizontal lines
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  canvas.backgroundColor = new URL(bgCanvas.toDataURL()).href;
}
