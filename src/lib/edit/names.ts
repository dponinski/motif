// What a designer calls an element: `h2` is a Heading, `div` a Box, `button` a Button. The layers and the element row show these
// first, with the tag as a quiet second label for those who know it.

export type ElementIconName = "box" | "heading" | "text" | "link" | "button" | "image" | "field" | "list" | "list-item" | "section" | "divider" | "table" | "component";

export interface Described {
  kind: string;
  icon: ElementIconName;
}

const KINDS: Record<string, Described> = {
  h1: { kind: "Heading", icon: "heading" }, h2: { kind: "Heading", icon: "heading" }, h3: { kind: "Heading", icon: "heading" },
  h4: { kind: "Heading", icon: "heading" }, h5: { kind: "Heading", icon: "heading" }, h6: { kind: "Heading", icon: "heading" },
  p: { kind: "Text", icon: "text" }, span: { kind: "Text", icon: "text" }, small: { kind: "Text", icon: "text" }, strong: { kind: "Text", icon: "text" },
  em: { kind: "Text", icon: "text" }, label: { kind: "Label", icon: "text" }, blockquote: { kind: "Quote", icon: "text" }, code: { kind: "Code", icon: "text" }, pre: { kind: "Code", icon: "text" },
  a: { kind: "Link", icon: "link" },
  button: { kind: "Button", icon: "button" },
  img: { kind: "Image", icon: "image" }, svg: { kind: "Icon", icon: "image" }, picture: { kind: "Image", icon: "image" }, video: { kind: "Video", icon: "image" },
  input: { kind: "Field", icon: "field" }, textarea: { kind: "Field", icon: "field" }, select: { kind: "Field", icon: "field" },
  ul: { kind: "List", icon: "list" }, ol: { kind: "List", icon: "list" }, li: { kind: "List item", icon: "list-item" },
  section: { kind: "Section", icon: "section" }, article: { kind: "Section", icon: "section" }, aside: { kind: "Aside", icon: "section" },
  header: { kind: "Header", icon: "section" }, footer: { kind: "Footer", icon: "section" }, main: { kind: "Main", icon: "section" }, nav: { kind: "Navigation", icon: "section" },
  form: { kind: "Form", icon: "section" }, fieldset: { kind: "Group", icon: "section" }, figure: { kind: "Figure", icon: "image" },
  hr: { kind: "Divider", icon: "divider" },
  table: { kind: "Table", icon: "table" }, tr: { kind: "Row", icon: "table" }, td: { kind: "Cell", icon: "table" }, th: { kind: "Cell", icon: "table" },
  div: { kind: "Box", icon: "box" },
};

// A component (`<Button />`, `<Dialog.Title>`) keeps its own name.
export function describeTag(tag: string): Described {
  if (/^[A-Z]/.test(tag) || tag.includes(".")) return { kind: tag, icon: "component" };
  return KINDS[tag] ?? { kind: tag, icon: "box" };
}

// The name for an element with what it says: "Heading · Hello".
export function elementName(tag: string, text: string | null | undefined, max = 24): string {
  const { kind } = describeTag(tag);
  const said = (text ?? "").replace(/\s+/g, " ").trim();
  if (!said) return kind;
  return `${kind} · ${said.length > max ? `${said.slice(0, max - 1)}…` : said}`;
}
