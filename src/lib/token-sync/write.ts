import type { RepoAnalysis, RepoToken } from "../repo-scan/types";
import { BASE, themeOfSelector } from "../repo-scan/tokens";
import { formatLike } from "./color";
import type { RepoSnapshot, SyncDoc, SyncKind } from "./doc";
import type { TokenChange } from "./merge";
import { formatLength, writeShadow } from "./values";

export interface SkippedChange {
  name: string;
  theme: string | null;
  reason: string;
}

export interface WriteResult {
  // Only files that changed, with their new text.
  files: Record<string, string>;
  skipped: SkippedChange[];
}

type Postcss = typeof import("postcss");
type Root = import("postcss").Root;
type Container = import("postcss").Container;
type AtRule = import("postcss").AtRule;
type Rule = import("postcss").Rule;

const writable = (t: RepoToken, theme: string) => {
  const c = t.locations[theme]?.container;
  return c === "css-var" || c === "theme";
};

// ── Notation of what is already in the repository ─────────────────────────────

function sampleOf(analysis: RepoAnalysis, kind: RepoToken["kind"]): string | undefined {
  const counts = new Map<string, { n: number; sample: string }>();
  for (const t of analysis.tokens) {
    if (t.kind !== kind) continue;
    for (const value of Object.values(t.values)) {
      const style = /^(oklch|oklab|hsl|rgb|#)/i.exec(value.trim())?.[1]?.toLowerCase() ?? (/rem\s*$/i.test(value) ? "rem" : "other");
      const entry = counts.get(style) ?? { n: 0, sample: value };
      entry.n++;
      counts.set(style, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.sample;
}

function writtenValue(change: TokenChange, analysis: RepoAnalysis, snapshot: RepoSnapshot): string {
  const after = change.after!;
  const original = snapshot.raw[change.name]?.[change.theme ?? snapshot.baseTheme];
  switch (change.kind) {
    case "color":
      return formatLike(original ?? sampleOf(analysis, "color") ?? "", after);
    case "radius":
    case "spacing":
      return formatLength(parseFloat(after), original ?? sampleOf(analysis, change.kind));
    case "shadow":
      return writeShadow(after, original);
  }
}

// ── Where things live ─────────────────────────────────────────────────────────

// The stylesheet holding most of the repository's tokens.
export function tokensFile(analysis: RepoAnalysis): string | null {
  const counts = new Map<string, number>();
  for (const t of analysis.tokens) {
    for (const [theme, loc] of Object.entries(t.locations)) if (writable(t, theme)) counts.set(loc.file, (counts.get(loc.file) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// Every stylesheet that holds an editable token, since an edit or an addition can land in any of them.
export function filesNeeded(analysis: RepoAnalysis): string[] {
  const files = new Set<string>();
  for (const t of analysis.tokens) for (const [theme, loc] of Object.entries(t.locations)) if (writable(t, theme)) files.add(loc.file);
  return [...files];
}

const KIND_OF: Record<SyncKind, RepoToken["kind"]> = { color: "color", radius: "radius", spacing: "spacing", shadow: "shadow" };

// ── Editing ───────────────────────────────────────────────────────────────────

export async function applyEdits(
  files: Record<string, string>,
  analysis: RepoAnalysis,
  snapshot: RepoSnapshot,
  changes: TokenChange[]
): Promise<WriteResult> {
  const postcss: Postcss = await import("postcss");
  const roots = new Map<string, Root>();
  const touched = new Set<string>();
  const skipped: SkippedChange[] = [];

  const rootOf = (path: string): Root | null => {
    if (roots.has(path)) return roots.get(path)!;
    const text = files[path];
    if (text === undefined) return null;
    const root = postcss.parse(text, { from: path });
    roots.set(path, root);
    return root;
  };

  const isBaseKey = (theme: string) => theme === snapshot.baseTheme;
  const internal = (theme: string) => (isBaseKey(theme) ? BASE : theme);

  const themeRule = (root: Root, theme: string): Rule | null => {
    let found: Rule | null = null;
    root.walkRules((rule) => {
      if (found || themeOfSelector(rule.selector) !== internal(theme)) return;
      if (rule.nodes?.some((n) => n.type === "decl" && n.prop.startsWith("--"))) found = rule;
    });
    return found;
  };

  const ensureThemeRule = (root: Root, theme: string): Rule => {
    const existing = themeRule(root, theme);
    if (existing) return existing;
    const selector = isBaseKey(theme) ? ":root" : theme === "dark" ? ".dark" : `[data-theme="${theme}"]`;
    const rule = postcss.rule({ selector });
    root.append(rule);
    return rule;
  };

  const themeAtRule = (root: Root, inline: boolean): AtRule | null => {
    let found: AtRule | null = null;
    root.walkAtRules("theme", (at) => {
      if (!found && /\binline\b/.test(at.params) === inline) found = at;
    });
    return found;
  };

  const append = (container: Container, prop: string, value: string) => container.append(postcss.decl({ prop, value }));

  const usesAliases = analysis.tokens.some((t) => t.kind === "color" && t.tailwind === `color-${t.name}` && t.locations && Object.values(t.locations).some((l) => l.container === "css-var"));
  const dest = tokensFile(analysis);
  const aliased = new Set<string>();

  // Edits to values that exist.
  for (const change of changes.filter((c) => c.type === "changed")) {
    const token = analysis.tokens.find((t) => t.name === change.name);
    const loc = token?.locations[change.theme ?? ""];
    if (!token || !loc) { skipped.push({ name: change.name, theme: change.theme, reason: "It is not in the repository any more" }); continue; }
    if (!writable(token, change.theme!)) { skipped.push({ name: change.name, theme: change.theme, reason: snapshot.readonly[change.name] ?? "Its source can't be edited yet" }); continue; }
    const root = rootOf(loc.file);
    let target: import("postcss").Declaration | null = null;
    root?.walkDecls(`--${change.name}`, (d) => {
      if (!target && d.source?.start?.line === loc.line) target = d;
    });
    if (!target) { skipped.push({ name: change.name, theme: change.theme, reason: `Couldn't find it in ${loc.file}; the file changed since it was read` }); continue; }
    (target as import("postcss").Declaration).value = writtenValue(change, analysis, snapshot);
    touched.add(loc.file);
  }

  // New tokens, and new theme values for tokens that exist.
  for (const change of changes.filter((c) => c.type === "added")) {
    const existing = analysis.tokens.find((t) => t.name === change.name);
    const existingLocation = existing && Object.values(existing.locations)[0];
    if (existing && !writable(existing, Object.keys(existing.locations)[0])) {
      skipped.push({ name: change.name, theme: change.theme, reason: snapshot.readonly[change.name] ?? "Its source can't be edited yet" });
      continue;
    }

    // Radius, spacing and shadows follow how the repository already declares tokens of their kind.
    const themeBlockToken = change.kind === "color" || existing ? undefined
      : analysis.tokens.find((t) => t.kind === KIND_OF[change.kind] && Object.values(t.locations).some((l) => l.container === "theme"));
    const file = existingLocation?.file ?? (themeBlockToken ? Object.values(themeBlockToken.locations)[0].file : dest);
    const root = file ? rootOf(file) : null;
    if (!file || !root) { skipped.push({ name: change.name, theme: change.theme, reason: "The repository has no stylesheet of tokens to add this to" }); continue; }

    const value = writtenValue(change, analysis, snapshot);
    if (themeBlockToken) {
      const block = themeAtRule(root, false);
      if (!block) { skipped.push({ name: change.name, theme: change.theme, reason: "There is no @theme block to add it to" }); continue; }
      append(block, `--${change.name}`, value);
    } else {
      append(ensureThemeRule(root, change.theme!), `--${change.name}`, value);
      if (change.kind === "color" && usesAliases && !existing && !aliased.has(change.name)) {
        const inline = themeAtRule(root, true);
        if (inline) { append(inline, `--color-${change.name}`, `var(--${change.name})`); aliased.add(change.name); }
        else skipped.push({ name: change.name, theme: null, reason: "Added as a variable, but there is no @theme inline block to make it a Tailwind color" });
      }
    }
    touched.add(file);
  }

  const out: Record<string, string> = {};
  for (const path of touched) out[path] = roots.get(path)!.toString();
  return { files: out, skipped };
}

// ── A tokens file for a repository that has none ──────────────────────────────

const themeSelector = (theme: string) => (theme === "dark" ? ".dark" : `[data-theme="${theme}"]`);

export function generateTokensCss(doc: SyncDoc, options: { tailwind: boolean; baseTheme: string }): string {
  const { baseTheme } = options;
  const lines: string[] = ["/* Design tokens, kept in sync with Motif. */", ""];
  const block = (selector: string, decls: [string, string][]) => {
    if (!decls.length) return;
    lines.push(`${selector} {`, ...decls.map(([p, v]) => `  ${p}: ${v};`), "}", "");
  };
  const text = (kind: SyncKind, value: string) =>
    kind === "color" ? value : kind === "shadow" ? writeShadow(value) : formatLength(parseFloat(value));

  const entries = Object.entries(doc);
  const themes = [...new Set(entries.flatMap(([, t]) => Object.keys(t.values)))].filter((t) => t !== baseTheme);
  const varsFor = (theme: string) => entries.flatMap(([name, t]): [string, string][] => {
    if (t.values[theme] === undefined) return [];
    if (options.tailwind && t.kind !== "color") return [];
    return [[`--${name}`, text(t.kind, t.values[theme])]];
  });

  block(":root", varsFor(baseTheme));
  for (const theme of themes) block(themeSelector(theme), varsFor(theme));

  if (options.tailwind) {
    block("@theme inline", entries.filter(([, t]) => t.kind === "color").map(([name]): [string, string] => [`--color-${name}`, `var(--${name})`]));
    block("@theme", entries.filter(([, t]) => t.kind !== "color").map(([name, t]): [string, string] => [`--${name}`, text(t.kind, t.values[baseTheme] ?? Object.values(t.values)[0])]));
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

