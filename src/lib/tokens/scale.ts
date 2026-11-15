import { parseColor, rgbToOklab, toHex } from "../token-sync/color";

// Making a scale from one value: a ramp of a color (50 … 950), a spacing scale, a radius scale, a type scale. Each gives drafts of
// tokens that the screen shows before anything is added.

// ── Colors ────────────────────────────────────────────────────────────────────

export interface Lch { L: number; C: number; H: number }

export function toLch(color: string): Lch | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const { L, a, b } = rgbToOklab(rgb);
  const C = Math.hypot(a, b);
  return { L, C, H: C < 0.0005 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

const trim = (n: number, digits: number) => String(parseFloat(n.toFixed(digits)));

// Whether an OKLCH color can be shown as it is. Reading it as sRGB clips what doesn't fit, so one that comes back different didn't.
function inGamut(L: number, C: number, H: number): boolean {
  const rgb = parseColor(`oklch(${trim(L, 4)} ${trim(C, 4)} ${trim(H, 2)})`);
  if (!rgb) return false;
  const back = rgbToOklab(rgb);
  return Math.abs(back.L - L) < 0.004 && Math.abs(Math.hypot(back.a, back.b) - C) < 0.004;
}

// The hex of an OKLCH color, with the chroma brought down until the color is one a screen can show.
export function fromLch({ L, C, H }: Lch): string {
  let c = Math.max(0, C);
  if (!inGamut(L, c, H)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(L, mid, H)) lo = mid; else hi = mid;
    }
    c = lo;
  }
  const rgb = parseColor(`oklch(${trim(L, 4)} ${trim(c, 4)} ${trim(H, 2)})`);
  return rgb ? toHex(rgb) : "#000000";
}

export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// How light each step is, and how much of the color's strength it keeps (1 at the strongest), after the shape of Tailwind's ramps.
const LIGHTNESS: Record<number, number> = { 50: 0.97, 100: 0.932, 200: 0.882, 300: 0.809, 400: 0.707, 500: 0.623, 600: 0.546, 700: 0.488, 800: 0.424, 900: 0.379, 950: 0.282 };
const STRENGTH: Record<number, number> = { 50: 0.06, 100: 0.14, 200: 0.28, 300: 0.45, 400: 0.7, 500: 0.92, 600: 1, 700: 0.96, 800: 0.82, 900: 0.7, 950: 0.55 };

// A value for any step, between the neighbours the table has.
function along(table: Record<number, number>, step: number): number {
  if (step in table) return table[step];
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (step <= keys[0]) return table[keys[0]];
  if (step >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  const hi = keys.find((k) => k > step)!;
  const lo = keys[keys.indexOf(hi) - 1];
  return table[lo] + ((table[hi] - table[lo]) * (step - lo)) / (hi - lo);
}

export interface RampStep { step: number; light: string; dark: string }

// A ramp from one color. The color itself is kept, exactly, at the step it is nearest to in lightness; the other steps share its hue
// and are as strong as the ramp's shape says. The dark value of each step is the light value of the step across the ramp (50 and
// 950 swap), which is how a ramp is turned over for a dark theme.
export function colorRamp(base: string, steps: number[] = RAMP_STEPS): RampStep[] | null {
  const lch = toLch(base);
  const rgb = parseColor(base);
  if (!lch || !rgb) return null;
  const ordered = [...new Set(steps)].filter((s) => Number.isFinite(s) && s > 0).sort((a, b) => a - b);
  if (ordered.length === 0) return null;
  const anchor = ordered.reduce((best, s) => (Math.abs(along(LIGHTNESS, s) - lch.L) < Math.abs(along(LIGHTNESS, best) - lch.L) ? s : best), ordered[0]);
  // Strength is scaled so that the anchor comes out as the color's own chroma; a gray stays a gray.
  const k = lch.C / Math.max(along(STRENGTH, anchor), 0.0001);
  const light = ordered.map((s) => (s === anchor ? toHex({ ...rgb, a: 1 }) : fromLch({ L: along(LIGHTNESS, s), C: Math.min(k * along(STRENGTH, s), 0.37), H: lch.H })));
  return ordered.map((step, i) => ({ step, light: light[i], dark: light[ordered.length - 1 - i] }));
}

// ── Lengths ───────────────────────────────────────────────────────────────────

export interface LengthDraft { name: string; value: number }

// `space-1` is one unit, `space-4` four: the numbers Tailwind uses, in the unit given.
export function spacingScale(unit = 4, steps: number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16], prefix = "space"): LengthDraft[] {
  return steps.map((n) => ({ name: `${prefix}-${trimNumber(n)}`, value: parseFloat((n * unit).toFixed(3)) }));
}

const trimNumber = (n: number) => String(parseFloat(n.toFixed(3)));

// From the medium radius: smaller and larger ones in proportion, and a full one.
export function radiusScale(medium = 8, prefix = "radius"): LengthDraft[] {
  const at = (factor: number) => Math.max(1, Math.round(medium * factor));
  return [
    { name: `${prefix}-sm`, value: at(0.5) },
    { name: `${prefix}-md`, value: at(1) },
    { name: `${prefix}-lg`, value: at(1.5) },
    { name: `${prefix}-xl`, value: at(2) },
    { name: `${prefix}-2xl`, value: at(3) },
    { name: `${prefix}-full`, value: 9999 },
  ];
}

// ── Type ──────────────────────────────────────────────────────────────────────

export interface TypeDraft { name: string; fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number }

const SIZE_NAMES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];

// Sizes that grow by a ratio from the base size (16 and 1.25 is the usual): `text-sm` below it, `text-lg` and up above it. Line
// heights are looser for small text and tighter for large.
export function typeScale(options: { base?: number; ratio?: number; below?: number; above?: number; fontFamily?: string; prefix?: string } = {}): TypeDraft[] {
  const { base = 16, ratio = 1.25, fontFamily = "Inter", prefix = "text" } = options;
  const below = Math.min(Math.max(options.below ?? 2, 0), 2);
  const above = Math.min(Math.max(options.above ?? 5, 0), SIZE_NAMES.length - 3);
  const out: TypeDraft[] = [];
  for (let k = -below; k <= above; k++) {
    const size = k === 0 ? base : Math.round(base * ratio ** k * 2) / 2;
    const lineHeight = Math.round(size * (size >= 30 ? 1.2 : size >= 20 ? 1.3 : 1.5));
    out.push({ name: `${prefix}-${SIZE_NAMES[k + 2]}`, fontFamily, fontSize: size, fontWeight: k > 2 ? 600 : 400, lineHeight });
  }
  return out;
}
