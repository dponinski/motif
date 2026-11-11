"use client";

import { useEffect, useRef, CSSProperties } from "react";
import { useCanvasStore, type CanvasElement } from "@/store/canvas";

// ── Fabric types ──────────────────────────────────────────────────────────────

type FObj = {
  motifId?: string;
  left?: number;
  top?: number;
  angle?: number;
  opacity?: number;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  rx?: number;
  ry?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontFamily?: string;
  selectable?: boolean;
  evented?: boolean;
  set(props: Record<string, unknown>): void;
  getBoundingRect(): { left: number; top: number; width: number; height: number };
  getScaledWidth(): number;
  getScaledHeight(): number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FCanvas = any;

type FabricMod = {
  Canvas: new (el: HTMLCanvasElement, opts: Record<string, unknown>) => FCanvas;
  Rect: new (opts: Record<string, unknown>) => FObj;
  Ellipse: new (opts: Record<string, unknown>) => FObj;
  Textbox: new (text: string, opts: Record<string, unknown>) => FObj;
};

let _fab: FabricMod | null = null;
async function fab(): Promise<FabricMod> {
  if (!_fab) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _fab = await import("fabric") as any;
  }
  return _fab!;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flatIds(ids: string[], elements: Record<string, CanvasElement>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    out.push(id);
    const el = elements[id];
    if (el?.children?.length) out.push(...flatIds(el.children, elements));
  }
  return out;
}

function makeObj(el: CanvasElement, m: FabricMod): FObj | null {
  const common: Record<string, unknown> = {
    left: el.x, top: el.y,
    angle: el.rotation ?? 0,
    opacity: el.opacity ?? 1,
    cornerSize: 7,
    cornerColor: "#6366f1",
    cornerStrokeColor: "#ffffff",
    transparentCorners: false,
    borderColor: "#6366f1",
    padding: 1,
    lockScalingFlip: true,
  };
  if (el.type === "rectangle" || el.type === "frame") {
    return new m.Rect({
      ...common,
      width: el.width, height: el.height,
      fill: el.fill ?? (el.type === "frame" ? "#ffffff" : "#6366f1"),
      stroke: el.stroke ?? null, strokeWidth: el.strokeWidth ?? 0,
      rx: el.cornerRadius ?? 0, ry: el.cornerRadius ?? 0,
    });
  }
  if (el.type === "ellipse") {
    return new m.Ellipse({
      ...common,
      rx: el.width / 2, ry: el.height / 2,
      fill: el.fill ?? "#6366f1",
      stroke: el.stroke ?? null, strokeWidth: el.strokeWidth ?? 0,
    });
  }
  if (el.type === "text") {
    return new m.Textbox(el.content ?? "Text", {
      ...common,
      width: el.width,
      fill: el.fontColor ?? "#111111",
      fontSize: el.fontSize ?? 16,
      fontWeight: el.fontWeight ?? "400",
      fontFamily: el.fontFamily ?? "Inter",
    });
  }
  return null;
}

function applyProps(obj: FObj, el: CanvasElement) {
  obj.set({ left: el.x, top: el.y, angle: el.rotation ?? 0, opacity: el.opacity ?? 1 });
  if (el.type === "rectangle" || el.type === "frame") {
    obj.set({
      width: el.width, height: el.height,
      fill: el.fill ?? (el.type === "frame" ? "#ffffff" : "#6366f1"),
      stroke: el.stroke ?? null, strokeWidth: el.strokeWidth ?? 0,
      rx: el.cornerRadius ?? 0, ry: el.cornerRadius ?? 0,
    });
  } else if (el.type === "ellipse") {
    obj.set({ rx: el.width / 2, ry: el.height / 2, fill: el.fill ?? "#6366f1", stroke: el.stroke ?? null, strokeWidth: el.strokeWidth ?? 0 });
  } else if (el.type === "text") {
    obj.set({ width: el.width, fill: el.fontColor ?? "#111111", fontSize: el.fontSize ?? 16, fontWeight: el.fontWeight ?? "400", fontFamily: el.fontFamily ?? "Inter", text: el.content ?? "" });
  }
}

