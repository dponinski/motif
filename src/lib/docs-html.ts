import type { CanvasElement } from "../store/canvas";
import type { ColorToken, RadiusToken, ShadowToken, SpacingToken, TypographyToken } from "../store/design-system";
import { componentInterface, componentJsx } from "./component-code";
import type { DocSection } from "./docs";
import type { DocBlock, DocPage, DocumentComponent } from "./motif-document";

export interface DocsTokens {
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
  radii: RadiusToken[];
  shadows: ShadowToken[];
}

export interface DocsContext {
  components: DocumentComponent[];
  tokens: DocsTokens;
}

// Documents can arrive from a shared repository, so nothing from them reaches markup unescaped.
export const esc = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const cssValue = (value: unknown, fallback: string) => {
  const text = String(value ?? "");
  return /^[#(),.%\w\s-]+$/.test(text) && !/url/i.test(text) ? text : fallback;
};

const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

// ── Component preview ─────────────────────────────────────────────────────────

function absolute(el: CanvasElement, elements: Record<string, CanvasElement>, depth = 0): { x: number; y: number } {
  const parent = el.parentId ? elements[el.parentId] : undefined;
  if (!parent || depth > 50) return { x: num(el.x), y: num(el.y) };
  const p = absolute(parent, elements, depth + 1);
  return { x: p.x + num(el.x), y: p.y + num(el.y) };
}

function drawOrder(ids: string[], elements: Record<string, CanvasElement>, seen = new Set<string>()): CanvasElement[] {
  const out: CanvasElement[] = [];
  for (const id of ids) {
    const el = elements[id];
    if (!el || seen.has(id)) continue;
    seen.add(id);
    out.push(el, ...drawOrder(el.children ?? [], elements, seen));
  }
  return out;
}

// Mirrors how the canvas draws a scene: absolute positions, parents before children, no clipping.
export function sceneToSvg(component: DocumentComponent, ctx: DocsContext): string {
  const { elements } = component;
  const visible = drawOrder(component.order, elements).filter((el) => el.visible !== false);
  if (!visible.length) return "";

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const shapes = visible.map((el) => {
    const { x, y } = absolute(el, elements);
    const w = Math.max(num(el.width), 0);
    const h = Math.max(num(el.height), 0);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);

    const token = el.fillTokenId ? ctx.tokens.colors.find((c) => c.id === el.fillTokenId)?.value : undefined;
    const fill = esc(cssValue(token ?? el.fill, el.type === "frame" ? "#ffffff" : "#6366f1"));
    const stroke = el.stroke && num(el.strokeWidth) > 0
      ? ` stroke="${esc(cssValue(el.stroke, "none"))}" stroke-width="${num(el.strokeWidth)}"`
      : "";
    const common = `opacity="${num(el.opacity, 1)}"${el.rotation ? ` transform="rotate(${num(el.rotation)} ${x} ${y})"` : ""}`;

    switch (el.type) {
      case "ellipse":
        return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${stroke} ${common}/>`;
      case "text": {
        const typo = el.typographyTokenId ? ctx.tokens.typography.find((t) => t.id === el.typographyTokenId) : undefined;
        const size = num(typo?.fontSize ?? el.fontSize, 16);
        const style = [
          `width:${w}px`,
          `font-size:${size}px`,
          `font-weight:${esc(cssValue(typo?.fontWeight ?? el.fontWeight, "400"))}`,
          `font-family:${esc(cssValue(typo?.fontFamily ?? el.fontFamily, "Inter"))},system-ui,sans-serif`,
          `color:${esc(cssValue(el.fontColor, "#111111"))}`,
          "line-height:1.16", "white-space:pre-wrap", "overflow-wrap:break-word",
        ].join(";");
        return `<foreignObject x="${x}" y="${y}" width="${w}" height="${Math.max(h, size * 1.2)}" style="overflow:visible" ${common}><div xmlns="http://www.w3.org/1999/xhtml" style="${style}">${esc(el.content ?? "")}</div></foreignObject>`;
      }
      case "instance": {
        const name = ctx.components.find((c) => c.id === el.componentId)?.name ?? "Missing component";
        return `<g ${common}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="rgba(99,102,241,0.08)" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-size="12" font-family="Inter,system-ui,sans-serif" fill="#6366f1">${esc(name)}</text></g>`;
      }
      default: {
        const r = num(el.cornerRadius);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke} ${common}/>`;
      }
    }
  });

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(component.name)} preview">${shapes.join("")}</svg>`;
}

// ── Blocks ────────────────────────────────────────────────────────────────────

const empty = (text: string) => `<p class="md-empty">${esc(text)}</p>`;

export const paragraphs = (text: string) =>
  text.trim().split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

