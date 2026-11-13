import { analyze } from "../edit/element";
import { groupById } from "../edit/classes";
import { choicesFor, type TokenIndex } from "../edit/tokens";
import { elementTree } from "../edit/tree";
import type { LibraryComponent } from "../preview/library";
import { flattenTree, signatureOf, type ElementRef } from "./proposal";

// What the assistant is told about the project, so what it suggests is made of the repository's own tokens and
// of elements that are there. Source text and labels are data for it to read; the prompt says so.

export const MAX_ELEMENTS = 60;

// The repository's tokens by what they are, each with what it is worth in the theme that is showing.
export function describeTokens(index: TokenIndex, theme: string) {
  const list = (groupId: string) => choicesFor(groupById(groupId), index, theme).tokens.map((c) => (c.hint ? `${c.value}: ${c.hint}` : c.value));
  return {
    color: list("bg"),
    radius: list("radius"),
    shadow: list("shadow"),
    textSize: list("text-size"),
    font: list("font-family"),
    spacing: list("p"),
    spacingStep: `${index.spacingStep}px`,
  };
}

export interface ComponentBasis {
  componentId: string;
  // The repository and branch the component was read from.
  scope: string;
  file: string;
  signature: string;
  elements: ElementRef[];
}

export interface ChatContext {
  context: Record<string, unknown>;
  basis: ComponentBasis | null;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export async function componentContext(input: {
  component: LibraryComponent;
  scope: string;
  code: string;
  index: TokenIndex;
  theme: string;
  // The variant choices showing in the preview, so the classes that are told are the ones on screen.
  values: Record<string, string>;
}): Promise<ChatContext> {
  const { component, code, index, theme, values } = input;
  const tree = await elementTree(component.file, code, component.exported === "default" ? "default" : component.name);
  const elements = flattenTree(tree);
  const labels = new Map<number, string>();
  const described = [];
  for (const el of elements.slice(0, MAX_ELEMENTS)) {
    const info = el.selectable ? await analyze(component.file, code, el.start, values).catch(() => null) : null;
    if (info?.text) labels.set(el.index, info.text.value);
    described.push({
      id: el.index,
      parent: el.parent,
      tag: el.tag,
      ...(info?.text ? { text: clip(info.text.value, 80) } : {}),
      ...(info ? { classes: clip(info.classes, 300) } : {}),
      editable: !!info && info.className !== "dynamic",
    });
  }
  return {
    context: {
      component: {
        name: component.name,
        file: component.file,
        props: component.props.map((p) => ({ name: p.name, type: clip(p.type, 60), ...(p.options ? { options: p.options } : {}) })),
        variants: component.variants.map((v) => ({ name: v.name, options: v.options, default: v.default })),
        showing: values,
      },
      elements: described,
      ...(elements.length > MAX_ELEMENTS ? { elementsNote: `Only the first ${MAX_ELEMENTS} of ${elements.length} elements are listed` } : {}),
      tokens: describeTokens(index, theme),
    },
    basis: { componentId: component.id, scope: input.scope, file: component.file, signature: signatureOf(elements), elements },
  };
}

export const projectContext = (index: TokenIndex, theme: string): ChatContext => ({ context: { component: null, tokens: describeTokens(index, theme) }, basis: null });
