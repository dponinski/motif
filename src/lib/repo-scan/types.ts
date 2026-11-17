// What reading a repository produces. Plain data, so it can be stored, tested and rendered as is.

export interface RepoSource {
  listFiles(): Promise<{ paths: string[]; truncated: boolean }>;
  readText(path: string): Promise<string | null>;
}

export type StylingSystem =
  | "tailwind"
  | "css-modules"
  | "styled-components"
  | "emotion"
  | "sass"
  | "vanilla-extract"
  | "plain-css";

export interface RepoStack {
  framework: { name: string; version: string | null } | null;
  // Only React-based repositories are understood so far.
  supported: boolean;
  typescript: boolean;
  bundler: string | null;
  styling: { primary: StylingSystem | null; evidence: string[] };
  tailwindVersion: 3 | 4 | null;
  variantHelper: "cva" | "tailwind-variants" | null;
  packages: string[];
  entryFiles: string[];
}

export type RepoTokenKind = "color" | "radius" | "shadow" | "font" | "spacing" | "other";

// css-var: a custom property in a rule; theme: a Tailwind v4 @theme entry; config: Tailwind v3 config; json: a token file.
export type TokenContainer = "css-var" | "theme" | "config" | "json";

export interface TokenLocation {
  file: string;
  line: number;
  container: TokenContainer;
  // A Tailwind 3 config value that is a plain literal: the keys from `theme` (or from `theme.extend`) to it, so it can be found and
  // changed in place. Absent when the value is computed (a const, a concatenation), which Motif doesn't change.
  path?: string[];
  inExtend?: boolean;
  // A custom property in a rule: the rule's selector as written, and the at-rule it is inside of (`media`, `layer`, …) when there is one.
  selector?: string;
  within?: string;
}

export interface RepoToken {
  name: string;
  kind: RepoTokenKind;
  // Value per theme key; "default" is the base theme unless a "light" theme exists.
  values: Record<string, string>;
  // Where each theme's value is written, to change it in place.
  locations: Record<string, TokenLocation>;
  // Tailwind name this token is exposed as, e.g. "color-primary" for bg-primary.
  tailwind: string | null;
  // A color kept as bare channels in a CSS variable (`--primary: 222.2 47.4% 11.2%`) that a Tailwind 3 config wraps as
  // `hsl(var(--primary))`: the function it is wrapped in. `values` are the channels as written.
  channels?: "hsl" | "rgb";
  // Where a Tailwind 3 config gives such a variable its class (`colors.primary.DEFAULT`), for renaming it.
  mapping?: TokenLocation;
  file: string;
  line: number;
}

export type Support = "editable" | "partial" | "view-only";

export interface RepoProp {
  name: string;
  type: string;
  required: boolean;
  default: string | null;
  description: string | null;
  options: string[] | null;
}

export interface RepoVariant {
  name: string;
  options: string[];
  default: string | null;
  source: "cva" | "union" | "lookup";
}

export interface RepoComponent {
  name: string;
  file: string;
  line: number;
  exported: "named" | "default";
  // null when the repo has no entry file to tell by.
  public: boolean | null;
  root: string | null;
  props: RepoProp[];
  nativeProps: string | null;
  variants: RepoVariant[];
  hooks: string[];
  support: { level: Support; reasons: string[] };
  notes: string[];
}

// Where a token is used in the repository: how many times, and in which files (the ones that use it most first).
export interface TokenUse {
  n: number;
  files: string[];
}

export interface RepoAnalysis {
  repo: string;
  ref: string;
  scannedAt: number;
  stack: RepoStack;
  themes: string[];
  tokens: RepoToken[];
  // By token name. Absent in a scan that only read tokens, and in one made before this was counted; a token that is not in it is unused.
  tokenUsage?: Record<string, TokenUse>;
  components: RepoComponent[];
  // Stylesheets that were read, and the one that imports Tailwind (where a new tokens file would be imported).
  styleFiles: string[];
  tailwindEntry: string | null;
  warnings: string[];
  stats: { filesInRepo: number; filesRead: number; truncated: boolean };
}
