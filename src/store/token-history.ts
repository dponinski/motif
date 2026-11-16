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

// Which theme of a set is open is where the user is looking, not a change to the tokens: it neither ends the history nor is a step of it.
// A color's `value` is what it is in the open theme, so it follows that and is left out of the comparison too (its values in each theme
// are compared).
const looked = (data: TokenData, key: (typeof KEYS)[number]): unknown =>
  key === "sets" ? data.sets.map(({ activeThemeId: _, ...rest }) => rest)
  : key === "colors" ? data.colors.map(({ value: _, ...rest }) => rest)
  : data[key];

// The same tokens. A slice that is a new array holding the same things (a write of what was already there) is the same.
const same = (a: TokenData, b: TokenData) => KEYS.every((k) => a[k] === b[k] || JSON.stringify(looked(a, k)) === JSON.stringify(looked(b, k)));

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
  // Undo takes back what was changed, not where the user was looking: each set keeps the theme that is open, when it is still there.
  const sets = target.sets.map((st) => {
    const open = now.sets.find((x) => x.id === st.id)?.activeThemeId;
    return open && st.themes.some((t) => t.id === open) ? { ...st, activeThemeId: open } : st;
  });
  const open = new Map(sets.map((st) => [st.id, st.activeThemeId]));
  const kept = { ...target, sets, colors: target.colors.map((c) => ({ ...c, value: c.themeValues[open.get(c.setId) ?? ""] ?? c.value })) };
  own = true;
  try {
    useDesignSystemStore.getState().replaceTokenData(kept);
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
