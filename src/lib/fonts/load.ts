import { googleFontsUrl } from "./google";

// Loads Google Fonts into the page (the editor's own, for the previews in the picker) by a stylesheet link, once per set of families.
const loaded = new Set<string>();

export function loadFonts(families: string[], text?: string): void {
  if (typeof document === "undefined" || families.length === 0) return;
  const url = googleFontsUrl(families, { text, weights: () => [400] });
  if (loaded.has(url)) return;
  loaded.add(url);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.motifFont = "";
  document.head.appendChild(link);
}
