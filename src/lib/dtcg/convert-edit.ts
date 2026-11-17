import { BASE, finalizeTokens, newAccumulator, scanCss, type TokenFile } from "../repo-scan/tokens";
import type { RepoToken } from "../repo-scan/types";
import { aliasTarget } from "../tokens/alias";
import { normalizeColor } from "../token-sync/color";
import { addImport, relativeImport } from "../token-sync/flow";
import { normalizeShadow, parseLengthPx } from "../token-sync/values";
import type { Conversion } from "./convert";

// What the first Push of a converted repository does to its stylesheets: the variables that are now generated from the design tokens files
// are taken out of them, the generated stylesheet is imported where the styles start, and a check says the variables come to the same
// values as before. Everything else in the stylesheets is left as it was.

export interface Sheet { path: string; text: string; sha: string | null }

export interface Difference { name: string; theme: string; before: string; after: string }

export interface ConversionCheck {
  // Variables the stylesheets had, and how many of them come to the same value in every theme.
  total: number;
  identical: number;
  differences: Difference[];
}

export interface ConversionEdit {
  // The stylesheets that changed, with their new text.
  files: Record<string, { text: string; sha: string | null }>;
  // How many declarations were taken out of the stylesheets.
  removed: number;
  // False when there was nowhere to import the generated stylesheet from.
  imported: boolean;
  check: ConversionCheck;
}

type Postcss = typeof import("postcss");

// ── Taking the variables out ──────────────────────────────────────────────────

async function removeVariables(postcss: Postcss, sheet: Sheet, conv: Conversion): Promise<{ text: string; removed: number }> {
  const root = postcss.parse(sheet.text, { from: sheet.path });
  let removed = 0;
  const gone = new Set(conv.converted);
  root.walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) return;
    const name = decl.prop.slice(2);
    if (!gone.has(name)) return;
    const parent = decl.parent;
    const where = parent?.type === "atrule" && (parent as import("postcss").AtRule).name === "theme" ? "theme" : parent?.type === "rule" && parent.parent?.type === "root" ? "rule" : null;
    if (where !== conv.containers[name]) return;
    decl.remove();
    removed++;
  });
  // A rule or @theme with nothing left in it goes too (one that still holds something, a comment or another declaration, stays).
  root.walk((node) => {
    if ((node.type === "rule" || (node.type === "atrule" && (node as import("postcss").AtRule).name === "theme")) && (node as import("postcss").Container).nodes?.length === 0 && removed > 0) node.remove();
  });
  return { text: removed > 0 ? root.toString() : sheet.text, removed };
}

// `@import "<path>";` after the Tailwind import, or (a stylesheet without Tailwind) after the imports it starts with.
function importInto(text: string, target: string, tailwind: boolean): string | null {
  if (text.includes(target)) return text;
  if (tailwind) return addImport(text, target);
  const lines = text.split("\n");
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(@charset\b|@import\b)/.test(lines[i])) at = i + 1;
    else if (lines[i].trim() === "" || /^\s*\/\*.*\*\/\s*$/.test(lines[i])) continue;
    else break;
  }
  lines.splice(at, 0, `@import "${target}";`);
  return lines.join("\n");
}

// ── The check ─────────────────────────────────────────────────────────────────

const squash = (text: string) => text.trim().replace(/\s+/g, " ");

function sameValue(kind: RepoToken["kind"], a: string, b: string): boolean {
  if (squash(a) === squash(b)) return true;
  if (kind === "color") { const [x, y] = [normalizeColor(a), normalizeColor(b)]; return x !== null && x === y; }
  if (kind === "shadow") { const [x, y] = [normalizeShadow(a), normalizeShadow(b)]; return x !== null && x === y; }
  if (kind === "radius" || kind === "spacing") { const [x, y] = [parseLengthPx(a), parseLengthPx(b)]; return x !== null && x === y; }
  return false;
}

