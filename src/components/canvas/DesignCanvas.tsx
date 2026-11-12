"use client";

import { useEffect, useRef, useState, CSSProperties } from "react";
import { useCanvasStore, type CanvasElement } from "@/store/canvas";
import { useDesignSystemStore } from "@/store/design-system";
import { absPos } from "@/lib/canvas-geometry";
import RepoInstanceLayer from "./RepoInstanceLayer";

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
  scaleX?: number;
  scaleY?: number;
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

// ── Position helpers ──────────────────────────────────────────────────────────


/**
 * Find the deepest (smallest-area) frame whose bounds contain point (cx, cy).
 * Pass excludeId to skip the element just created.
 */
function findContainerFrame(
  cx: number,
  cy: number,
  elements: Record<string, CanvasElement>,
  excludeId?: string
): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const el of Object.values(elements)) {
    if (el.type !== "frame" || el.id === excludeId) continue;
    const { x: ex, y: ey } = absPos(el, elements);
    if (cx >= ex && cy >= ey && cx <= ex + el.width && cy <= ey + el.height) {
      const area = el.width * el.height;
      if (area < bestArea) { best = el.id; bestArea = area; }
    }
  }
  return best;
}

// ── Fabric object helpers ─────────────────────────────────────────────────────

function flatIds(ids: string[], elements: Record<string, CanvasElement>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    out.push(id);
    const el = elements[id];
    if (el?.children?.length) out.push(...flatIds(el.children, elements));
  }
  return out;
}

type TokenResolver = {
  color: (id?: string, fallback?: string) => string;
  typo: (id?: string) => Partial<CanvasElement> | null;
};

function makeObj(el: CanvasElement, m: FabricMod, elements: Record<string, CanvasElement>, res: TokenResolver): FObj | null {
  const { x, y } = absPos(el, elements);
  const common: Record<string, unknown> = {
    left: x, top: y,
    angle: el.rotation ?? 0,
    opacity: el.opacity ?? 1,
    scaleX: 1, scaleY: 1,
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
      fill: res.color(el.fillTokenId, el.fill ?? (el.type === "frame" ? "#ffffff" : "#6366f1")),
      stroke: el.stroke ?? null, strokeWidth: el.strokeWidth ?? 0,
      rx: el.cornerRadius ?? 0, ry: el.cornerRadius ?? 0,
    });
  }
  if (el.type === "ellipse") {
    return new m.Ellipse({
      ...common,
      rx: el.width / 2, ry: el.height / 2,
      fill: res.color(el.fillTokenId, el.fill ?? "#6366f1"),
      stroke: el.stroke ?? null, strokeWidth: el.strokeWidth ?? 0,
    });
  }
  if (el.type === "text") {
    const typo = res.typo(el.typographyTokenId);
    return new m.Textbox(el.content ?? "Text", {
      ...common,
      width: el.width,
      fill: el.fontColor ?? "#111111",
      fontSize: typo?.fontSize ?? el.fontSize ?? 16,
      fontWeight: typo?.fontWeight ?? el.fontWeight ?? "400",
      fontFamily: typo?.fontFamily ?? el.fontFamily ?? "Inter",
    });
  }
  if (el.type === "instance") {
    return new m.Rect({
      ...common,
      width: el.width,
      height: el.height,
      // A repository component is drawn by the layer above; this is only the box that selects and moves it, and
      // it has no stroke so its size never drifts by the stroke's width.
      fill: el.repoComponent ? "rgba(0,0,0,0)" : "rgba(99,102,241,0.08)",
      stroke: el.repoComponent ? null : "#6366f1",
      strokeWidth: el.repoComponent ? 0 : 1.5,
      strokeDashArray: [5, 4],
      rx: 6, ry: 6,
    });
  }
  return null;
}

