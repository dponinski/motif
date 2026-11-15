import { create } from "zustand";
import { snapshotTokens, useDesignSystemStore, type TokenData } from "./design-system";

// Undo for the Tokens screen. An edit made through `editTokens` is one step; a bulk move or a pasted batch is one step too.
// Anything else that changes the tokens (a sync, the assistant, another project opening) ends the history, so undo never takes
// back something it didn't make.

interface History { past: TokenData[]; future: TokenData[] }

export const useTokenHistory = create<History>(() => ({ past: [], future: [] }));

const LIMIT = 100;
let own = false;

const KEYS = ["sets", "colors", "typography", "spacing", "radii", "shadows"] as const;

// The same tokens. A slice that is a new array holding the same things (a write of what was already there) is the same.
const same = (a: TokenData, b: TokenData) => KEYS.every((k) => a[k] === b[k] || JSON.stringify(a[k]) === JSON.stringify(b[k]));

useDesignSystemStore.subscribe((state, prev) => {
  if (own) return;
  if (!same(snapshotTokens(state), snapshotTokens(prev))) useTokenHistory.setState({ past: [], future: [] });
});

// Makes a change to the tokens that can be undone. Returns what the change returns.
export function editTokens<T>(change: () => T): T {
  const before = snapshotTokens(useDesignSystemStore.getState());
  own = true;
  try {
    const out = change();
    if (!same(before, snapshotTokens(useDesignSystemStore.getState()))) {
      useTokenHistory.setState((h) => ({ past: [...h.past, before].slice(-LIMIT), future: [] }));
    }
    return out;
  } finally {
    own = false;
  }
}

function travel(from: "past" | "future") {
  const h = useTokenHistory.getState();
  const target = h[from][h[from].length - 1];
  if (!target) return false;
  const now = snapshotTokens(useDesignSystemStore.getState());
  own = true;
  try {
    useDesignSystemStore.getState().replaceTokenData(target);
  } finally {
    own = false;
  }
  const other = from === "past" ? "future" : "past";
  useTokenHistory.setState({ [from]: h[from].slice(0, -1), [other]: [...h[other], now] } as unknown as History);
  return true;
}

export const undoTokens = () => travel("past");
export const redoTokens = () => travel("future");
export const forgetTokenHistory = () => useTokenHistory.setState({ past: [], future: [] });
