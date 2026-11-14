"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// The canvas's zoom, for what is drawn on it and measured in screen pixels (dragging an edge by 10 px on a canvas at 50% is 20 px
// of the component).
export const StageZoom = createContext(1);

// Tells what is listening how far the canvas is zoomed (the page inside the frame draws its handles by it).
export function ZoomSync({ onZoom }: { onZoom: (zoom: number) => void }) {
  const zoom = useContext(StageZoom);
  useEffect(() => { onZoom(zoom); }, [zoom, onZoom]);
  return null;
}

export const MIN_WIDTH = 200;
export const MAX_WIDTH = 3000;
const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

// The widths designers think in. "Auto" is the width the view calls for.
export const BREAKPOINTS: { label: string; value: number | null }[] = [
  { label: "Phone", value: 375 },
  { label: "Tablet", value: 768 },
  { label: "Laptop", value: 1024 },
  { label: "Desktop", value: 1280 },
  { label: "Auto", value: null },
];

// What the width of a frame becomes when its edge is dragged by `dx` screen pixels on a canvas at `zoom`.
export function widthAfterDrag(start: number, dx: number, zoom: number): number {
  return clampWidth(start + dx / (zoom || 1));
}

// The sizes to choose from, above the canvas: Phone, Tablet, Laptop, Desktop, Auto, and a width to type. The one that is on is marked.
export function BreakpointBar({ width, onChange }: { width: number | null; onChange: (width: number | null) => void }) {
  const [text, setText] = useState(width === null ? "" : String(width));
  useEffect(() => { setText(width === null ? "" : String(width)); }, [width]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (text.trim() === "") onChange(null);
    else if (Number.isFinite(n)) onChange(clampWidth(n));
    else setText(width === null ? "" : String(width));
  };
  return (
    <div
      data-breakpoints
      className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-surface-border bg-surface-raised p-0.5 shadow-sm"
      // The canvas pans when it is dragged; this is not part of it.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {BREAKPOINTS.map((b) => (
        <button
          key={b.label}
          type="button"
          onClick={() => onChange(b.value)}
          aria-pressed={width === b.value}
          aria-label={`Preview width: ${b.value ?? "Auto"}`}
          title={b.value === null ? "The width the view calls for" : `${b.label}: ${b.value} px wide`}
          className={cn("flex items-baseline gap-1 rounded px-2 py-1 text-xs transition-colors", width === b.value ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-surface-subtle hover:text-text-primary")}
        >
          {b.label}
          {b.value !== null && <span className="text-2xs tabular-nums opacity-70">{b.value}</span>}
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-surface-border" />
      <input
        aria-label="Preview width"
        inputMode="numeric"
        placeholder="Auto"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
        className="h-6 w-14 rounded border border-transparent bg-transparent px-1 text-center text-2xs tabular-nums text-text-primary outline-none placeholder:text-text-tertiary hover:border-surface-border focus:border-accent/60"
      />
      <span className="pr-1.5 text-2xs text-text-tertiary">px</span>
    </div>
  );
}

// The right edge of a frame: drag it to change the width, live. `start` is the width the frame has when the drag begins.
export function WidthHandle({ start, onResize, onResizing }: { start: () => number; onResize: (width: number) => void; onResizing: (on: boolean) => void }) {
  const zoom = useContext(StageZoom);
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      data-width-handle
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the frame"
      title="Drag to change the width"
      className="group absolute -right-3 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width: start() };
        onResizing(true);
      }}
      onPointerMove={(e) => { if (drag.current) onResize(widthAfterDrag(drag.current.width, e.clientX - drag.current.x, zoom)); }}
      onPointerUp={(e) => {
        drag.current = null;
        onResizing(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; onResizing(false); }}
    >
      <span className="h-10 w-1 rounded-full bg-surface-border transition-colors group-hover:bg-accent" />
    </div>
  );
}

// The name and size of the frame, above it.
export function FrameLabel({ name, width, height, dark }: { name: string; width: number; height: number; dark: boolean }) {
  return (
    <div data-frame-label className="flex items-center gap-2 px-0.5 text-2xs text-text-tertiary">
      <span className="font-medium text-text-secondary">{name}</span>
      <span className="tabular-nums" data-frame-size>{Math.round(width)} × {Math.round(height)}</span>
      {dark && <span>· dark</span>}
    </div>
  );
}
