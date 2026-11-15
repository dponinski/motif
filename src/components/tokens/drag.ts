import { useCallback, useEffect, useRef, useState } from "react";

// Dragging tokens on the screen: onto a group's header to put them in that group, or before / after another token to put them
// there. Like the layers panel it is pointer events on the window (a press that moves a few pixels), and what is under the pointer is
// found by the attributes `data-token-id` and `data-group-drop`.
export type DropTarget = { type: "token"; id: string; after: boolean } | { type: "group"; group: string };

const same = (a: DropTarget | null, b: DropTarget | null) =>
  a === b || (!!a && !!b && a.type === b.type && (a.type === "group" ? a.group === (b as typeof a).group : a.id === (b as typeof a).id && a.after === (b as typeof a).after));

export function useTokenDrag(options: { axis: "x" | "y"; dragged: (id: string) => string[]; onDrop: (ids: string[], target: DropTarget) => void }) {
  const [moving, setMoving] = useState<string[] | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });

  const press = useCallback((event: React.PointerEvent, id: string) => {
    if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const from = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let at: DropTarget | null = null;
    let ids: string[] = [];

    const target = (e: PointerEvent): DropTarget | null => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const token = el?.closest("[data-token-id]") as HTMLElement | null;
      if (token) {
        const over = token.getAttribute("data-token-id")!;
        if (ids.includes(over)) return null;
        const box = token.getBoundingClientRect();
        const f = latest.current.axis === "x" ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height;
        return { type: "token", id: over, after: f > 0.5 };
      }
      const group = el?.closest("[data-group-drop]") as HTMLElement | null;
      return group ? { type: "group", group: group.getAttribute("data-group-drop")! } : null;
    };
    const move = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - from.x, e.clientY - from.y) < 5) return;
      if (!dragging) { dragging = true; ids = latest.current.dragged(id); setMoving(ids); }
      const next = target(e);
      if (!same(at, next)) { at = next; setOver(next); }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setMoving(null);
      setOver(null);
      if (dragging && at) latest.current.onDrop(ids, at);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);

  return { press, moving, over };
}

export type Drag = ReturnType<typeof useTokenDrag>;