function tokensHtml(kind: Extract<DocBlock, { type: "tokens" }>["kind"], tokens: DocsTokens): string {
  switch (kind) {
    case "colors": {
      if (!tokens.colors.length) return empty("No color tokens yet.");
      const groups = new Map<string, ColorToken[]>();
      for (const c of tokens.colors) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
      return [...groups].map(([group, list]) =>
        `<div class="md-group">${esc(group)}</div><div class="md-swatches">${list.map((c) =>
          `<div><div class="md-swatch" style="background:${esc(cssValue(c.value, "transparent"))}"></div><div class="md-name">${esc(c.name)}</div><div class="md-value">${esc(c.value)}</div></div>`
        ).join("")}</div>`
      ).join("");
    }
    case "typography":
      if (!tokens.typography.length) return empty("No text styles yet.");
      return tokens.typography.map((t) => {
        const style = `font-family:${esc(cssValue(t.fontFamily, "Inter"))},system-ui,sans-serif;font-size:${Math.min(num(t.fontSize, 16), 48)}px;font-weight:${num(t.fontWeight, 400)};line-height:1.2`;
        return `<div class="md-row"><div class="md-grow" style="${style}">${esc(t.name)}</div><div class="md-value">${esc(t.fontFamily)} · ${num(t.fontSize)}/${num(t.lineHeight)} · ${num(t.fontWeight)}</div></div>`;
      }).join("");
    case "spacing":
      if (!tokens.spacing.length) return empty("No spacing tokens yet.");
      return tokens.spacing.map((s) =>
        `<div class="md-row"><div class="md-name md-label">${esc(s.name)}</div><div class="md-grow"><div class="md-bar" style="width:${Math.min(num(s.value), 400)}px"></div></div><div class="md-value">${num(s.value)}px</div></div>`
      ).join("");
    case "radii":
      if (!tokens.radii.length) return empty("No radius tokens yet.");
      return `<div class="md-swatches">${tokens.radii.map((r) =>
        `<div><div class="md-swatch md-shape" style="border-radius:${Math.min(num(r.value), 28)}px"></div><div class="md-name">${esc(r.name)}</div><div class="md-value">${num(r.value)}px</div></div>`
      ).join("")}</div>`;
    case "shadows":
      if (!tokens.shadows.length) return empty("No shadow tokens yet.");
      return `<div class="md-swatches md-padded">${tokens.shadows.map((s) => {
        const value = `${num(s.x)}px ${num(s.y)}px ${num(s.blur)}px ${num(s.spread)}px ${cssValue(s.color, "transparent")}`;
        return `<div><div class="md-swatch md-card" style="box-shadow:${esc(value)}"></div><div class="md-name">${esc(s.name)}</div><div class="md-value">${esc(value)}</div></div>`;
      }).join("")}</div>`;
  }
}

export function blockHtml(block: DocBlock, ctx: DocsContext): string {
  switch (block.type) {
    case "heading":
      return block.text.trim() ? `<h2>${esc(block.text)}</h2>` : "";
    case "text":
      return paragraphs(block.text);
    case "guideline":
      if (!block.do.trim() && !block.dont.trim()) return "";
      return `<div class="md-guideline"><div class="md-do"><strong>Do</strong>${paragraphs(block.do)}</div><div class="md-dont"><strong>Don't</strong>${paragraphs(block.dont)}</div></div>`;
    case "tokens":
      return tokensHtml(block.kind, ctx.tokens);
    case "preview":
    case "props":
    case "code": {
      const component = ctx.components.find((c) => c.id === block.componentId);
      if (!component) return empty("This component no longer exists.");
      if (block.type === "preview") {
        const svg = sceneToSvg(component, ctx);
        return `<div class="md-preview">${svg || empty(`${component.name} has nothing on its canvas yet.`)}</div>`;
      }
      if (block.type === "code") {
        const parts = component.variantProps.length ? [componentInterface(component), componentJsx(component)] : [componentJsx(component)];
        return `<pre><code>${esc(parts.join("\n\n"))}</code></pre>`;
      }
      if (!component.variantProps.length) return empty(`${component.name} has no props yet.`);
      return `<table><thead><tr><th>Prop</th><th>Values</th><th>Default</th></tr></thead><tbody>${component.variantProps.map((p) =>
        `<tr><td><code>${esc(p.name)}</code></td><td>${p.values.map((v) => `<code class="md-chip">${esc(v)}</code>`).join("")}</td><td><code>${esc(p.default)}</code></td></tr>`
      ).join("")}</tbody></table>`;
    }
  }
}

// ── Stylesheet ────────────────────────────────────────────────────────────────

