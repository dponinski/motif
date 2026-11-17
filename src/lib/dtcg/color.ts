import { parseColor, toHex } from "../token-sync/color";

// A CSS color as a design tokens (2025.10) color object, in the notation it was written in: a hex or rgb() color is `srgb`, hsl() is `hsl`,
// oklch() is `oklch`, color(display-p3 …) is `display-p3`. What can't be said that way (var(), color-mix(), calc()) isn't a token's color.

export interface ColorValue {
  colorSpace: string;
  components: (number | "none")[];
  alpha?: number;
  hex?: string;
}

const round = (n: number, digits = 4) => parseFloat(n.toFixed(digits));
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

// `0.5`, `50%` (of `full`), `none`, `120deg` -> a number.
function part(token: string, full: number, hue = false): number | "none" | null {
  if (token === "none") return "none";
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(%|deg|turn|rad|grad)?$/i.exec(token);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (hue) return unit === "turn" ? n * 360 : unit === "rad" ? (n * 180) / Math.PI : unit === "grad" ? n * 0.9 : unit === "%" ? null : n;
  return unit === "%" ? (n / 100) * full : unit === "" ? n : null;
}

function args(body: string): { parts: string[]; alpha: string | undefined } | null {
  const [main, alpha, ...rest] = body.split("/");
  if (rest.length) return null;
  const parts = (main.includes(",") ? main.split(",") : main.trim().split(/\s+/)).map((s) => s.trim()).filter(Boolean);
  return { parts, alpha: alpha?.trim() };
}

const alphaOf = (token: string | undefined): number | null => {
  if (token === undefined) return 1;
  const a = part(token, 1);
  return a === null || a === "none" ? null : Math.min(1, Math.max(0, a));
};

export function cssToColor(css: string): ColorValue | null {
  const s = css.trim().toLowerCase();
  const fn = /^([a-z0-9-]+)\(\s*(.*?)\s*\)$/.exec(s);
  if (fn && ["hsl", "hsla", "oklch", "color"].includes(fn[1])) {
    const a = args(fn[2]);
    if (!a) return null;
    const alpha = alphaOf(a.alpha);
    if (alpha === null) return null;
    const out = (colorSpace: string, components: (number | "none" | null)[]): ColorValue | null =>
      components.length === 3 && components.every((c) => c !== null) ? { colorSpace, components: components.map((c) => (c === "none" ? c : round(c as number))), ...(alpha < 1 ? { alpha: round(alpha) } : {}) } : null;
    if (fn[1] === "hsl" || fn[1] === "hsla") return a.parts.length === 3 ? out("hsl", [part(a.parts[0], 360, true), part(a.parts[1].replace("%", ""), 100), part(a.parts[2].replace("%", ""), 100)]) : null;
    if (fn[1] === "oklch") return a.parts.length === 3 ? out("oklch", [part(a.parts[0], 1), part(a.parts[1], 0.4), part(a.parts[2], 360, true)]) : null;
    // color(display-p3 r g b)
    if (a.parts[0] === "display-p3" && a.parts.length === 4) return out("display-p3", [part(a.parts[1], 1), part(a.parts[2], 1), part(a.parts[3], 1)]);
    return null;
  }
  const c = parseColor(s);
  if (!c) return null;
  const hex = toHex({ ...c, a: 1 });
  return { colorSpace: "srgb", components: [round(c.r / 255), round(c.g / 255), round(c.b / 255)], ...(c.a < 1 ? { alpha: round(c.a) } : {}), hex };
}

const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n * 255))).toString(16).padStart(2, "0");
const num = (c: number | "none") => (c === "none" ? "none" : String(round(c)));
const alphaText = (alpha: number | undefined) => (alpha !== undefined && alpha < 1 ? ` / ${round(alpha, 3)}` : "");

// The CSS a color object is: hex for `srgb`, otherwise the function it is the components of. Null for a color space Motif doesn't write.
export function colorToCss(v: ColorValue): string | null {
  const c = v.components;
  if (!Array.isArray(c) || c.length !== 3 || c.some((x) => x !== "none" && typeof x !== "number")) return null;
  const [a, b, d] = c;
  switch (v.colorSpace) {
    case "srgb": {
      const hex = typeof v.hex === "string" && /^#[0-9a-f]{6}$/i.test(v.hex) ? v.hex.toLowerCase() : `#${byte(a === "none" ? 0 : a)}${byte(b === "none" ? 0 : b)}${byte(d === "none" ? 0 : d)}`;
      return v.alpha !== undefined && v.alpha < 1 ? `${hex}${byte(v.alpha)}` : hex;
    }
    case "hsl": return `hsl(${num(a)} ${num(b)}% ${num(d)}%${alphaText(v.alpha)})`;
    case "oklch": return `oklch(${num(a)} ${num(b)} ${num(d)}${alphaText(v.alpha)})`;
    case "display-p3": return `color(display-p3 ${num(a)} ${num(b)} ${num(d)}${alphaText(v.alpha)})`;
    default: return null;
  }
}

export const isColorValue = (v: unknown): v is ColorValue => typeof v === "object" && v !== null && typeof (v as ColorValue).colorSpace === "string" && Array.isArray((v as ColorValue).components);
export const isNumberText = (s: string) => NUMBER.test(s.trim());
