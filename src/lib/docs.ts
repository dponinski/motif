import type { DocBlock, DocPage, TokenKind } from "./motif-document";

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

export const componentPageId = (componentId: string) => COMPONENT_PREFIX + componentId;
export const pageComponentId = (pageId: string) =>
  pageId.startsWith(COMPONENT_PREFIX) ? pageId.slice(COMPONENT_PREFIX.length) : null;
export const isBuiltInPage = (pageId: string) =>
  pageId.startsWith(COMPONENT_PREFIX) || pageId.startsWith(TOKEN_PREFIX);

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
export function docSections(stored: DocPage[], components: { id: string; name: string }[]): DocSection[] {
  const byId = new Map(stored.map((p) => [p.id, p]));
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
  { type: "tokens", label: "Tokens" },
];

export function createBlock(type: BlockType, id: string, componentId: string): DocBlock {
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
  }
}
