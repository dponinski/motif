import { oklabToRgb, parseColor, rgbToOklab, toHex } from "../token-sync/color";

// A dark version of a theme's colors. Lightness is turned around in OKLab (so a near-white surface becomes a near-black one and dark text
// becomes light text) while each color keeps its hue and nearly all of its chroma, so a brand color stays the brand color. The ends are
// pulled in: white becomes a soft dark (not black) and black a soft light (not pure white), which is how dark themes are usually made.

const DARK_L = 0.17;
const LIGHT_L = 0.96;
const KEEP_CHROMA = 0.92;

// The dark version of one color, as hex (transparency is kept), or null for what can't be read as a color.
export function darkOf(text: string): string | null {
  const rgb = parseColor(text);
  if (!rgb) return null;
  const lab = rgbToOklab(rgb);
  const L = DARK_L + (1 - Math.min(1, Math.max(0, lab.L))) * (LIGHT_L - DARK_L);
  // The chroma is lowered until the color fits what a screen can show: a color cut off at the edge of it changes hue.
  for (let scale = KEEP_CHROMA; scale > 0; scale -= 0.04) {
    const out = oklabToRgb(L, lab.a * scale, lab.b * scale);
    const back = rgbToOklab({ ...out, a: 1 });
    if (Math.hypot(back.a - lab.a * scale, back.b - lab.b * scale) < 0.004 && Math.abs(back.L - L) < 0.004) return toHex({ ...out, a: rgb.a });
  }
  return toHex({ ...oklabToRgb(L, 0, 0), a: rgb.a });
}
