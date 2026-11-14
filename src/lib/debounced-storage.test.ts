import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debouncedStorage } from "./debounced-storage";

describe("storage that writes a moment after the last change", () => {
  const memory = new Map<string, string>();
  const backend = { getItem: (k: string) => memory.get(k) ?? null, setItem: vi.fn((k: string, v: string) => void memory.set(k, v)), removeItem: (k: string) => void memory.delete(k) };
  const value = (n: number) => ({ state: { n }, version: 1 });

  beforeEach(() => { vi.useFakeTimers(); memory.clear(); backend.setItem.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it("writes the last of several changes, once, after the delay", () => {
    const storage = debouncedStorage<{ n: number }>({ backend, delay: 300 });
    storage.setItem("k", value(1));
    storage.setItem("k", value(2));
    vi.advanceTimersByTime(299);
    expect(backend.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(backend.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(memory.get("k")!).state.n).toBe(2);
  });

  it("doesn't write the same kept state again", () => {
    const storage = debouncedStorage<{ n: number }>({ backend, delay: 10 });
    const v = value(1);
    storage.setItem("k", v);
    vi.advanceTimersByTime(20);
    storage.setItem("k", { ...v });
    vi.advanceTimersByTime(20);
    expect(backend.setItem).toHaveBeenCalledTimes(1);
  });

  it("writes what is waiting when asked, and not twice", () => {
    const storage = debouncedStorage<{ n: number }>({ backend, delay: 300 });
    storage.setItem("k", value(1));
    storage.flush();
    storage.flush();
    vi.advanceTimersByTime(500);
    expect(backend.setItem).toHaveBeenCalledTimes(1);
  });

  it("drops what is waiting when the item is removed", () => {
    const storage = debouncedStorage<{ n: number }>({ backend, delay: 300 });
    storage.setItem("k", value(1));
    storage.removeItem("k");
    vi.advanceTimersByTime(500);
    expect(memory.has("k")).toBe(false);
    expect(backend.setItem).not.toHaveBeenCalled();
    // After a removal the same state can be written again.
    storage.setItem("k", value(1));
    storage.flush();
    expect(memory.has("k")).toBe(true);
  });

  it("reads what was written, and nothing from garbage", () => {
    const storage = debouncedStorage<{ n: number }>({ backend, delay: 1 });
    storage.setItem("k", value(7));
    storage.flush();
    expect(storage.getItem("k")).toEqual(value(7));
    memory.set("bad", "not json");
    expect(storage.getItem("bad")).toBeNull();
    expect(storage.getItem("none")).toBeNull();
  });

  it("reports a failed write, and that it is over once one works", () => {
    const seen: boolean[] = [];
    const storage = debouncedStorage<{ n: number }>({ backend, delay: 1, onProblem: (p) => seen.push(p) });
    backend.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    storage.setItem("k", value(1));
    storage.flush();
    storage.setItem("k", value(2));
    storage.flush();
    expect(seen).toEqual([true, false]);
  });

  it("works without a browser store at all", () => {
    const storage = debouncedStorage<{ n: number }>({ backend: () => null, delay: 1 });
    storage.setItem("k", value(1));
    expect(() => storage.flush()).not.toThrow();
    expect(storage.getItem("k")).toBeNull();
  });
});
