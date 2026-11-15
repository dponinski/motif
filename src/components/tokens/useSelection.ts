import { useCallback, useMemo, useRef, useState } from "react";

// Which tokens are picked on the screen. `order` is every token that can be picked, as they read, so a range knows what is between.
export function useSelection(order: string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const live = useMemo(() => new Set(order.filter((id) => picked.has(id))), [order, picked]);

  const click = useCallback((id: string, mods: { shift?: boolean; toggle?: boolean }) => {
    setPicked((current) => {
      const next = new Set(order.filter((x) => current.has(x)));
      if (mods.shift && anchor.current && order.includes(anchor.current)) {
        const a = order.indexOf(anchor.current), b = order.indexOf(id);
        for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
      } else if (mods.toggle) {
        if (!next.delete(id)) next.add(id);
        anchor.current = id;
      } else {
        next.clear();
        next.add(id);
        anchor.current = id;
      }
      return next;
    });
  }, [order]);

  const toggle = useCallback((id: string) => click(id, { toggle: true }), [click]);
  const setMany = useCallback((ids: string[], on: boolean) => setPicked((current) => {
    const next = new Set(order.filter((x) => current.has(x)));
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  }), [order]);
  const clear = useCallback(() => { setPicked(new Set()); anchor.current = null; }, []);
  const selectAll = useCallback((ids: string[] = order) => setPicked(new Set(ids)), [order]);

  return { selected: live, ids: [...live], click, toggle, setMany, clear, selectAll };
}

export type Selection = ReturnType<typeof useSelection>;
