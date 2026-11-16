import type { RepoAnalysis, RepoToken } from "../repo-scan/types";
import { BASE, themeOfSelector } from "../repo-scan/tokens";
import { formatChannels, formatLike } from "./color";
import { aliasTarget } from "../tokens/alias";
import type { RepoSnapshot, SyncDoc, SyncKind } from "./doc";
import type { TokenChange } from "./merge";
import { addToConfig, editConfig, type ConfigAdd, type ConfigSet } from "./config-write";
import { inTheme } from "./keys";
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
  const loc = t.locations[theme];
  // A config value is written in place when it is a plain literal there (the scanner records where it is).
  return loc?.container === "css-var" || loc?.container === "theme" || (loc?.container === "config" && !!loc.path);
};
const isStylesheet = (t: RepoToken, theme: string) => t.locations[theme]?.container === "css-var" || t.locations[theme]?.container === "theme";

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
  // A color that is another token is written as that, whatever notation the repository uses for colors.
  if (change.kind === "color" && aliasTarget(after) !== null) return after.trim();
  const original = snapshot.raw[change.name]?.[change.theme ?? snapshot.baseTheme];
  switch (change.kind) {
    case "color": {
      // A variable of bare channels (`--primary: 222.2 47.4% 11.2%`) stays channels.
      const channels = analysis.tokens.find((t) => t.name === change.name)?.channels;
      if (channels) return formatChannels(channels, after, original);
      return formatLike(original ?? sampleOf(analysis, "color") ?? "", after);
    }
    case "radius":
    case "spacing":
      return formatLength(parseFloat(after), original ?? sampleOf(analysis, change.kind));
    case "shadow":
      return writeShadow(after, original ?? sampleOf(analysis, "shadow"));
  }
}

// ── Where things live ─────────────────────────────────────────────────────────

