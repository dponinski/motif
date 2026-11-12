"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface View { x: number; y: number; zoom: number }

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const PAD = 32;

const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

// A surface to look at a component on: it pans and zooms, and what is on it keeps working while it does (the
// preview inside is the real page, so it stays sharp at any zoom and can still be clicked to pick an element).
//
// Scroll to pan, pinch or Ctrl/Cmd + scroll to zoom, drag the background (or hold Space and drag anywhere) to pan.
// The same works with the pointer over the component: its page passes the wheel and Space up (see CanvasMessage).
// Until the view has been moved by hand it keeps the content fitted, so it follows the content as it loads.
export default function StageCanvas({
  children, resetKey, overlay,
}: {
  children: React.ReactNode;
  // A new key (another component, mode or width) goes back to fitting the content.
  resetKey: string;
  // Drawn over the surface, not zoomed with it.
  overlay?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: PAD, y: PAD, zoom: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);
  const moved = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const fit = useCallback(() => {
    const b = box.current;
    if (!b || size.width === 0) return;
    const zoom = clamp(Math.min(1, (b.clientWidth - PAD * 2) / size.width, (b.clientHeight - PAD * 2) / size.height));
    setView({
      zoom,
      x: Math.max(PAD, (b.clientWidth - size.width * zoom) / 2),
      y: Math.max(PAD, (b.clientHeight - size.height * zoom) / 2),
    });
  }, [size.width, size.height]);

  // What is on the surface decides its size.
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.target.getBoundingClientRect();
      // getBoundingClientRect includes the zoom; the layout size does not.
      setSize({ width: (entry.target as HTMLElement).offsetWidth || width / viewRef.current.zoom, height: (entry.target as HTMLElement).offsetHeight || height / viewRef.current.zoom });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { moved.current = false; }, [resetKey]);
  useEffect(() => { if (!moved.current) fit(); }, [fit, resetKey]);
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const observer = new ResizeObserver(() => { if (!moved.current) fit(); });
    observer.observe(b);
    return () => observer.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    moved.current = true;
    setView((v) => {
      const zoom = clamp(v.zoom * factor);
      const ratio = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  const zoomBy = (factor: number) => {
    const b = box.current;
    if (b) zoomAt(factor, b.clientWidth / 2, b.clientHeight / 2);
  };

  // Scrolling pans and pinching (or Ctrl/Cmd + scroll) zooms about the pointer. `x` and `y` are where the pointer is
  // on the surface. Some browsers report the wheel in lines or pages, not pixels.
  const wheel = useCallback((x: number, y: number, deltaX: number, deltaY: number, deltaMode: number, zoom: boolean) => {
    const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? (box.current?.clientHeight ?? 600) : 1;
    if (zoom) {
      zoomAt(Math.exp(-deltaY * unit * 0.01), x, y);
    } else {
      moved.current = true;
      setView((v) => ({ ...v, x: v.x - deltaX * unit, y: v.y - deltaY * unit }));
    }
  }, [zoomAt]);

  // Not a React handler: wheel listeners are passive there, and a page that zooms must stop the browser's own zoom.
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = b.getBoundingClientRect();
      wheel(e.clientX - rect.left, e.clientY - rect.top, e.deltaX, e.deltaY, e.deltaMode, e.ctrlKey || e.metaKey);
    };
    b.addEventListener("wheel", onWheel, { passive: false });
    return () => b.removeEventListener("wheel", onWheel);
  }, [wheel]);

  // A page on the surface gets the wheel and the keyboard before the surface does, so it passes them up (see
  // CanvasMessage). Only a page that is on this surface is listened to.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const b = box.current;
      const data = e.data as { type?: string; deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean; clientX?: number; clientY?: number; down?: boolean } | null;
      if (!b || !data || (data.type !== "wheel" && data.type !== "space")) return;
      const frame = [...b.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source);
      if (!frame) return;
      if (data.type === "space") { setSpace(!!data.down); return; }
      // The position is in the page's own pixels; the surface may be zoomed, which scales the page.
      const box0 = b.getBoundingClientRect();
      const rect = frame.getBoundingClientRect();
      const scale = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
      wheel(rect.left - box0.left + (data.clientX ?? 0) * scale, rect.top - box0.top + (data.clientY ?? 0) * scale, data.deltaX ?? 0, data.deltaY ?? 0, data.deltaMode ?? 0, !!(data.ctrlKey || data.metaKey));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [wheel]);

  // Space turns the surface into something to drag, even over the preview (which would otherwise take the pointer).
  // It is left alone where Space means something else: a focused button, a field, a menu.
  useEffect(() => {
    const own = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY"].includes(t.tagName) || t.isContentEditable || !!t.closest("[role=menu],[role=dialog],[role=listbox]"));
    const down = (e: KeyboardEvent) => { if (e.key === " " && !own(e.target)) { e.preventDefault(); setSpace(true); } };
    const up = (e: KeyboardEvent) => { if (e.key === " ") setSpace(false); };
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    moved.current = true;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const dot = 20 * view.zoom;
  return (
    <div
      ref={box}
      data-stage-canvas
      className={cn("relative h-full w-full overflow-hidden bg-surface-base", panning ? "cursor-grabbing" : "cursor-default")}
      style={{ backgroundImage: "radial-gradient(var(--surface-border) 1px, transparent 1px)", backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        ref={content}
        data-stage-content
        className="absolute left-0 top-0 w-max"
        style={{ transformOrigin: "0 0", transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        {children}
      </div>

      {space && <div className={cn("absolute inset-0 z-20", panning ? "cursor-grabbing" : "cursor-grab")} />}
      {overlay}

      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-md border border-surface-border bg-surface-raised p-0.5 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out" className="flex h-6 w-6 items-center justify-center rounded text-sm text-text-secondary hover:bg-surface-subtle hover:text-text-primary">−</button>
        <button
          onClick={() => { moved.current = true; const b = box.current; if (b) zoomAt(1 / view.zoom, b.clientWidth / 2, b.clientHeight / 2); }}
          aria-label="Zoom to 100%"
          title="Zoom to 100%"
          className="h-6 min-w-[44px] rounded px-1 text-2xs tabular-nums text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
          data-zoom={view.zoom}
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in" className="flex h-6 w-6 items-center justify-center rounded text-sm text-text-secondary hover:bg-surface-subtle hover:text-text-primary">+</button>
        <button onClick={() => { moved.current = false; fit(); }} aria-label="Fit to view" title="Fit to view" className="h-6 rounded px-1.5 text-2xs text-text-secondary hover:bg-surface-subtle hover:text-text-primary">Fit</button>
      </div>
    </div>
  );
}