// What a variable comes to in a theme: its own value there (else the base one, as the cascade has it), followed through the variables it is.
function resolve(tokens: Map<string, RepoToken>, name: string, theme: string, base: string, depth = 0): string | null {
  const t = tokens.get(name);
  if (!t) return null;
  const value = t.values[theme] ?? t.values[base] ?? Object.values(t.values)[0];
  if (value === undefined) return null;
  const next = aliasTarget(value);
  if (next === null) return value;
  return depth < 8 ? resolve(tokens, next, theme, base, depth + 1) ?? value : value;
}

export async function checkConversion(before: TokenFile[], after: TokenFile[]): Promise<ConversionCheck> {
  const read = async (files: TokenFile[]) => {
    const acc = newAccumulator();
    await scanCss(files, acc, []);
    const found = finalizeTokens(acc);
    return { base: found.themes[0] ?? BASE, themes: found.themes, tokens: new Map(found.tokens.map((t) => [t.name, t])) };
  };
  const [was, now] = await Promise.all([read(before), read(after)]);
  const differences: Difference[] = [];
  let identical = 0;
  for (const [name, t] of was.tokens) {
    const mine = differences.length;
    const place = (tok: RepoToken) => Object.values(tok.locations)[0]?.container;
    const there = now.tokens.get(name);
    if (!there) { differences.push({ name, theme: was.base, before: Object.values(t.values)[0] ?? "", after: "(missing)" }); continue; }
    if (place(t) !== place(there)) differences.push({ name, theme: was.base, before: `${place(t)}`, after: `${place(there)}` });
    for (const theme of new Set([...Object.keys(t.values), ...Object.keys(there.values)])) {
      const [a, b] = [resolve(was.tokens, name, theme, was.base), resolve(now.tokens, name, theme, now.base)];
      if (a === null || b === null || !sameValue(t.kind, a, b)) differences.push({ name, theme, before: a ?? "(none)", after: b ?? "(none)" });
    }
    if (differences.length === mine) identical++;
  }
  return { total: was.tokens.size, identical, differences };
}

export const describeCheck = (c: ConversionCheck): string =>
  c.differences.length === 0
    ? `${c.total} variable${c.total === 1 ? "" : "s"}, all identical`
    : `${c.identical} of ${c.total} variable${c.total === 1 ? "" : "s"} identical; ${new Set(c.differences.map((d) => d.name)).size} differ`;

// ── The edit ──────────────────────────────────────────────────────────────────

export async function editStylesheets(input: {
  sheets: Sheet[];
  conversion: Conversion;
  // The Tailwind entry stylesheet (the one that imports tailwindcss), if there is one.
  entry: string | null;
  tailwind: boolean;
  // The generated stylesheet and its text.
  output: string;
  generated: string;
}): Promise<ConversionEdit> {
  const postcss = (await import("postcss")).default as unknown as Postcss;
  const { conversion, output } = input;
  const next = new Map<string, Sheet>(input.sheets.map((s) => [s.path, s]));
  let removed = 0;
  for (const sheet of input.sheets) {
    const done = await removeVariables(postcss, sheet, conversion);
    removed += done.removed;
    next.set(sheet.path, { ...sheet, text: done.text });
  }

  // Where the generated stylesheet is imported from: the Tailwind entry, else the first stylesheet that had variables taken out of it.
  const host = (input.tailwind ? input.entry : null) ?? input.sheets.find((s) => next.get(s.path)!.text !== s.text)?.path ?? null;
  let imported = false;
  if (host && next.has(host)) {
    const sheet = next.get(host)!;
    const text = importInto(sheet.text, relativeImport(host, output), input.tailwind);
    if (text !== null) { imported = true; next.set(host, { ...sheet, text }); }
  }

  const files: ConversionEdit["files"] = {};
  for (const s of input.sheets) if (next.get(s.path)!.text !== s.text) files[s.path] = { text: next.get(s.path)!.text, sha: s.sha };
  // The check reads the stylesheets as they will be, with the generated one among them.
  const check = await checkConversion(input.sheets, [...[...next.values()].map((s) => ({ path: s.path, text: s.text })), { path: output, text: input.generated }]);
  return { files, removed, imported, check };
}