async function syncCanvas(c: FCanvas, elements: Record<string, CanvasElement>, order: string[]) {
  const m = await fab();
  const existing = new Map<string, FObj>();
  for (const o of c.getObjects()) {
    const obj = o as FObj;
    if (obj.motifId) existing.set(obj.motifId, obj);
  }
  const wanted = new Set<string>();
  for (const id of flatIds(order, elements)) {
    const el = elements[id];
    if (!el || el.visible === false) { if (existing.has(id)) c.remove(existing.get(id)); continue; }
    wanted.add(id);
    if (existing.has(id)) {
      applyProps(existing.get(id)!, el);
    } else {
      const obj = makeObj(el, m);
      if (obj) { obj.motifId = id; c.add(obj); }
    }
  }
  for (const [id, obj] of existing) {
    if (!wanted.has(id)) c.remove(obj);
  }
  c.renderAll();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DesignCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FCanvas>(null);
  const readyRef = useRef(false);

  // Drawing state
  const drawRef = useRef(false);
  const startPt = useRef({ x: 0, y: 0 });
  const previewObj = useRef<FObj | null>(null);

  // Panning state
  const panningRef = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  // when true, pan came from direct mouse drag — skip store-driven re-apply
  const panDirtyRef = useRef(false);

  // Reactive values for CSS grid + status bar only
  const { zoom, panX, panY, showGrid, selectedIds, elements, order, activeTool } = useCanvasStore();

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const el = canvasElRef.current;
    if (!container || !el || fabricRef.current) return;
    let alive = true;

    (async () => {
      const { Canvas, Rect, Ellipse } = await fab();
      if (!alive || fabricRef.current) return;

      const { width, height } = container.getBoundingClientRect();
      const canvas = new Canvas(el, {
        width: Math.max(width, 100),
        height: Math.max(height, 100),
        backgroundColor: "transparent",
        selection: true,
        preserveObjectStacking: true,
        stopContextMenu: true,
      });
      fabricRef.current = canvas;
      readyRef.current = true;

      // mouse:down — synchronous so previewObj is set before mouse:up can fire
      canvas.on("mouse:down", (opt: { e: MouseEvent; scenePoint?: { x: number; y: number } }) => {
        const tool = useCanvasStore.getState().activeTool;

        if (tool === "hand") {
          panningRef.current = true;
          lastMouse.current = { x: opt.e.clientX, y: opt.e.clientY };
          canvas.defaultCursor = "grabbing";
          canvas.hoverCursor = "grabbing";
          return;
        }
        if (tool === "select") return;

        const pt = opt.scenePoint;
        if (!pt) return;

        if (tool === "text") {
          const { addElement, setActiveTool } = useCanvasStore.getState();
          addElement({ type: "text", name: "Text", x: Math.round(pt.x), y: Math.round(pt.y), width: 220, height: 32, fill: "transparent", fontColor: "#111111", content: "Type something", fontSize: 16, fontWeight: "400", fontFamily: "Inter", opacity: 1, rotation: 0 });
          setActiveTool("select");
          return;
        }

        canvas.selection = false;
        canvas.discardActiveObject();
        startPt.current = { x: pt.x, y: pt.y };
        drawRef.current = true;

        const isFrame = tool === "frame";
        let shape: FObj | null = null;
        if (tool === "rectangle" || isFrame) {
          shape = new Rect({ left: pt.x, top: pt.y, width: 1, height: 1, fill: isFrame ? "rgba(255,255,255,0.08)" : "#6366f1", stroke: "#6366f1", strokeWidth: 1, selectable: false, evented: false });
        } else if (tool === "ellipse") {
          shape = new Ellipse({ left: pt.x, top: pt.y, rx: 1, ry: 1, fill: "#6366f1", selectable: false, evented: false });
        }
        if (shape) { canvas.add(shape); previewObj.current = shape; canvas.renderAll(); }
      });

      // mouse:move
      canvas.on("mouse:move", (opt: { e: MouseEvent; scenePoint?: { x: number; y: number } }) => {
        if (panningRef.current) {
          const dx = opt.e.clientX - lastMouse.current.x;
          const dy = opt.e.clientY - lastMouse.current.y;
          lastMouse.current = { x: opt.e.clientX, y: opt.e.clientY };
          const vpt: number[] = canvas.viewportTransform;
          vpt[4] += dx;
          vpt[5] += dy;
          panDirtyRef.current = true;
          canvas.requestRenderAll();
          return;
        }
        if (!drawRef.current || !previewObj.current) return;
        const pt = opt.scenePoint;
        if (!pt) return;
        const { x: sx, y: sy } = startPt.current;
        const w = Math.abs(pt.x - sx), h = Math.abs(pt.y - sy);
        const left = Math.min(pt.x, sx), top = Math.min(pt.y, sy);
        const shape = previewObj.current;
        if (shape.rx !== undefined) {
          shape.set({ left, top, rx: Math.max(1, w / 2), ry: Math.max(1, h / 2) });
        } else {
          shape.set({ left, top, width: Math.max(1, w), height: Math.max(1, h) });
        }
        canvas.requestRenderAll();
      });

      // mouse:up
      canvas.on("mouse:up", () => {
        const tool = useCanvasStore.getState().activeTool;

        if (panningRef.current) {
          panningRef.current = false;
          canvas.defaultCursor = "grab";
          canvas.hoverCursor = "grab";
          panDirtyRef.current = false;
          const vpt: number[] = canvas.viewportTransform;
          const z: number = canvas.getZoom();
          // vpt[4] = panX * zoom  (absolutePan sets vpt[4] = -(-panX*zoom) = panX*zoom)
          useCanvasStore.getState().setPan(vpt[4] / z, vpt[5] / z);
          return;
        }

        if (!drawRef.current || !previewObj.current) return;
        drawRef.current = false;
        const shape = previewObj.current;
        previewObj.current = null;
        canvas.remove(shape);

        const b = shape.getBoundingRect();
        if (b.width < 4 || b.height < 4) { canvas.renderAll(); return; }

        const isFrame = tool === "frame";
        const typeMap: Record<string, CanvasElement["type"]> = { rectangle: "rectangle", frame: "frame", ellipse: "ellipse" };
        const { addElement, setActiveTool } = useCanvasStore.getState();
        addElement({ type: typeMap[tool] ?? "rectangle", name: isFrame ? "Frame" : tool === "rectangle" ? "Rectangle" : "Ellipse", x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height), fill: isFrame ? "#ffffff" : "#6366f1", stroke: isFrame ? "#6366f1" : undefined, strokeWidth: isFrame ? 1 : 0, cornerRadius: 0, opacity: 1, rotation: 0, children: isFrame ? [] : undefined });
        setActiveTool("select");
        canvas.selection = true;
      });

      // selection events
      canvas.on("selection:created", (e: { selected?: FObj[] }) => {
        useCanvasStore.getState().setSelectedIds((e.selected ?? []).map((o) => o.motifId).filter(Boolean) as string[]);
      });
      canvas.on("selection:updated", (e: { selected?: FObj[] }) => {
        useCanvasStore.getState().setSelectedIds((e.selected ?? []).map((o) => o.motifId).filter(Boolean) as string[]);
      });
      canvas.on("selection:cleared", () => {
        useCanvasStore.getState().setSelectedIds([]);
      });
      canvas.on("object:modified", (e: { target?: FObj }) => {
        const obj = e.target;
        if (!obj?.motifId) return;
        const s = useCanvasStore.getState();
        s.updateElement(obj.motifId, { x: Math.round(obj.left ?? 0), y: Math.round(obj.top ?? 0), width: Math.round(obj.getScaledWidth()), height: Math.round(obj.getScaledHeight()), rotation: Math.round(obj.angle ?? 0) });
        s.pushHistory();
      });

      // Initial element sync
      const s = useCanvasStore.getState();
      await syncCanvas(canvas, s.elements, s.order);
    })();

    return () => {
      alive = false;
      if (fabricRef.current) { try { fabricRef.current.dispose(); } catch { /**/ } fabricRef.current = null; readyRef.current = false; }
    };
  }, []);

  // ── Resize ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (fabricRef.current && width > 0 && height > 0) { fabricRef.current.setWidth(width); fabricRef.current.setHeight(height); fabricRef.current.renderAll(); }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Elements sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fabricRef.current || !readyRef.current) return;
    syncCanvas(fabricRef.current, elements, order);
  }, [elements, order]);

  // ── Zoom / pan from store ───────────────────────────────────────────────────
  useEffect(() => {
    const c = fabricRef.current;
    if (!c || panDirtyRef.current) return;
    c.setZoom(zoom);
    // absolutePan in Fabric v6 sets vpt[4]=x, vpt[5]=y directly
    // To place canvas origin at screen(-panX*zoom, -panY*zoom):
    //   scene point (0,0) → screen (vpt[4], vpt[5]) = (-panX*zoom, -panY*zoom)
    c.absolutePan({ x: -panX * zoom, y: -panY * zoom } as never);
    c.renderAll();
  }, [zoom, panX, panY]);

  // ── Tool cursor/mode ────────────────────────────────────────────────────────
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    if (activeTool === "select") {
      c.defaultCursor = "default"; c.hoverCursor = "move"; c.selection = true;
      (c.getObjects() as FObj[]).forEach((o) => { o.selectable = true; o.evented = true; });
    } else if (activeTool === "hand") {
      c.defaultCursor = "grab"; c.hoverCursor = "grab"; c.selection = false;
      c.discardActiveObject();
      (c.getObjects() as FObj[]).forEach((o) => { o.selectable = false; o.evented = false; });
    } else {
      c.defaultCursor = "crosshair"; c.hoverCursor = "crosshair"; c.selection = false;
      c.discardActiveObject();
      (c.getObjects() as FObj[]).forEach((o) => { o.selectable = false; o.evented = false; });
    }
    c.renderAll();
  }, [activeTool]);

  // ── Wheel zoom ───────────────────────────────────────────────────────────────
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const s = useCanvasStore.getState();
    if (e.ctrlKey || e.metaKey) {
      s.setZoom(s.zoom + (e.deltaY > 0 ? -0.08 : 0.08));
    } else {
      s.setPan(s.panX - e.deltaX / s.zoom, s.panY - e.deltaY / s.zoom);
    }
  };

  // ── CSS grid (matches Fabric viewport transform) ────────────────────────────
  // vpt[4] = -panX*zoom, so grid offset x = -panX*zoom mod gridPx
  const gridPx = 20 * zoom;
  // vpt[4] = panX*zoom; grid offset aligns with vpt
  const gridOx = ((panX * zoom) % gridPx + gridPx) % gridPx;
  const gridOy = ((panY * zoom) % gridPx + gridPx) % gridPx;
  const gridStyle: CSSProperties = showGrid
    ? {
        backgroundImage: [
          "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: `${gridPx}px ${gridPx}px`,
        backgroundPosition: `${gridOx}px ${gridOy}px`,
      }
    : {};

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ backgroundColor: "#141414", ...gridStyle }}
      onWheel={handleWheel}
    >
      {/* Canvas — NOT pointer-events-none, Fabric handles native selection/drag */}
      <canvas ref={canvasElRef} className="absolute inset-0" />

      {/* Status bar */}
      <div className="absolute bottom-3 left-3 text-[11px] text-[#444] pointer-events-none select-none flex items-center gap-3">
        <span>{Math.round(zoom * 100)}%</span>
        {selectedIds.length > 0 && <span className="text-[#666]">{selectedIds.length} selected</span>}
      </div>
      <div className="absolute bottom-3 right-3 text-[11px] text-[#333] pointer-events-none select-none">
        V R O T F H · ⌘K AI
      </div>
    </div>
  );
}
