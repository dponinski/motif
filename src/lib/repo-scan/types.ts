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

export interface RepoToken {
  name: string;
  kind: RepoTokenKind;
  // Value per theme key; "default" is the base theme unless a "light" theme exists.
  values: Record<string, string>;
  // Tailwind name this token is exposed as, e.g. "color-primary" for bg-primary.
  tailwind: string | null;
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

export interface RepoAnalysis {
  repo: string;
  ref: string;
  scannedAt: number;
  stack: RepoStack;
  themes: string[];
  tokens: RepoToken[];
  components: RepoComponent[];
  warnings: string[];
  stats: { filesInRepo: number; filesRead: number; truncated: boolean };
}
