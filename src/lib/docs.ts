import type { DocBlock, DocPage, RepoRef, TokenKind } from "./motif-document";

export const TOKEN_KINDS: { kind: TokenKind; title: string }[] = [
  { kind: "colors", title: "Colors" },
  { kind: "typography", title: "Typography" },
  { kind: "spacing", title: "Spacing" },
  { kind: "radii", title: "Radius" },
  { kind: "shadows", title: "Shadows" },
];

// Built-in pages use ids derived from what they document, so editing one always edits the same page.
const TOKEN_PREFIX = "doc-tokens-";
const REPO_PREFIX = "doc-repo-";

export const isBuiltInPage = (pageId: string) => pageId.startsWith(TOKEN_PREFIX) || pageId.startsWith(REPO_PREFIX);

// A repository component's page is named after where it is declared, so everyone who documents it edits the same page.
export const repoKey = (ref: RepoRef) => `${ref.file}::${ref.name}`;
// A live preview depends only on the component and what is shown of it, so blocks that show the same share one.
export const previewKey = (ref: RepoRef, view: "single" | "variants") => `${repoKey(ref)}|${view}`;
export const repoPageId = (ref: RepoRef) => REPO_PREFIX + repoKey(ref);
export function pageRepoRef(pageId: string): RepoRef | null {
  if (!pageId.startsWith(REPO_PREFIX)) return null;
  const key = pageId.slice(REPO_PREFIX.length);
  const at = key.lastIndexOf("::");
  return at < 1 ? null : { file: key.slice(0, at), name: key.slice(at + 2) };
}

export interface RepoDocComponent extends RepoRef {
  hasVariants: boolean;
}

function repoPage(c: RepoDocComponent): DocPage {
  const ref = { file: c.file, name: c.name };
  return {
    id: repoPageId(ref),
    title: c.name,
    blocks: [
      { id: "intro", type: "text", text: "" },
      { id: "preview", type: "repo-preview", ref, view: c.hasVariants ? "variants" : "single" },
      { id: "props", type: "repo-props", ref },
      { id: "code", type: "repo-code", ref },
    ],
  };
}

function tokenPage(kind: TokenKind, title: string): DocPage {
  return {
    id: TOKEN_PREFIX + kind,
    title,
    blocks: [
      { id: "intro", type: "text", text: "" },
      { id: "tokens", type: "tokens", kind },
    ],
  };
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

// Every token category and every repository component has a page; a stored page replaces its generated default.
export function docSections(stored: DocPage[], repo: RepoDocComponent[] = []): DocSection[] {
  const byId = new Map(stored.map((p) => [p.id, p]));
  const repoSection: DocSection[] = repo.length
    ? [{ title: "Repository components", pages: repo.map((c) => ({ ...(byId.get(repoPageId(c)) ?? repoPage(c)), title: c.name })) }]
    : [];
  return [
    { title: "Pages", pages: stored.filter((p) => !isBuiltInPage(p.id)) },
    {
      title: "Foundations",
      pages: TOKEN_KINDS.map(({ kind, title }) => byId.get(TOKEN_PREFIX + kind) ?? tokenPage(kind, title)),
    },
    ...repoSection,
  ];
}

export type BlockType = DocBlock["type"];

export const BLOCK_TYPES: { type: BlockType; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "guideline", label: "Do / Don't" },
  { type: "repo-preview", label: "Component preview" },
  { type: "repo-props", label: "Component props" },
  { type: "repo-code", label: "Component usage" },
  { type: "tokens", label: "Tokens" },
];

export function createBlock(type: BlockType, id: string, ref: RepoRef = { file: "", name: "" }): DocBlock {
  switch (type) {
    case "heading":
    case "text":
      return { id, type, text: "" };
    case "guideline":
      return { id, type, do: "", dont: "" };
    case "tokens":
      return { id, type, kind: "colors" };
    case "repo-preview":
      return { id, type, ref, view: "single" };
    case "repo-props":
    case "repo-code":
      return { id, type, ref };
  }
}
