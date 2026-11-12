import { formatLike, normalizeColor } from "./color";

const REM = 16;

// ── Lengths ───────────────────────────────────────────────────────────────────

export function parseLengthPx(input: string): number | null {
  const m = input.trim().toLowerCase().match(/^([-+]?(?:\d+\.?\d*|\.\d+))(px|rem)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!m[2]) return n === 0 ? 0 : null;
  return m[2] === "rem" ? n * REM : n;
}

const num = (n: number, digits = 4) => String(parseFloat(n.toFixed(digits)));

// Writes px in the unit `original` used; rem stays rem.
export function formatLength(px: number, original?: string): string {
  if (px === 0) return "0";
  if (original && /rem\s*$/i.test(original)) {
    const rem = num(px / REM, 6);
    if (Math.abs(parseFloat(rem) * REM - px) < 1e-6) return `${rem}rem`;
  }
  return `${num(px, 2)}px`;
}

// ── Shadows ───────────────────────────────────────────────────────────────────

export interface ShadowLayer {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  // The layer as written, to keep untouched layers byte for byte.
  source: string;
}

function splitTopLevel(input: string, separator: "," | " "): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (separator === " " ? /\s/.test(ch) : ch === separator)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseShadow(input: string): ShadowLayer[] | null {
  const layers: ShadowLayer[] = [];
  for (const source of splitTopLevel(input, ",")) {
    let inset = false;
    const lengths: number[] = [];
    let color: string | null = null;
    for (const part of splitTopLevel(source, " ")) {
      if (part.toLowerCase() === "inset") { inset = true; continue; }
      const length = parseLengthPx(part);
      if (length !== null) { lengths.push(length); continue; }
      const hex = normalizeColor(part);
      if (hex === null || color !== null) return null;
      color = hex;
    }
    if (lengths.length < 2 || lengths.length > 4 || color === null) return null;
    layers.push({ inset, x: lengths[0], y: lengths[1], blur: lengths[2] ?? 0, spread: lengths[3] ?? 0, color, source });
  }
  return layers.length ? layers : null;
}

// Canonical text of one layer; it parses back with parseShadow.
export const shadowKey = (l: { inset?: boolean; x: number; y: number; blur: number; spread: number; color: string }) =>
  `${l.inset ? "inset " : ""}${px(l.x)} ${px(l.y)} ${px(l.blur)} ${px(l.spread)} ${normalizeColor(l.color) ?? l.color}`;

// Canonical text for comparing two shadows, or null when the value is not a plain shadow list.
export function normalizeShadow(input: string): string | null {
  const layers = parseShadow(input);
  return layers ? layers.map(shadowKey).join(", ") : null;
}

const px = (n: number) => (n === 0 ? "0" : `${num(n, 2)}px`);

const colorText = (source: string) => splitTopLevel(source, " ").find((part) => normalizeColor(part) !== null) ?? "";

// Writes a canonical shadow value, keeping the text of every layer that did not change.
export function writeShadow(canonical: string, original?: string): string {
  const next = parseShadow(canonical);
  if (!next) return canonical;
  const previous = original ? parseShadow(original) : null;
  return next
    .map((layer, i) => {
      const old = previous?.[i];
      return old && shadowKey(old) === shadowKey(layer) ? old.source : formatShadow(layer, old?.source);
    })
    .join(", ");
}

// Replaces the first layer of `original` and keeps any further layers exactly as written.
// A color that did not change keeps the text it had, so `0.04` does not turn into `0.039`.
export function formatShadow(layer: { inset?: boolean; x: number; y: number; blur: number; spread: number; color: string }, original?: string): string {
  const previous = original ? parseShadow(original) : null;
  const before = previous?.[0];
  const hex = normalizeColor(layer.color);
  const color = !hex
    ? layer.color
    : before && before.color === hex
      ? colorText(before.source)
      : formatLike(before ? colorText(before.source) : "", hex);
  const first = `${layer.inset ? "inset " : ""}${px(layer.x)} ${px(layer.y)} ${px(layer.blur)} ${px(layer.spread)} ${color}`;
  return [first, ...(previous?.slice(1).map((l) => l.source) ?? [])].join(", ");
}