function applyProps(obj: FObj, el: CanvasElement, elements: Record<string, CanvasElement>, res: TokenResolver) {
  const { x, y } = absPos(el, elements);
  obj.set({ left: x, top: y, angle: el.rotation ?? 0, opacity: el.opacity ?? 1 });
  if (el.type === "rectangle" || el.type === "frame") {
    obj.set({
      width: el.width, height: el.height,
      scaleX: 1, scaleY: 1,
      fill: res.color(el.fillTokenId, el.fill ?? (el.type === "frame" ? "#ffffff" : "#6366f1")),
      stroke: el.stroke ?? null, strokeWidth: el.strokeWidth ?? 0,
      rx: el.cornerRadius ?? 0, ry: el.cornerRadius ?? 0,
    });
  } else if (el.type === "ellipse") {
    obj.set({
      rx: el.width / 2, ry: el.height / 2,
      scaleX: 1, scaleY: 1,
      fill: res.color(el.fillTokenId, el.fill ?? "#6366f1"),
      stroke: el.stroke ?? null, strokeWidth: el.strokeWidth ?? 0,
    });
  } else if (el.type === "text") {
    const typo = res.typo(el.typographyTokenId);
    obj.set({
      width: el.width,
      fill: el.fontColor ?? "#111111",
      fontSize: typo?.fontSize ?? el.fontSize ?? 16,
      fontWeight: typo?.fontWeight ?? el.fontWeight ?? "400",
      fontFamily: typo?.fontFamily ?? el.fontFamily ?? "Inter",
      text: el.content ?? "",
    });
  } else if (el.type === "instance") {
    obj.set({ width: el.width, height: el.height, scaleX: 1, scaleY: 1 });
  }
}

