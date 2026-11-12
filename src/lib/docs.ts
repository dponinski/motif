import type { DocBlock, DocPage, RepoRef, TokenKind } from "./motif-document";

export const TOKEN_KINDS: { kind: TokenKind; title: string }[] = [
  { kind: "colors", title: "Colors" },
  { kind: "typography", title: "Typography" },
  { kind: "spacing", title: "Spacing" },
  { kind: "radii", title: "Radius" },
  { kind: "shadows", title: "Shadows" },
];

// Built-in pages use ids derived from what they document, so two people who each start
// editing the same one end up with the same page and their edits merge.
const COMPONENT_PREFIX = "doc-comp-";
const TOKEN_PREFIX = "doc-tokens-";
const REPO_PREFIX = "doc-repo-";

export const componentPageId = (componentId: string) => COMPONENT_PREFIX + componentId;
export const pageComponentId = (pageId: string) =>
  pageId.startsWith(COMPONENT_PREFIX) ? pageId.slice(COMPONENT_PREFIX.length) : null;
export const isBuiltInPage = (pageId: string) =>
  pageId.startsWith(COMPONENT_PREFIX) || pageId.startsWith(TOKEN_PREFIX) || pageId.startsWith(REPO_PREFIX);

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

function componentPage(component: { id: string; name: string }): DocPage {
  return {
    id: componentPageId(component.id),
    title: component.name,
    blocks: [
      { id: "intro", type: "text", text: "" },
      { id: "preview", type: "preview", componentId: component.id },
      { id: "props", type: "props", componentId: component.id },
      { id: "code", type: "code", componentId: component.id },
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

// Every component and token category has a page; a stored page replaces its generated default.
export function docSections(stored: DocPage[], components: { id: string; name: string }[], repo: RepoDocComponent[] = []): DocSection[] {
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
    {
      title: "Components",
      pages: components.map((c) => ({ ...(byId.get(componentPageId(c.id)) ?? componentPage(c)), title: c.name })),
    },
    ...repoSection,
  ];
}

export type BlockType = DocBlock["type"];

export const BLOCK_TYPES: { type: BlockType; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "guideline", label: "Do / Don't" },
  { type: "preview", label: "Component preview" },
  { type: "props", label: "Props table" },
  { type: "code", label: "Usage code" },
  { type: "repo-preview", label: "Repository component preview" },
  { type: "repo-props", label: "Repository component props" },
  { type: "repo-code", label: "Repository component usage" },
  { type: "tokens", label: "Tokens" },
];

export function createBlock(type: BlockType, id: string, componentId: string, ref: RepoRef = { file: "", name: "" }): DocBlock {
  switch (type) {
    case "heading":
    case "text":
      return { id, type, text: "" };
    case "guideline":
      return { id, type, do: "", dont: "" };
    case "tokens":
      return { id, type, kind: "colors" };
    case "preview":
    case "props":
    case "code":
      return { id, type, componentId };
    case "repo-preview":
      return { id, type, ref, view: "single" };
    case "repo-props":
    case "repo-code":
      return { id, type, ref };
  }
}