// The stylesheet holding most of the repository's tokens.
export function tokensFile(analysis: RepoAnalysis): string | null {
  const counts = new Map<string, number>();
  for (const t of analysis.tokens) {
    // Only a stylesheet can hold a new token's variables.
    for (const [theme, loc] of Object.entries(t.locations)) if (isStylesheet(t, theme)) counts.set(loc.file, (counts.get(loc.file) ?? 0) + 1);
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

// Where a Tailwind 3 config keeps each kind of token, and what the token's name starts with.
export const CONFIG_SECTION: Record<SyncKind, string> = { color: "colors", radius: "borderRadius", spacing: "spacing", shadow: "boxShadow" };
export const CONFIG_PREFIX: Record<SyncKind, string> = { color: "", radius: "radius-", spacing: "spacing-", shadow: "shadow-" };

// The Tailwind config the tokens are read from (and a new token is added to).
export function configFile(analysis: RepoAnalysis): string | null {
  for (const t of analysis.tokens) {
    const loc = Object.values(t.locations).find((l) => l.container === "config" && l.path) ?? (t.mapping?.path ? t.mapping : undefined);
    if (loc) return loc.file;
  }
  return null;
}

// ── Editing ───────────────────────────────────────────────────────────────────

export async function applyEdits(
  files: Record<string, string>,
  analysis: RepoAnalysis,
  snapshot: RepoSnapshot,
  changes: TokenChange[],
  // What the repository really has, when the files being edited already hold earlier edits: a value that is changed back to
  // the repository's own is written exactly as the repository had it, not as a converted equivalent (oklch(0.52 …) would
  // come back as oklch(0.519 …), a change nobody made).
  options: { original?: RepoSnapshot } = {}
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

  // The `@theme` block of a stylesheet, made at the end of it when there is none.
  const ensureThemeAtRule = (root: Root, inline: boolean): AtRule => {
    const existing = themeAtRule(root, inline);
    if (existing) return existing;
    const block = postcss.atRule({ name: "theme", params: inline ? "inline" : "", raws: { afterName: inline ? " " : "", between: " " } });
    root.append(block);
    return block;
  };

  const append = (container: Container, prop: string, value: string) => container.append(postcss.decl({ prop, value }));

  const usesAliases = analysis.tokens.some((t) => t.kind === "color" && t.tailwind === `color-${t.name}` && t.locations && Object.values(t.locations).some((l) => l.container === "css-var"));
  const dest = tokensFile(analysis);
  const aliased = new Set<string>();
  // Values to change in Tailwind configs, by file.
  const configSets = new Map<string, ConfigSet[]>();
  const configAdds = new Map<string, ConfigAdd[]>();

  // Edits to values that exist.
  for (const change of changes.filter((c) => c.type === "changed")) {
    const token = analysis.tokens.find((t) => t.name === change.name);
    const loc = token?.locations[change.theme ?? ""];
    if (!token || !loc) { skipped.push({ name: change.name, theme: change.theme, reason: "It is not in the repository any more" }); continue; }
    if (!writable(token, change.theme!)) { skipped.push({ name: change.name, theme: change.theme, reason: snapshot.readonly[change.name] ?? "Its source can't be edited yet" }); continue; }
    if (loc.container === "config") {
      const own = options.original;
      const key = change.theme ?? own?.baseTheme ?? snapshot.baseTheme;
      const restored = own && own.doc[change.name]?.values[key] === change.after ? own.raw[change.name]?.[key] : undefined;
      configSets.set(loc.file, [...(configSets.get(loc.file) ?? []), { token: change.name, path: loc.path!, inExtend: !!loc.inExtend, value: restored ?? writtenValue(change, analysis, snapshot) }]);
      continue;
    }
    const root = rootOf(loc.file);
    let target: import("postcss").Declaration | null = null;
    root?.walkDecls(`--${change.name}`, (d) => {
      if (!target && d.source?.start?.line === loc.line) target = d;
    });
    if (!target) { skipped.push({ name: change.name, theme: change.theme, reason: `Couldn't find it in ${loc.file}; the file changed since it was read` }); continue; }
    const own = options.original;
    const key = change.theme ?? own?.baseTheme ?? snapshot.baseTheme;
    const restored = own && own.doc[change.name]?.values[key] === change.after ? own.raw[change.name]?.[key] : undefined;
    (target as import("postcss").Declaration).value = restored ?? writtenValue(change, analysis, snapshot);
    touched.add(loc.file);
  }

  // New tokens, and new theme values for tokens that exist.
  for (const change of changes.filter((c) => c.type === "added")) {
    const existing = analysis.tokens.find((t) => t.name === change.name);
    // In a Tailwind 3 repository a new token is an entry in the config (and, for a color the repository keeps as channels, a variable).
    if (analysis.stack.tailwindVersion === 3 && !existing) {
      const section = CONFIG_SECTION[change.kind];
      const prefix = CONFIG_PREFIX[change.kind];
      const form = analysis.tokens.find((t) => t.channels)?.channels;
      const cfg = configFile(analysis);
      if (!cfg) { skipped.push({ name: change.name, theme: change.theme, reason: "The repository has no Tailwind config to add it to" }); continue; }
      if (change.kind === "color" && form) {
        if (!dest) { skipped.push({ name: change.name, theme: change.theme, reason: "The repository has no stylesheet of tokens to add this to" }); continue; }
        const root = rootOf(dest);
        if (!root) { skipped.push({ name: change.name, theme: change.theme, reason: `${dest} wasn't read` }); continue; }
        append(ensureThemeRule(root, change.theme!), `--${change.name}`, formatChannels(form, change.after!));
        touched.add(dest);
        if (!aliased.has(change.name)) {
          aliased.add(change.name);
          configAdds.set(cfg, [...(configAdds.get(cfg) ?? []), { section, key: change.name, value: `${form}(var(--${change.name}))`, token: change.name }]);
        }
        continue;
      }
      // A config has no themes: only the base value of a token is written.
      if (change.theme !== snapshot.baseTheme) { skipped.push({ name: change.name, theme: change.theme, reason: "A Tailwind 3 config has no themes, so only a new token's base value is written" }); continue; }
      if (!change.name.startsWith(prefix) || change.name.length === prefix.length) { skipped.push({ name: change.name, theme: change.theme, reason: `The name has to start with ${prefix}, which is what gives Tailwind a class for it` }); continue; }
      configAdds.set(cfg, [...(configAdds.get(cfg) ?? []), { section, key: change.name.slice(prefix.length), value: writtenValue(change, analysis, snapshot), token: change.name }]);
      continue;
    }
    const existingLocation = existing && Object.values(existing.locations)[0];
    if (existing && !writable(existing, Object.keys(existing.locations)[0])) {
      skipped.push({ name: change.name, theme: change.theme, reason: snapshot.readonly[change.name] ?? "Its source can't be edited yet" });
      continue;
    }

    // In Tailwind 4 a new token always gets a class: where the repository keeps tokens of its kind, or in a block made for it.
    const v4 = analysis.stack.tailwindVersion === 4;
    // Colors the repository declares right in `@theme` (`--color-brand: #123`) are added there, with a value for the base theme only.
    const directColor = v4 && change.kind === "color" && !existing && !usesAliases && inTheme(analysis.tokens, "color");
    if (directColor) {
      if (change.theme !== snapshot.baseTheme) { skipped.push({ name: change.name, theme: change.theme, reason: "A @theme block has no themes, so only a new color's base value is written" }); continue; }
      const holder = analysis.tokens.find((t) => t.kind === "color" && Object.values(t.locations).some((l) => l.container === "theme"));
      const where = holder && Object.values(holder.locations).find((l) => l.container === "theme")!.file;
      const rootOfBlock = where ? rootOf(where) : null;
      if (!where || !rootOfBlock) { skipped.push({ name: change.name, theme: change.theme, reason: `${where ?? "The stylesheet"} wasn't read` }); continue; }
      append(ensureThemeAtRule(rootOfBlock, false), `--${change.name}`, writtenValue(change, analysis, snapshot));
      touched.add(where);
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
    } else if (v4 && change.kind !== "color" && !existing) {
      // A radius, spacing or shadow in a repository with no `@theme` block of its kind: the block is made.
      if (change.theme !== snapshot.baseTheme) { skipped.push({ name: change.name, theme: change.theme, reason: "A @theme block has no themes, so only a new token's base value is written" }); continue; }
      append(ensureThemeAtRule(root, false), `--${change.name}`, value);
    } else {
      append(ensureThemeRule(root, change.theme!), `--${change.name}`, value);
      if (change.kind === "color" && (usesAliases || v4) && !existing && !aliased.has(change.name)) {
        // The class comes from `@theme inline`, which is made when the repository has none.
        append(ensureThemeAtRule(root, true), `--color-${change.name}`, `var(--${change.name})`);
        aliased.add(change.name);
      }
    }
    touched.add(file);
  }

  const out: Record<string, string> = {};
  for (const path of touched) out[path] = roots.get(path)!.toString();
  for (const file of new Set([...configSets.keys(), ...configAdds.keys()])) {
    const text = files[file];
    const tokens = [...(configSets.get(file) ?? []).map((s) => s.token), ...(configAdds.get(file) ?? []).map((a) => a.token)];
    if (text === undefined) { for (const token of tokens) skipped.push({ name: token, theme: null, reason: `${file} wasn't read` }); continue; }
    const edited = await editConfig(text, file, configSets.get(file) ?? []);
    for (const s of edited.skipped) skipped.push({ name: s.token, theme: null, reason: s.reason });
    const added = await addToConfig(edited.code, file, configAdds.get(file) ?? []);
    for (const s of added.skipped) skipped.push({ name: s.token, theme: null, reason: s.reason });
    if (added.code !== text) out[file] = added.code;
  }
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

