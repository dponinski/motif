import type { Choice } from "./tokens";

// What dragging a handle on the canvas becomes in the source. The page reports sizes in pixels; the source says them in the
// repository's own terms: a token if one is that size, a step of the scale if one is, and only otherwise a value written out
// (`w-[300px]`). So a drag lands on the design system by itself, and leaves a raw value only where nothing fits.

// The groups a handle can change (what the iframe is allowed to ask for).
export const GESTURE_GROUPS = ["w", "h", "p", "px", "py", "pt", "pr", "pb", "pl", "gap"] as const;
export type GestureGroup = (typeof GESTURE_GROUPS)[number];

export interface GestureEdit { group: GestureGroup; px: number }

export const MAX_PX = 10_000;

// Edits from the page are data, not instructions: only known groups and plain numbers get through.
export function cleanEdits(edits: unknown): GestureEdit[] {
  if (!Array.isArray(edits)) return [];
  const out: GestureEdit[] = [];
  for (const e of edits.slice(0, 4) as { group?: unknown; px?: unknown }[]) {
    if (typeof e?.group !== "string" || !(GESTURE_GROUPS as readonly string[]).includes(e.group)) continue;
    if (typeof e.px !== "number" || !Number.isFinite(e.px)) continue;
    out.push({ group: e.group as GestureGroup, px: Math.min(MAX_PX, Math.max(0, e.px)) });
  }
  return out;
}

const PX = /^(-?\d+(?:\.\d+)?)px$/;
const pxOf = (c: Choice): number | null => {
  const m = c.hint?.match(PX) ?? c.value.match(PX);
  return m ? parseFloat(m[1]) : null;
};
const fmt = (n: number) => `${parseFloat(n.toFixed(2))}px`;

// How near a size has to be to a token or a step to be taken for it: a couple of pixels, a little more on large sizes.
export const tolerance = (px: number) => Math.max(2, px * 0.03);

// The value for a size in px: the nearest token (or step), when one is within reach; otherwise the size written out.
// Tokens win over steps of the scale at the same distance.
export function valueForPx(px: number, choices: { tokens: Choice[]; scale: Choice[] }): string {
  const size = Math.max(0, Math.round(px * 100) / 100);
  let best: { value: string; distance: number; token: boolean } | null = null;
  for (const c of [...choices.tokens, ...choices.scale]) {
    const n = pxOf(c);
    if (n === null) continue;
    const distance = Math.abs(n - size);
    if (distance > tolerance(size)) continue;
    if (!best || distance < best.distance || (distance === best.distance && c.token && !best.token)) best = { value: c.value, distance, token: c.token };
  }
  return best ? best.value : `[${fmt(size)}]`;
}