// Scoped to .motif-docs so the editor can show pages exactly as they export.
export const DOCS_CSS = `
.motif-docs{color:#18181b;font:14px/1.65 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.motif-docs *{box-sizing:border-box}
.motif-docs h1{font-size:28px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;margin:0 0 20px}
.motif-docs h2{font-size:18px;line-height:1.3;font-weight:600;margin:0}
.motif-docs p{margin:0 0 12px;color:#3f3f46}
.motif-docs p:last-child{margin-bottom:0}
.motif-docs .md-block{margin:0 0 24px}
.motif-docs .md-empty{color:#a1a1aa;font-size:13px}
.motif-docs .md-preview{display:flex;align-items:center;justify-content:center;padding:32px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden}
.motif-docs .md-preview svg{display:block;max-width:100%;height:auto;max-height:420px}
.motif-docs table{width:100%;border-collapse:collapse;font-size:13px}
.motif-docs th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#71717a;padding:8px 12px;border-bottom:1px solid #e4e4e7}
.motif-docs td{padding:8px 12px;border-bottom:1px solid #f4f4f5;vertical-align:top}
.motif-docs code,.motif-docs pre{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:12px}
.motif-docs pre{margin:0;padding:16px;background:#18181b;color:#e4e4e7;border-radius:10px;overflow-x:auto;line-height:1.6}
.motif-docs .md-chip{display:inline-block;background:#f4f4f5;border-radius:4px;padding:1px 6px;margin:0 4px 4px 0}
.motif-docs .md-group{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#71717a;margin:16px 0 8px}
.motif-docs .md-group:first-child{margin-top:0}
.motif-docs .md-swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px}
.motif-docs .md-padded{gap:24px;padding:8px}
.motif-docs .md-swatch{height:56px;border-radius:8px;border:1px solid rgba(0,0,0,.08)}
.motif-docs .md-shape{background:#e0e7ff;border-color:#6366f1}
.motif-docs .md-card{background:#fff;border-color:#f4f4f5}
.motif-docs .md-name{font-size:12px;font-weight:500;margin-top:6px}
.motif-docs .md-value{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;color:#71717a;overflow-wrap:anywhere}
.motif-docs .md-row{display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid #f4f4f5}
.motif-docs .md-grow{flex:1;min-width:0}
.motif-docs .md-label{width:96px;margin:0;flex-shrink:0}
.motif-docs .md-bar{height:12px;border-radius:3px;background:#6366f1}
.motif-docs .md-guideline{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.motif-docs .md-do,.motif-docs .md-dont{border-top:3px solid #16a34a;border-radius:4px;background:#fafafa;padding:12px 14px}
.motif-docs .md-dont{border-top-color:#dc2626}
.motif-docs .md-guideline strong{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#16a34a;margin-bottom:4px}
.motif-docs .md-dont strong{color:#dc2626}
`;

const SITE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
html{scroll-behavior:smooth}
body{margin:0;background:#fff}
.md-site{display:flex;min-height:100vh}
.md-nav{width:240px;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;padding:24px 16px;border-right:1px solid #e4e4e7;font-size:13px}
.md-nav-title{font-size:15px;font-weight:700;padding:0 8px;margin-bottom:8px}
.md-nav-section{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#a1a1aa;padding:0 8px;margin:16px 0 4px}
.md-nav a{display:block;padding:4px 8px;border-radius:6px;color:#3f3f46;text-decoration:none}
.md-nav a:hover{background:#f4f4f5}
.md-main{flex:1;min-width:0;max-width:880px;padding:48px 56px}
.md-main article{padding-bottom:48px;margin-bottom:48px;border-bottom:1px solid #e4e4e7}
.md-main article:last-child{border-bottom:0;margin-bottom:0}
@media (max-width:720px){.md-site{display:block}.md-nav{position:static;width:auto;height:auto;border-right:0;border-bottom:1px solid #e4e4e7}.md-main{padding:24px 16px}}
`;

// ── Full site ─────────────────────────────────────────────────────────────────

function pageHtml(page: DocPage, ctx: DocsContext): string {
  const blocks = page.blocks.map((b) => blockHtml(b, ctx)).filter(Boolean).map((html) => `<div class="md-block">${html}</div>`);
  return `<article id="${esc(page.id)}"><h1>${esc(page.title || "Untitled")}</h1>${blocks.join("")}</article>`;
}

export function renderDocsSite(name: string, sections: DocSection[], ctx: DocsContext): string {
  const shown = sections.filter((s) => s.pages.length);
  const nav = shown.map((s) =>
    `<div class="md-nav-section">${esc(s.title)}</div>${s.pages.map((p) => `<a href="#${esc(p.id)}">${esc(p.title || "Untitled")}</a>`).join("")}`
  ).join("");
  const pages = shown.flatMap((s) => s.pages.map((p) => pageHtml(p, ctx))).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} · Design system</title>
<style>${SITE_CSS}${DOCS_CSS}</style>
</head>
<body class="motif-docs">
<div class="md-site">
<nav class="md-nav"><div class="md-nav-title">${esc(name)}</div>${nav}</nav>
<main class="md-main">${pages}</main>
</div>
</body>
</html>
`;
}
