import type { RepoToken } from "../repo-scan/types";
import { aliasTarget } from "../tokens/alias";
import { formatChannels } from "../token-sync/color";
import type { SyncDoc, SyncKind } from "../token-sync/doc";
import { formatLength, writeShadow } from "../token-sync/values";
import { CONFIG_PREFIX, CONFIG_SECTION } from "../token-sync/write";

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

// A Tailwind 3 config wraps a color variable that holds bare channels (`hsl(var(--primary))`), so the variable is written as channels.
export type ChannelForms = Record<string, "hsl" | "rgb">;
const formsOf = (tokens: RepoToken[]): ChannelForms => Object.fromEntries(tokens.filter((t) => t.channels).map((t) => [t.name, t.channels!]));
const variableText = (kind: SyncKind, value: string, form: "hsl" | "rgb" | undefined) =>
  form && kind === "color" && aliasTarget(value) === null ? formatChannels(form, value) : text(kind, value);

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
export function tokenOverrides(current: SyncDoc, base: SyncDoc, baseTheme: string, themes: string[] = [], forms: ChannelForms = {}): TokenOverrides {
  const byTheme = new Map<string, string[]>();
  const changed = new Set<string>();
  for (const [name, token] of Object.entries(current)) {
    for (const [theme, value] of Object.entries(token.values)) {
      if (base[name]?.values[theme] === value) continue;
      byTheme.set(theme, [...(byTheme.get(theme) ?? []), `  --${name}: ${variableText(token.kind, value, forms[name])};`]);
      changed.add(name);
    }
  }
  const all = [...new Set([...themes, ...byTheme.keys()])];
  const order = [...byTheme.keys()].sort((a, b) => Number(b === baseTheme) - Number(a === baseTheme));
  const css = order.map((theme) => `${selectorFor(theme, baseTheme, all)} {\n${byTheme.get(theme)!.join("\n")}\n}`).join("\n");
  return { css, changed: [...changed] };
}

export { formsOf as channelForms };

// What a Tailwind 3 page needs besides variables: the values Motif changed that live in the repository's config (and the tokens Motif has
// that the config hasn't), as the entries of its `theme.extend` that give them, by section. A token that is a variable the config wraps is
// shown by the variable alone.
export function tailwind3Extend(current: SyncDoc, base: SyncDoc, baseTheme: string, tokens: RepoToken[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const form = tokens.find((t) => t.channels)?.channels;
  const set = (path: string[], value: string) => {
    let at: Record<string, unknown> = (out[path[0]] ??= {});
    for (const key of path.slice(1, -1)) at = (at[key] = typeof at[key] === "object" && at[key] !== null ? at[key] : {}) as Record<string, unknown>;
    if (path.length === 1) throw new Error("a config value has a name");
    at[path[path.length - 1]] = value;
  };
  for (const [name, token] of Object.entries(current)) {
    const value = token.values[baseTheme];
    if (value === undefined || base[name]?.values[baseTheme] === value) continue;
    const known = tokens.find((t) => t.name === name);
    if (known) {
      // Variables are written by the stylesheet override; what's left is a value written in the config itself.
      if (known.channels) continue;
      const where = Object.values(known.locations).find((l) => l.container === "config" && l.path);
      if (where?.path && where.path.length >= 2) set(where.path, text(token.kind, value));
      continue;
    }
    const prefix = CONFIG_PREFIX[token.kind];
    if (!name.startsWith(prefix) || name.length === prefix.length) continue;
    const key = name.slice(prefix.length);
    if (token.kind === "color" && form) set([CONFIG_SECTION.color, key], `${form}(var(--${name}))`);
    else set([CONFIG_SECTION[token.kind], key], text(token.kind, value));
  }
  return out;
}