async function syncCanvas(c: FCanvas, elements: Record<string, CanvasElement>, order: string[], res: TokenResolver) {
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
      applyProps(existing.get(id)!, el, elements, res);
    } else {
      const obj = makeObj(el, m, elements, res);
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
  // The canvas once it exists, for the layer of repository components that follows its zoom and pan.
  const [canvasReady, setCanvasReady] = useState<FCanvas | null>(null);

  // Drawing state
  const drawRef = useRef(false);
  const drawToolRef = useRef<string>("");
  const startPt = useRef({ x: 0, y: 0 });
  const previewObj = useRef<FObj | null>(null);

  // Panning state
  const panningRef = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const panDirtyRef = useRef(false);

  // Deselect sync — prevents selection:cleared → setSelectedIds([]) → effect loop
  const deselectingRef = useRef(false);

  const { zoom, panX, panY, showGrid, selectedIds, elements, order, activeTool } = useCanvasStore();
  const { colors: tokenColors, typography: tokenTypography } = useDesignSystemStore();

  const tokenResolver: TokenResolver = {
    color: (id?: string, fallback = "#6366f1") =>
      id ? (tokenColors.find((c) => c.id === id)?.value ?? fallback) : fallback,
    typo: (id?: string) => {
      if (!id) return null;
      const t = tokenTypography.find((t) => t.id === id);
      if (!t) return null;
      return { fontSize: t.fontSize, fontWeight: String(t.fontWeight), fontFamily: t.fontFamily };
    },
  };

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
      setCanvasReady(canvas);

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

        const pt: { x: number; y: number } = opt.scenePoint ?? canvas.getPointer(opt.e);
        if (!pt) return;

        if (tool === "text") {
          const { elements: elems, addElement, setActiveTool } = useCanvasStore.getState();
          // Auto-parent text into the containing frame
          const ax = Math.round(pt.x), ay = Math.round(pt.y);
          const parentId = findContainerFrame(ax, ay, elems) ?? undefined;
          let tx = ax, ty = ay;
          if (parentId) {
            const pAbs = absPos(elems[parentId], elems);
            tx = ax - pAbs.x;
            ty = ay - pAbs.y;
          }
          addElement({ type: "text", name: "Text", x: tx, y: ty, width: 220, height: 32, fill: "transparent", fontColor: "#111111", content: "Type something", fontSize: 16, fontWeight: "400", fontFamily: "Inter", opacity: 1, rotation: 0, parentId });
          setActiveTool("select");
          return;
        }

        canvas.selection = false;
        canvas.discardActiveObject();
        startPt.current = { x: pt.x, y: pt.y };
        drawRef.current = true;
        drawToolRef.current = tool;

        const isFrame = tool === "frame";
        let shape: FObj | null = null;
        if (tool === "rectangle" || isFrame) {
          shape = new Rect({ left: pt.x, top: pt.y, width: 1, height: 1, fill: isFrame ? "rgba(255,255,255,0.08)" : "#6366f1", stroke: "#6366f1", strokeWidth: 1, selectable: false, evented: false });
        } else if (tool === "ellipse") {
          shape = new Ellipse({ left: pt.x, top: pt.y, rx: 1, ry: 1, fill: "#6366f1", selectable: false, evented: false });
        }
        if (shape) { canvas.add(shape); previewObj.current = shape; canvas.renderAll(); }
      });

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
        const pt: { x: number; y: number } | undefined = opt.scenePoint ?? canvas.getPointer(opt.e);
        if (!pt) return;
        const { x: sx, y: sy } = startPt.current;
        const w = Math.abs(pt.x - sx), h = Math.abs(pt.y - sy);
        const left = Math.min(pt.x, sx), top = Math.min(pt.y, sy);
        const shape = previewObj.current;
        if (drawToolRef.current === "ellipse") {
          shape.set({ left, top, rx: Math.max(1, w / 2), ry: Math.max(1, h / 2) });
        } else {
          shape.set({ left, top, width: Math.max(1, w), height: Math.max(1, h) });
        }
        canvas.requestRenderAll();
      });

      canvas.on("mouse:up", () => {
        const tool = useCanvasStore.getState().activeTool;

        if (panningRef.current) {
          panningRef.current = false;
          canvas.defaultCursor = "grab";
          canvas.hoverCursor = "grab";
          panDirtyRef.current = false;
          const vpt: number[] = canvas.viewportTransform;
          const z: number = canvas.getZoom();
          useCanvasStore.getState().setPan(vpt[4] / z, vpt[5] / z);
          return;
        }

        if (!drawRef.current || !previewObj.current) return;
        drawRef.current = false;
        const drawnTool = drawToolRef.current;
        drawToolRef.current = "";
        const shape = previewObj.current;
        previewObj.current = null;
        canvas.remove(shape);

        const isEllipse = drawnTool === "ellipse";
        const shapeW = isEllipse ? (shape.rx ?? 1) * 2 : (shape.width ?? 1);
        const shapeH = isEllipse ? (shape.ry ?? 1) * 2 : (shape.height ?? 1);
        const absX = Math.round(shape.left ?? 0);
        const absY = Math.round(shape.top ?? 0);
        if (shapeW < 4 || shapeH < 4) { canvas.renderAll(); return; }

        const isFrame = drawnTool === "frame";
        const typeMap: Record<string, CanvasElement["type"]> = { rectangle: "rectangle", frame: "frame", ellipse: "ellipse" };
        const { elements: elems, addElement, setActiveTool } = useCanvasStore.getState();

        // Auto-parent into the deepest containing frame (use center point)
        const cx = absX + shapeW / 2;
        const cy = absY + shapeH / 2;
        const parentId = findContainerFrame(cx, cy, elems) ?? undefined;

        let finalX = absX, finalY = absY;
        if (parentId) {
          const pAbs = absPos(elems[parentId], elems);
          finalX = absX - pAbs.x;
          finalY = absY - pAbs.y;
        }

        addElement({
          type: typeMap[drawnTool] ?? "rectangle",
          name: isFrame ? "Frame" : drawnTool === "rectangle" ? "Rectangle" : "Ellipse",
          x: finalX, y: finalY,
          width: Math.round(shapeW), height: Math.round(shapeH),
          fill: isFrame ? "#ffffff" : "#6366f1",
          stroke: isFrame ? "#6366f1" : undefined,
          strokeWidth: isFrame ? 1 : 0,
          cornerRadius: 0, opacity: 1, rotation: 0,
          parentId,
          children: isFrame ? [] : undefined,
        });
        setActiveTool("select");
        canvas.selection = true;
      });

      // Selection events
      canvas.on("selection:created", (e: { selected?: FObj[] }) => {
        useCanvasStore.getState().setSelectedIds((e.selected ?? []).map((o) => o.motifId).filter(Boolean) as string[]);
      });
      canvas.on("selection:updated", (e: { selected?: FObj[] }) => {
        useCanvasStore.getState().setSelectedIds((e.selected ?? []).map((o) => o.motifId).filter(Boolean) as string[]);
      });
      canvas.on("selection:cleared", () => {
        if (!deselectingRef.current) {
          useCanvasStore.getState().setSelectedIds([]);
        }
      });
      canvas.on("object:modified", (e: { target?: FObj }) => {
        const obj = e.target;
        if (!obj?.motifId) return;
        const s = useCanvasStore.getState();
        const el = s.elements[obj.motifId];
        if (!el) return;

        // Convert absolute Fabric position back to parent-relative store coords
        let relX = Math.round(obj.left ?? 0);
        let relY = Math.round(obj.top ?? 0);
        if (el.parentId && s.elements[el.parentId]) {
          const pAbs = absPos(s.elements[el.parentId], s.elements);
          relX -= pAbs.x;
          relY -= pAbs.y;
        }

        const width = Math.round(obj.getScaledWidth());
        const height = Math.round(obj.getScaledHeight());
        s.updateElement(obj.motifId, {
          x: relX,
          y: relY,
          width,
          height,
          rotation: Math.round(obj.angle ?? 0),
          // Resizing a repository component by hand stops it taking the component's own size.
          ...(el.repoComponent && (Math.abs(width - el.width) > 1 || Math.abs(height - el.height) > 1) ? { autoSize: false } : {}),
        });
        s.pushHistory();
      });

      // Initial element sync
      const s = useCanvasStore.getState();
      const ds = useDesignSystemStore.getState();
      const initRes: TokenResolver = {
        color: (id, fb = "#6366f1") => id ? (ds.colors.find((c) => c.id === id)?.value ?? fb) : fb,
        typo: (id) => {
          if (!id) return null;
          const t = ds.typography.find((t) => t.id === id);
          return t ? { fontSize: t.fontSize, fontWeight: String(t.fontWeight), fontFamily: t.fontFamily } : null;
        },
      };
      await syncCanvas(canvas, s.elements, s.order, initRes);
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
      if (fabricRef.current && width > 0 && height > 0) { fabricRef.current.setDimensions({ width, height }); fabricRef.current.renderAll(); }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Elements sync (also re-runs when token values change) ───────────────────
  useEffect(() => {
    if (!fabricRef.current || !readyRef.current) return;
    syncCanvas(fabricRef.current, elements, order, tokenResolver);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, order, tokenColors, tokenTypography]);

  // ── Zoom / pan from store ───────────────────────────────────────────────────
  useEffect(() => {
    const c = fabricRef.current;
    if (!c || panDirtyRef.current) return;
    c.setZoom(zoom);
    c.absolutePan({ x: -panX * zoom, y: -panY * zoom } as never);
    c.renderAll();
  }, [zoom, panX, panY]);

  // ── selectedIds → Fabric deselect sync ─────────────────────────────────────
  useEffect(() => {
    const c = fabricRef.current;
    if (!c || !readyRef.current) return;
    if (selectedIds.length === 0) {
      deselectingRef.current = true;
      c.discardActiveObject();
      c.renderAll();
      deselectingRef.current = false;
    }
  }, [selectedIds]);

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

  // ── Wheel zoom/pan ───────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useCanvasStore.getState();
      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.pow(1.001, -e.deltaY);
        const newZoom = Math.min(32, Math.max(0.05, s.zoom * factor));
        const sceneCursorX = cursorX / s.zoom - s.panX;
        const sceneCursorY = cursorY / s.zoom - s.panY;
        s.setZoom(newZoom);
        s.setPan(cursorX / newZoom - sceneCursorX, cursorY / newZoom - sceneCursorY);
      } else {
        s.setPan(s.panX - e.deltaX / s.zoom, s.panY - e.deltaY / s.zoom);
      }
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // ── Reset stuck state on window blur ────────────────────────────────────────
  useEffect(() => {
    const onBlur = () => {
      if (panningRef.current) {
        panningRef.current = false;
        panDirtyRef.current = false;
        const c = fabricRef.current;
        if (c) {
          c.defaultCursor = "grab";
          c.hoverCursor = "grab";
          const vpt: number[] = c.viewportTransform;
          const z: number = c.getZoom();
          useCanvasStore.getState().setPan(vpt[4] / z, vpt[5] / z);
        }
      }
      if (drawRef.current) {
        drawRef.current = false;
        drawToolRef.current = "";
        const c = fabricRef.current;
        if (c && previewObj.current) {
          c.remove(previewObj.current);
          previewObj.current = null;
          c.renderAll();
        }
      }
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  // ── CSS grid ─────────────────────────────────────────────────────────────────
  const gridPx = 20 * zoom;
  const gridOx = ((panX * zoom) % gridPx + gridPx) % gridPx;
  const gridOy = ((panY * zoom) % gridPx + gridPx) % gridPx;
  const gridStyle: CSSProperties = showGrid
    ? {
        backgroundImage: [
          "linear-gradient(var(--grid-line) 1px, transparent 1px)",
          "linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: `${gridPx}px ${gridPx}px`,
        backgroundPosition: `${gridOx}px ${gridOy}px`,
      }
    : {};

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ backgroundColor: "var(--canvas-bg)", ...gridStyle }}
    >
      <canvas ref={canvasElRef} className="absolute inset-0" />
      <RepoInstanceLayer canvas={canvasReady} />

      {/* Status bar */}
      <div className="absolute bottom-3 left-3 text-[11px] text-text-tertiary pointer-events-none select-none flex items-center gap-3">
        <span>{Math.round(zoom * 100)}%</span>
        {selectedIds.length > 0 && <span className="text-text-secondary">{selectedIds.length} selected</span>}
      </div>
      <div className="absolute bottom-3 right-3 text-[11px] text-text-tertiary pointer-events-none select-none opacity-50">
        V R O T F H · ⌘C/V copy/paste · ⌘K AI
      </div>
    </div>
  );
}
