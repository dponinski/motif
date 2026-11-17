// The shape of Motif's design tokens files and their config.

export const EXT = "com.motif";

// `tokens.config.json`: how the files are laid out, and what the generator needs to know.
export interface DtcgConfig {
  // One file for all the sets, or one for each.
  files: "single" | "per-set";
  // The stylesheet the tokens are generated into.
  output: string;
  // Tailwind 4: the variables Tailwind builds classes from go in `@theme`. Without it everything is in `:root`.
  tailwind: boolean;
  // The selector each theme's values are written under (the first theme of a set is its base, written to `:root` / `@theme`).
  selectors: Record<string, string>;
  sets: { name: string; key: string; description?: string; themes: { key: string; name: string }[] }[];
}

export type DtcgFiles = Record<string, string>;

export interface Skipped { name: string; reason: string }
