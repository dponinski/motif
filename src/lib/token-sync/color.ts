export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const trim = (n: number, digits: number) => String(parseFloat(n.toFixed(digits)));

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseArgs(body: string): { parts: string[]; alpha: string | undefined } | null {
  let main = body;
  let alpha: string | undefined;
  if (body.includes("/")) {
    const [m, a, ...rest] = body.split("/");
    if (rest.length) return null;
    main = m;
    alpha = a.trim();
  }
  const parts = (main.includes(",") ? main.split(",") : main.trim().split(/\s+/)).map((s) => s.trim()).filter(Boolean);
  if (alpha === undefined && parts.length === 4) alpha = parts.pop();
  return { parts, alpha };
}

// Percentages scale to `full`; `none` is 0.
function channel(token: string, full: number): number | null {
  if (token === "none") return 0;
  const n = parseFloat(token);
  if (Number.isNaN(n) || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(token)) return null;
  return token.endsWith("%") ? (n / 100) * full : n;
}

function hue(token: string): number | null {
  if (token === "none") return 0;
  const m = token.match(/^([-+]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "deg").toLowerCase();
  return unit === "turn" ? n * 360 : unit === "rad" ? (n * 180) / Math.PI : unit === "grad" ? n * 0.9 : n;
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const n = channel(token, 1);
  return n === null ? null : clamp(n, 0, 1);
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklabToRgb(L: number, a: number, b: number): { r: number; g: number; b: number } {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
  return { r: clamp(linearToSrgb(lin.r), 0, 1) * 255, g: clamp(linearToSrgb(lin.g), 0, 1) * 255, b: clamp(linearToSrgb(lin.b), 0, 1) * 255 };
}

export function rgbToOklab({ r, g, b }: Rgba): { L: number; a: number; b: number } {
  const [lr, lg, lb] = [r, g, b].map((c) => srgbToLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hh = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const x = (t + 1) % 1;
    const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
    return v * 255;
  };
  return { r: f(hh + 1 / 3), g: f(hh), b: f(hh - 1 / 3) };
}

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return { ...NAMED[s] };

  const hex = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }

  const fn = s.match(/^([a-z]+)\(\s*(.*?)\s*\)$/);
  if (!fn) return null;
  const args = parseArgs(fn[2]);
  if (!args || args.parts.length !== 3) return null;
  const a = alphaOf(args.alpha);
  if (a === null) return null;
  const [p0, p1, p2] = args.parts;

  switch (fn[1]) {
    case "rgb":
    case "rgba": {
      const [r, g, b] = [channel(p0, 255), channel(p1, 255), channel(p2, 255)];
      return r === null || g === null || b === null ? null : { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a };
    }
    case "hsl":
    case "hsla": {
      const [h, sat, light] = [hue(p0), channel(p1, 1), channel(p2, 1)];
      if (h === null || sat === null || light === null) return null;
      return { ...hslToRgb(h, clamp(sat, 0, 1), clamp(light, 0, 1)), a };
    }
    case "oklch": {
      const [L, C, H] = [channel(p0, 1), channel(p1, 0.4), hue(p2)];
      if (L === null || C === null || H === null) return null;
      const rad = (H * Math.PI) / 180;
      return { ...oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad)), a };
    }
    case "oklab": {
      const [L, A, B] = [channel(p0, 1), channel(p1, 0.4), channel(p2, 0.4)];
      return L === null || A === null || B === null ? null : { ...oklabToRgb(L, A, B), a };
    }
    default:
      return null;
  }
}

// ── Output ────────────────────────────────────────────────────────────────────

const byte = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");

export function toHex(c: Rgba): string {
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${c.a < 1 ? byte(c.a * 255) : ""}`;
}

// Hex for anything parseable, null otherwise (var(), color-mix(), calc(), named colors beyond a few).
export function normalizeColor(input: string): string | null {
  const c = parseColor(input);
  return c ? toHex(c) : null;
}

const alphaPart = (a: number) => (a < 1 ? ` / ${trim(a, 3)}` : "");

// Writes `hex` in the notation `original` uses, so editing one token does not restyle the file.
// What it writes always reads back as exactly `hex`; if the notation cannot say so, it writes hex.
export function formatLike(original: string, hex: string): string {
  const text = notate(original, hex);
  return normalizeColor(text) === hex.toLowerCase() ? text : hex;
}

function notate(original: string, hex: string): string {
  const c = parseColor(hex);
  const o = original.trim().toLowerCase();
  if (!c) return hex;
  if (o.startsWith("oklch(")) {
    const { L, a, b } = rgbToOklab(c);
    const chroma = Math.hypot(a, b);
    const h = chroma < 0.0005 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    // Most precision is only used when the short form would read back as a different color.
    for (const digits of [3, 4, 5]) {
      const text = `oklch(${trim(L, digits)} ${trim(chroma < 0.0005 ? 0 : chroma, digits)} ${trim(h, digits - 1)}${alphaPart(c.a)})`;
      if (normalizeColor(text) === hex.toLowerCase()) return text;
    }
    return hex;
  }
  if (o.startsWith("hsl")) {
    const r = c.r / 255, g = c.g / 255, bl = c.b / 255;
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl), d = max - min;
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) h = max === r ? ((g - bl) / d) % 6 : max === g ? (bl - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const parts = [Math.round(h), `${Math.round(s * 100)}%`, `${Math.round(l * 100)}%`];
    return o.includes(",") ? `hsl(${parts.join(", ")}${c.a < 1 ? `, ${trim(c.a, 3)}` : ""})` : `hsl(${parts.join(" ")}${alphaPart(c.a)})`;
  }
  if (o.startsWith("rgb")) {
    const parts = [Math.round(c.r), Math.round(c.g), Math.round(c.b)];
    return o.includes(",") ? `rgb(${parts.join(", ")}${c.a < 1 ? `, ${trim(c.a, 3)}` : ""})` : `rgb(${parts.join(" ")}${alphaPart(c.a)})`;
  }
  return hex;
}
