import postcss, { type AtRule, type ChildNode, type Container, type Root, type Rule } from "postcss";

// Reading and changing the declarations a class has in a stylesheet. Only the rule of that class under one state is
// touched, and what the file has around it (other rules, comments, how it is written) is left as it is.

// What a state is in CSS. The Tailwind-style names are the inspector's own: "hover:" is the Hover state, "md:" a
// width of 768px and up.
interface State {
  selector: (cls: string) => string;
  // For a breakpoint, the width its rule is wrapped in a media query for.
  minWidth: number | null;
}

export const STATES: Record<string, State> = {
  "": { selector: (c) => `.${c}`, minWidth: null },
  "hover:": { selector: (c) => `.${c}:hover`, minWidth: null },
  "focus:": { selector: (c) => `.${c}:focus-visible`, minWidth: null },
  "active:": { selector: (c) => `.${c}:active`, minWidth: null },
  "disabled:": { selector: (c) => `.${c}:disabled`, minWidth: null },
  "dark:": { selector: (c) => `.dark .${c}`, minWidth: null },
  "sm:": { selector: (c) => `.${c}`, minWidth: 640 },
  "md:": { selector: (c) => `.${c}`, minWidth: 768 },
  "lg:": { selector: (c) => `.${c}`, minWidth: 1024 },
  "xl:": { selector: (c) => `.${c}`, minWidth: 1280 },
};

export class CssError extends Error {}

const squash = (s: string) => s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
const mediaParams = (width: number) => `(min-width: ${width}px)`;

function parse(css: string): Root {
  try {
    return postcss.parse(css);
  } catch (err) {
    throw new CssError(`This stylesheet can't be read: ${err instanceof Error ? err.message.split("\n")[0] : "it isn't valid CSS"}`);
  }
}

const isRule = (n: ChildNode): n is Rule => n.type === "rule";
const isAtRule = (n: ChildNode): n is AtRule => n.type === "atrule";

// The container a state's rule lives in: the file, or a min-width media query.
function container(root: Root, state: State): Container | null {
  if (state.minWidth === null) return root;
  const wanted = mediaParams(state.minWidth);
  let found: Container | null = null;
  root.each((n) => { if (isAtRule(n) && n.name === "media" && squash(n.params) === wanted) found = n; });
  return found;
}

function ruleIn(parent: Container, selector: string): Rule | null {
  let found: Rule | null = null;
  parent.each((n) => { if (isRule(n) && squash(n.selector) === selector) found = n; });
  return found;
}

function stateOf(modifier: string): State {
  const state = STATES[modifier];
  if (!state) throw new CssError(`The state ${modifier || "default"} can't be written in CSS`);
  return state;
}

// Whether the file has a rule for this class in the plain state.
export function hasRule(css: string, cls: string): boolean {
  try {
    return ruleIn(parse(css), `.${cls}`) !== null;
  } catch {
    return false;
  }
}

// Every class the stylesheet's selectors name, for choosing one that isn't taken.
export function classesIn(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  return out;
}

// The declarations a class has under a state; the last of a property wins, as it does in a browser.
export function readDeclarations(css: string, cls: string, modifier = ""): Record<string, string> {
  const state = stateOf(modifier);
  const root = parse(css);
  const parent = container(root, state);
  const rule = parent && ruleIn(parent, state.selector(cls));
  const out: Record<string, string> = {};
  rule?.each((n) => { if (n.type === "decl") out[n.prop.toLowerCase()] = n.value.replace(/\s*!important\s*$/i, ""); });
  return out;
}

// What a value may be: one declaration's worth of CSS, with nothing that could end it or start another.
const SAFE = /^[^;{}\\\n\r]*$/;
export const isSafeValue = (value: string) => SAFE.test(value) && !/\/\*|\*\//.test(value);

export type Change = [prop: string, value: string | null, ifAbsent?: "ifAbsent"];

// Applies changes to the class's rule under a state, making the rule when there is none. A null value takes the
// property away, and a rule left with nothing in it goes too.
export function setDeclarations(css: string, cls: string, modifier: string, changes: Change[]): string {
  const state = stateOf(modifier);
  for (const [prop, value] of changes) {
    if (!/^[a-z-]+$/.test(prop)) throw new CssError(`${prop} isn't a CSS property`);
    if (value !== null && !isSafeValue(value)) throw new CssError("That value can't be written into a stylesheet.");
  }
  const root = parse(css);
  const selector = state.selector(cls);

  let parent = container(root, state);
  let rule = parent && ruleIn(parent, selector);
  const wanted = changes.filter(([, value]) => value !== null);

  if (!rule) {
    if (wanted.length === 0) return css;
    if (!parent) {
      // A media query for a width goes after the ones for narrower widths, and after every plain rule.
      const media = postcss.atRule({ name: "media", params: mediaParams(state.minWidth!) });
      // Narrower queries come first: before the first wider one, else after the last of the others.
      let wider: ChildNode | null = null;
      let last: ChildNode | null = null;
      root.each((n) => {
        if (!isAtRule(n) || n.name !== "media") return;
        const width = n.params.match(/min-width:\s*(\d+)px/);
        if (!width) return;
        if (Number(width[1]) > state.minWidth! && !wider) wider = n;
        else if (Number(width[1]) < state.minWidth!) last = n;
      });
      if (wider) (wider as ChildNode).before(media);
      else if (last) (last as ChildNode).after(media);
      else root.append(media);
      parent = media;
    }
    rule = postcss.rule({ selector });
    // Next to the class's plain rule when it has one, so a state sits with what it is a state of; otherwise at the end.
    const plain = state.minWidth === null && modifier !== "" ? ruleIn(root, `.${cls}`) : null;
    if (plain) plain.after(rule);
    else parent.append(rule);
  }

  for (const [prop, value, ifAbsent] of changes) {
    const existing: ChildNode[] = [];
    rule.each((n) => { if (n.type === "decl" && n.prop.toLowerCase() === prop) existing.push(n); });
    if (value === null) { existing.forEach((n) => n.remove()); continue; }
    if (existing.length > 0) {
      if (ifAbsent) continue;
      const last = existing[existing.length - 1];
      if (last.type === "decl") last.value = value;
      existing.slice(0, -1).forEach((n) => n.remove());
    } else {
      rule.append(postcss.decl({ prop, value }));
    }
  }

  // Nothing left in the rule, or in the media query that held it.
  if (rule.nodes.length === 0) {
    const holder = rule.parent;
    rule.remove();
    if (holder && holder.type === "atrule" && holder.nodes.length === 0) holder.remove();
  }
  return root.toString();
}
