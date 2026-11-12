import type { RepoComponent, RepoProp } from "../repo-scan/types";

export type Control =
  | { kind: "select"; options: string[] }
  | { kind: "boolean" }
  | { kind: "text" }
  | { kind: "number" }
  // ReactNode: edited as text.
  | { kind: "node" }
  | { kind: "ignored"; reason: string };

export interface PropControl {
  name: string;
  control: Control;
  required: boolean;
  defaultValue: string | null;
  description: string | null;
}

export type PropValues = Record<string, unknown>;

const NODE = /\b(ReactNode|ReactText|ReactChild|ReactFragment)\b/;
const ELEMENT = /\b(ReactElement|JSX\.Element|ComponentType|ElementType|FC|FunctionComponent)\b/;
const HANDLER_NAME = /^on[A-Z]/;
const OPTIONAL_TAIL = /\s*\|\s*(undefined|null)/g;

export function controlFor(prop: RepoProp): Control {
  if (prop.options) return { kind: "select", options: prop.options };
  if (HANDLER_NAME.test(prop.name) || /=>|^\(|^function\b/.test(prop.type)) return { kind: "ignored", reason: "An event handler; it does nothing in a preview" };
  const type = prop.type.replace(OPTIONAL_TAIL, "").trim();
  if (type === "boolean") return { kind: "boolean" };
  if (type === "string") return { kind: "text" };
  if (type === "number") return { kind: "number" };
  if (NODE.test(type)) return { kind: "node" };
  if (ELEMENT.test(type)) return { kind: "ignored", reason: "Needs an element, which only an example can provide" };
  return { kind: "ignored", reason: `A ${/^\w+$/.test(type) ? type : "complex"} value that can't be edited here` };
}

export function controlsFor(component: RepoComponent): PropControl[] {
  const controls = component.props.map((p): PropControl => ({ name: p.name, control: controlFor(p), required: p.required, defaultValue: p.default, description: p.description }));
  // Content usually arrives through the element's own attributes rather than a declared prop, but it is what people edit most.
  if (!component.props.some((p) => p.name === "children") && acceptsChildren(component)) {
    controls.unshift({ name: "children", control: { kind: "node" }, required: false, defaultValue: null, description: "The content inside the component" });
  }
  return controls;
}

// ── Starting values ───────────────────────────────────────────────────────────

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sampleText(name: string, component: RepoComponent): string {
  if (name === "name") return "Ada Lovelace";
  if (name === "children") return component.name;
  if (/^(description|hint|error|message|helperText|subtitle)$/.test(name)) return "Supporting text";
  if (name === "placeholder") return "Placeholder";
  return capitalize(name);
}

// Components whose root can hold text, and props types that spread onto something that can't.
const CONTAINERS = new Set(["button", "a", "div", "span", "p", "section", "article", "aside", "header", "footer", "main", "nav", "ul", "ol", "li", "label", "blockquote", "pre", "code", "small", "strong", "em", "h1", "h2", "h3", "h4", "h5", "h6"]);
const NOT_CONTAINERS = /^(Input|Textarea|Select|Img|Image|Video|Audio|Canvas|Iframe)/;

function acceptsChildren(component: RepoComponent): boolean {
  const declared = component.props.find((p) => p.name === "children");
  if (declared) return controlFor(declared).kind === "node";
  if (!component.nativeProps || !component.root || !CONTAINERS.has(component.root)) return false;
  const native = component.nativeProps.replace(/^(React\.)?/, "");
  return !NOT_CONTAINERS.test(native);
}

// Enough to render the component the first time it is opened: required props get a sample value and
// components that hold content get their name as text. Everything else is left to the component's own defaults.
export function initialProps(component: RepoComponent): PropValues {
  const values: PropValues = {};
  for (const prop of component.props) {
    if (!prop.required) continue;
    const control = controlFor(prop);
    switch (control.kind) {
      case "select": values[prop.name] = control.options[0]; break;
      case "boolean": values[prop.name] = /^(open|isOpen|visible|show|shown|expanded)$/.test(prop.name); break;
      case "number": values[prop.name] = 1; break;
      case "text":
      case "node": values[prop.name] = sampleText(prop.name, component); break;
    }
  }
  if (!("children" in values) && acceptsChildren(component)) values.children = component.name;
  return values;
}

// ── All variants ──────────────────────────────────────────────────────────────

export interface VariantCombination {
  key: string;
  label: string;
  props: PropValues;
}

export function variantCombinations(component: RepoComponent, base: PropValues, limit = 24): { combinations: VariantCombination[]; total: number } {
  const groups = component.variants;
  if (groups.length === 0) return { combinations: [{ key: "default", label: "default", props: base }], total: 1 };
  const total = groups.reduce((n, g) => n * g.options.length, 1);
  const combinations: VariantCombination[] = [];
  const walk = (index: number, chosen: string[]) => {
    if (combinations.length >= limit) return;
    if (index === groups.length) {
      combinations.push({
        key: chosen.join("/"),
        label: chosen.join(" · "),
        props: { ...base, ...Object.fromEntries(groups.map((g, i) => [g.name, chosen[i]])) },
      });
      return;
    }
    for (const option of groups[index].options) walk(index + 1, [...chosen, option]);
  };
  walk(0, []);
  return { combinations, total };
}
