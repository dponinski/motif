import type { RepoComponent } from "../repo-scan/types";
import { initialProps } from "../preview/props";
import type { ImportSpec } from "./imports";

export interface Snippet {
  id: string;
  label: string;
  jsx: string;
}

// Starting points for new elements. Classes are Tailwind utilities, which is what the editor edits.
export const SNIPPETS: Snippet[] = [
  { id: "div", label: "Div", jsx: '<div className="flex flex-col gap-2"></div>' },
  { id: "text", label: "Text", jsx: "<span>Text</span>" },
  { id: "heading", label: "Heading", jsx: '<h2 className="text-lg font-semibold">Heading</h2>' },
  { id: "paragraph", label: "Paragraph", jsx: '<p className="text-sm">Paragraph</p>' },
  { id: "button", label: "Button", jsx: '<button type="button">Button</button>' },
  { id: "link", label: "Link", jsx: '<a href="#">Link</a>' },
  { id: "list", label: "List", jsx: '<ul className="flex flex-col gap-1">\n  <li>Item</li>\n  <li>Item</li>\n</ul>' },
];

// A snippet without the Tailwind classes it carries, for a component whose styles are in a stylesheet.
export const plain = (jsx: string) => jsx.replace(/ className="[^"]*"/g, "");

export const WRAPPERS: { id: string; label: string; tag: string; classes: string | null }[] = [
  { id: "div", label: "Div", tag: "div", classes: null },
  { id: "row", label: "Row", tag: "div", classes: "flex items-center gap-2" },
  { id: "column", label: "Column", tag: "div", classes: "flex flex-col gap-2" },
  { id: "section", label: "Section", tag: "section", classes: null },
];

const attr = (name: string, value: unknown): string | null => {
  if (typeof value === "string") return value.includes('"') ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;
  if (typeof value === "boolean") return value ? name : `${name}={false}`;
  if (typeof value === "number") return `${name}={${value}}`;
  return null;
};

// A component as it would first be used: the props it needs, with the same starting values the stage uses.
export function componentSnippet(component: RepoComponent): { jsx: string; imp: ImportSpec } {
  const props = initialProps(component);
  const { children, ...rest } = props;
  const attrs = Object.entries(rest).map(([k, v]) => attr(k, v)).filter((a): a is string => a !== null);
  const open = [component.name, ...attrs].join(" ");
  const jsx = typeof children === "string" && children !== "" ? `<${open}>${children}</${component.name}>` : `<${open} />`;
  return { jsx, imp: { name: component.name, file: component.file, exported: component.exported } };
}
