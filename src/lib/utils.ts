import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

export function luminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const vals = [rgb.r, rgb.g, rgb.b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2];
}

export function contrastColor(hex: string): "white" | "black" {
  return luminance(hex) > 0.35 ? "black" : "white";
}

export function formatPx(value: number) {
  return `${Math.round(value)}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function roundToGrid(value: number, grid: number) {
  return Math.round(value / grid) * grid;
}

export function formatZoom(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

// Convert CSS font-weight name to numeric
export function fontWeightNum(weight: string): number {
  const map: Record<string, number> = {
    "100": 100, thin: 100,
    "200": 200, extralight: 200,
    "300": 300, light: 300,
    "400": 400, normal: 400, regular: 400,
    "500": 500, medium: 500,
    "600": 600, semibold: 600,
    "700": 700, bold: 700,
    "800": 800, extrabold: 800,
    "900": 900, black: 900,
  };
  return map[weight.toLowerCase()] ?? parseInt(weight) ?? 400;
}

export function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadString(content: string, filename: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
