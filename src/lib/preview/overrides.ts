import type { SyncDoc, SyncKind } from "../token-sync/doc";
import { formatLength, writeShadow } from "../token-sync/values";

// What Motif has changed in its tokens since the repository was last synced, as CSS that goes after the
// repository's own, so previews show the repository's components in Motif's tokens before a pull request exists.

const themeSelector = (theme: string) => (theme === "dark" ? ".dark" : `[data-theme="${theme}"]`);

// One element more specific than the repository's own selector, so it wins wherever the variable is set. The
// base theme's rule must not outrank the others (the repository's `.dark` beats its `:root` by coming later),
// so it only applies where no other theme does.
const selectorFor = (theme: string, baseTheme: string, themes: string[]) =>
  theme === baseTheme
    ? `html:root${themes.filter((t) => t !== baseTheme).map((t) => `:not(${themeSelector(t)})`).join("")}`
    : `html${themeSelector(theme)}`;

const text = (kind: SyncKind, value: string) =>
  kind === "color" ? value : kind === "shadow" ? writeShadow(value) : formatLength(parseFloat(value));

// The same changes as values, by token name and theme, for showing what a token is worth outside a preview.
export function changedValues(current: SyncDoc, base: SyncDoc): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [name, token] of Object.entries(current)) {
    for (const [theme, value] of Object.entries(token.values)) {
      if (base[name]?.values[theme] === value) continue;
      (out[name] ??= {})[theme] = text(token.kind, value);
    }
  }
  return out;
}

export interface TokenOverrides {
  css: string;
  // Names of the tokens that differ.
  changed: string[];
}

// `themes` is every theme the repository has, whether or not anything changed in it.
export function tokenOverrides(current: SyncDoc, base: SyncDoc, baseTheme: string, themes: string[] = []): TokenOverrides {
  const byTheme = new Map<string, string[]>();
  const changed = new Set<string>();
  for (const [name, token] of Object.entries(current)) {
    for (const [theme, value] of Object.entries(token.values)) {
      if (base[name]?.values[theme] === value) continue;
      byTheme.set(theme, [...(byTheme.get(theme) ?? []), `  --${name}: ${text(token.kind, value)};`]);
      changed.add(name);
    }
  }
  const all = [...new Set([...themes, ...byTheme.keys()])];
  const order = [...byTheme.keys()].sort((a, b) => Number(b === baseTheme) - Number(a === baseTheme));
  const css = order.map((theme) => `${selectorFor(theme, baseTheme, all)} {\n${byTheme.get(theme)!.join("\n")}\n}`).join("\n");
  return { css, changed: [...changed] };
}
