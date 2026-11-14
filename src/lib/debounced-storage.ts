import type { PersistStorage, StorageValue } from "zustand/middleware";

// Storage for a persisted store that writes a moment after the last change and when the page is left, instead of on every
// change, and not at all while the part that is kept is the same object as last time (a selection, a counter, something
// that isn't kept moved). The part to keep is made by the store's `partialize`, which returns the same object for the same
// content. A failure to write (over the browser's limit, or blocked) is told to `onProblem`, and its end with null.

type Backend = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SAVE_DELAY = 400;

export function debouncedStorage<S>(
  options: { backend?: Backend | (() => Backend | null); delay?: number; onProblem?: (problem: boolean) => void } = {}
): PersistStorage<S> & { flush: () => void } {
  const { delay = SAVE_DELAY, onProblem } = options;
  const source = options.backend ?? (() => (typeof localStorage === "undefined" ? null : localStorage));
  const backend = () => (typeof source === "function" ? source() : source);
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastState: S | null = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    try {
      backend()?.setItem(name, JSON.stringify(value));
      onProblem?.(false);
    } catch {
      onProblem?.(true);
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  }
  return {
    getItem: (name) => {
      try {
        const raw = backend()?.getItem(name);
        return raw ? (JSON.parse(raw) as StorageValue<S>) : null;
      } catch { return null; }
    },
    setItem: (name, value) => {
      if (lastState === value.state) return;
      lastState = value.state;
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    removeItem: (name) => {
      if (timer) { clearTimeout(timer); timer = null; }
      pending = null;
      lastState = null;
      try { backend()?.removeItem(name); } catch { /* nothing to remove */ }
    },
    flush,
  };
}
