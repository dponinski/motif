// Tailwind utilities as groups a control can read and write: "gap", "padding-x", "background", and so on.
// Only plain utilities are touched. A class with a modifier (hover:, md:, dark:) or `!` belongs to a state
// or breakpoint the controls don't show, so it is left exactly as written.

export type Section = "layout" | "spacing" | "size" | "type" | "fill";

// What kind of design token a group's value can be: `bg-primary` is a color token, `rounded-card` a radius token.
export type TokenRole = "color" | "spacing" | "radius" | "shadow" | "text" | "font";

// The repository's own token names, by what they are. Some utilities share a prefix (`text-lg` is a size and
// `text-primary` a color, `shadow-card` a shadow and `shadow-primary` the color of one), and only the names
// tell them apart. Without any, the names Tailwind ships with are all that is known.
export interface TokenNames {
  color: ReadonlySet<string>;
  text: ReadonlySet<string>;
  shadow: ReadonlySet<string>;
  font: ReadonlySet<string>;
}

export const NO_NAMES: TokenNames = { color: new Set(), text: new Set(), shadow: new Set(), font: new Set() };

export interface ClassGroup {
  id: string;
  label: string;
  section: Section;
  // What the control offers; null for a free value such as a color.
  options: string[] | null;
  control: "select" | "color";
  // The kind of token its values can be, for the groups that take tokens.
  role?: TokenRole;
  // The value a class carries in this group, or null when it is not one.
  read(utility: string, names: TokenNames): string | null;
  write(value: string): string;
}

export const SCALE = ["0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16", "20", "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96"];
const FRACTIONS = ["1/2", "1/3", "2/3", "1/4", "3/4", "1/5", "2/5", "3/5", "4/5"];
const SIZES = ["auto", "full", "screen", "fit", "min", "max", ...FRACTIONS];
const TEXT_SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];
const TEXT_ALIGN = ["left", "center", "right", "justify", "start", "end"];
const TEXT_OTHER = ["wrap", "nowrap", "balance", "pretty", "ellipsis", "clip", "inherit", "current", "transparent"];

const FAMILIES = ["sans", "serif", "mono"];
const ROUNDED_SIDE = /^(?:[trblse]|tl|tr|bl|br|ss|se|es|ee)(?:-|$)/;
// The colors Tailwind ships with, and the words that are colors everywhere: `red-500`, `white`, `current`.
export const PALETTE_COLOR = /^(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white|transparent|inherit|current)(-|\/|$)/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function fixed(id: string, label: string, section: Section, prefix: string, values: string[], unprefixed: string[] = []): ClassGroup {
  const re = new RegExp(`^${escape(prefix)}-(${values.map(escape).join("|")})$`);
  return {
    id, label, section, options: [...values], control: "select",
    read: (u) => (unprefixed.includes(u) ? u : u.match(re)?.[1] ?? null),
    write: (v) => (unprefixed.includes(v) ? v : `${prefix}-${v}`),
  };
}

// A value out of a scale, or anything else after the prefix (`p-[18px]`).
function scaled(id: string, label: string, section: Section, prefix: string, options: string[], exclude: RegExp | null = null, role: TokenRole | undefined = "spacing"): ClassGroup {
  return {
    id, label, section, options, control: "select", role,
    read: (u) => {
      if (!u.startsWith(`${prefix}-`)) return null;
      const value = u.slice(prefix.length + 1);
      return value && !(exclude && exclude.test(value)) ? value : null;
    },
    write: (v) => `${prefix}-${v}`,
  };
}

const SPACE = [...SCALE];
const SPACE_AUTO = [...SCALE, "auto"];

const display = ["block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid", "hidden", "contents"];

// Words after `bg-` and `border-` that are not colors. Matched whole, so a token called `border` is still a color.
const NOT_COLOR_BG = /^(?:cover|contain|auto|center|top|bottom|left|right|no-repeat|repeat|fixed|local|scroll|none)$|^(?:clip-|origin-|gradient-|linear-|radial-|conic-|blend-|repeat-|top-|bottom-|left-|right-)|^\[(?:url|length|position|image)/;
const NOT_COLOR_BORDER = /^(?:0|2|4|8|[xytrblse]|solid|dashed|dotted|double|none|hidden|collapse|separate|spacing)$|^[xytrblse]-|^\[(?:length|\d)/;

function colored(id: string, label: string, prefix: string, notColor: RegExp): ClassGroup {
  return {
    id, label, section: "fill", options: null, control: "color", role: "color",
    read: (u) => {
      if (!u.startsWith(`${prefix}-`)) return null;
      const value = u.slice(prefix.length + 1);
      return value && !notColor.test(value) ? value : null;
    },
    write: (v) => `${prefix}-${v}`,
  };
}

export const GROUPS: ClassGroup[] = [
  // Layout
  { id: "display", label: "Display", section: "layout", options: display, control: "select", read: (u) => (display.includes(u) ? u : null), write: (v) => v },
  fixed("direction", "Direction", "layout", "flex", ["row", "col", "row-reverse", "col-reverse"]),
  fixed("wrap", "Wrap", "layout", "flex", ["wrap", "nowrap", "wrap-reverse"]),
  fixed("justify", "Justify", "layout", "justify", ["start", "center", "end", "between", "around", "evenly", "stretch"]),
  fixed("items", "Align", "layout", "items", ["start", "center", "end", "stretch", "baseline"]),
  scaled("gap", "Gap", "layout", "gap", SPACE, /^[xy]-/),
  scaled("gap-x", "Column gap", "layout", "gap-x", SPACE),
  scaled("gap-y", "Row gap", "layout", "gap-y", SPACE),
  // Spacing
  scaled("p", "Padding", "spacing", "p", SPACE),
  scaled("px", "Padding X", "spacing", "px", SPACE),
  scaled("py", "Padding Y", "spacing", "py", SPACE),
  scaled("pt", "Padding top", "spacing", "pt", SPACE),
  scaled("pr", "Padding right", "spacing", "pr", SPACE),
  scaled("pb", "Padding bottom", "spacing", "pb", SPACE),
  scaled("pl", "Padding left", "spacing", "pl", SPACE),
  scaled("m", "Margin", "spacing", "m", SPACE_AUTO),
  scaled("mx", "Margin X", "spacing", "mx", SPACE_AUTO),
  scaled("my", "Margin Y", "spacing", "my", SPACE_AUTO),
  scaled("mt", "Margin top", "spacing", "mt", SPACE_AUTO),
  scaled("mr", "Margin right", "spacing", "mr", SPACE_AUTO),
  scaled("mb", "Margin bottom", "spacing", "mb", SPACE_AUTO),
  scaled("ml", "Margin left", "spacing", "ml", SPACE_AUTO),
  // Size
  scaled("w", "Width", "size", "w", [...SPACE, ...SIZES]),
  scaled("h", "Height", "size", "h", [...SPACE, ...SIZES]),
  scaled("max-w", "Max width", "size", "max-w", ["none", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "full", "prose", "screen-sm", "screen-md", "screen-lg"], null, undefined),
  // Type
  {
    id: "text-size", label: "Text size", section: "type", options: TEXT_SIZES, control: "select", role: "text",
    read: (u, names) => {
      const m = u.match(/^text-(.+)$/)?.[1];
      return m && (TEXT_SIZES.includes(m) || /^\[\d/.test(m) || names.text.has(m)) ? m : null;
    },
    write: (v) => `text-${v}`,
  },
  fixed("font-weight", "Weight", "type", "font", ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"]),
  {
    id: "font-family", label: "Font", section: "type", options: FAMILIES, control: "select", role: "font",
    read: (u, names) => {
      const m = u.match(/^font-(.+)$/)?.[1];
      return m && (FAMILIES.includes(m) || names.font.has(m)) ? m : null;
    },
    write: (v) => `font-${v}`,
  },
  {
    id: "text-align", label: "Text align", section: "type", options: TEXT_ALIGN, control: "select",
    read: (u) => {
      const m = u.match(/^text-(.+)$/)?.[1];
      return m && TEXT_ALIGN.includes(m) ? m : null;
    },
    write: (v) => `text-${v}`,
  },
  {
    id: "text-color", label: "Text color", section: "type", options: null, control: "color", role: "color",
    read: (u, names) => {
      const m = u.match(/^text-(.+)$/)?.[1];
      return m && !TEXT_SIZES.includes(m) && !TEXT_ALIGN.includes(m) && !/^\[\d/.test(m) && !names.text.has(m) && !["wrap", "nowrap", "balance", "pretty", "ellipsis", "clip"].includes(m) ? m : null;
    },
    write: (v) => `text-${v}`,
  },
  // Fill and border
  colored("bg", "Background", "bg", NOT_COLOR_BG),
  {
    id: "border-width", label: "Border", section: "fill", options: ["0", "1", "2", "4", "8"], control: "select",
    read: (u) => (u === "border" ? "1" : u.match(/^border-(0|2|4|8)$/)?.[1] ?? null),
    write: (v) => (v === "1" ? "border" : `border-${v}`),
  },
  colored("border-color", "Border color", "border", NOT_COLOR_BORDER),
  {
    id: "radius", label: "Radius", section: "fill", options: ["none", "xs", "sm", "DEFAULT", "md", "lg", "xl", "2xl", "3xl", "full"], control: "select", role: "radius",
    read: (u) => {
      if (u === "rounded") return "DEFAULT";
      const m = u.match(/^rounded-(.+)$/)?.[1];
      // `rounded-t-lg` and the like round some corners only, which is not this group. Anything else is a
      // radius: one of Tailwind's, one of the repository's own (`rounded-card`), or a value (`rounded-[10px]`).
      return m && !ROUNDED_SIDE.test(m) ? m : null;
    },
    write: (v) => (v === "DEFAULT" ? "rounded" : `rounded-${v}`),
  },
  {
    id: "shadow", label: "Shadow", section: "fill", options: ["none", "2xs", "xs", "sm", "DEFAULT", "md", "lg", "xl", "2xl"], control: "select", role: "shadow",
    read: (u, names) => {
      if (u === "shadow") return "DEFAULT";
      const m = u.match(/^shadow-(.+)$/)?.[1];
      if (!m) return null;
      if (names.shadow.has(m)) return m;
      // `shadow-red-500` and `shadow-primary/40` color a shadow, which belongs to no group here.
      return PALETTE_COLOR.test(m) || names.color.has(m.split("/")[0]) ? null : m;
    },
    write: (v) => (v === "DEFAULT" ? "shadow" : `shadow-${v}`),
  },
  fixed("opacity", "Opacity", "fill", "opacity", ["0", "5", "10", "20", "25", "30", "40", "50", "60", "70", "75", "80", "90", "95", "100"]),
];

export const groupById = (id: string): ClassGroup => {
  const g = GROUPS.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown class group ${id}`);
  return g;
};

export const SECTIONS: { id: Section; label: string }[] = [
  { id: "layout", label: "Layout" },
  { id: "spacing", label: "Spacing" },
  { id: "size", label: "Size" },
  { id: "type", label: "Type" },
  { id: "fill", label: "Fill and border" },
];

export interface ClassToken {
  text: string;
  start: number;
  end: number;
  // What comes before the utility: "" for a plain class, "hover:", "md:", "dark:hover:", ...
  modifier: string;
  // The class without its modifiers, or null when it isn't a plain utility (`!p-2`, `-mt-2`).
  utility: string | null;
}

// Splits at the last colon that isn't inside brackets or parentheses, so `bg-[url(a:b)]` has no modifier.
function splitModifier(word: string): { modifier: string; utility: string } {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) cut = i;
  }
  return { modifier: word.slice(0, cut + 1), utility: word.slice(cut + 1) };
}

export function tokenize(text: string): ClassToken[] {
  const out: ClassToken[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const word = m[0];
    const { modifier, utility } = splitModifier(word);
    const plain = !utility.startsWith("!") && !utility.endsWith("!") && !utility.startsWith("-") && utility !== "";
    out.push({ text: word, start: m.index!, end: m.index! + word.length, modifier, utility: plain ? utility : null });
  }
  return out;
}

// The modifiers the inspector offers, in the order a designer thinks of them.
export const MODIFIERS: { id: string; label: string; hint: string | null }[] = [
  { id: "", label: "Default", hint: null },
  { id: "hover:", label: "Hover", hint: "Hover the element in the preview to see this." },
  { id: "focus:", label: "Focus", hint: "Focus can't be forced in a browser; the classes are edited but not shown." },
  { id: "active:", label: "Active", hint: "Pressed state; the classes are edited but not shown." },
  { id: "disabled:", label: "Disabled", hint: "Applies while the element is disabled." },
  { id: "dark:", label: "Dark", hint: "Shown with the dark theme." },
  { id: "sm:", label: "sm (640px)", hint: "Shown when the preview is at least this wide." },
  { id: "md:", label: "md (768px)", hint: "Shown when the preview is at least this wide." },
  { id: "lg:", label: "lg (1024px)", hint: "Shown when the preview is at least this wide." },
  { id: "xl:", label: "xl (1280px)", hint: "Shown when the preview is at least this wide." },
];

// The preview width that shows a breakpoint, in px.
export const BREAKPOINT_WIDTH: Record<string, number> = { "sm:": 640, "md:": 768, "lg:": 1024, "xl:": 1280 };

const inGroup = (t: ClassToken, group: ClassGroup, modifier: string, names: TokenNames) => t.modifier === modifier && t.utility !== null && group.read(t.utility, names) !== null;

// The value a group has under a modifier ("" for the plain class), or null when it isn't set there.
export function readGroup(text: string, group: ClassGroup, modifier = "", names: TokenNames = NO_NAMES): string | null {
  let found: string | null = null;
  for (const t of tokenize(text)) {
    if (!inGroup(t, group, modifier, names)) continue;
    found = group.read(t.utility!, names);
  }
  return found;
}

export const hasGroup = (text: string, group: ClassGroup, modifier = "", names: TokenNames = NO_NAMES) => tokenize(text).some((t) => inGroup(t, group, modifier, names));

// Sets a group in a class string, keeping every other class and the spacing between them. The new class takes
// the place of the first one it replaces; with none to replace it goes at the end. A null value removes the group.
// Under a modifier only classes with exactly that modifier count, so `hover:bg-x` and `bg-x` are separate.
export function writeGroup(text: string, group: ClassGroup, value: string | null, modifier = "", names: TokenNames = NO_NAMES): string {
  const matches = tokenize(text).filter((t) => inGroup(t, group, modifier, names));
  const next = value === null ? null : `${modifier}${group.write(value)}`;

  if (matches.length === 0) {
    if (next === null) return text;
    if (text.trim() === "") return next;
    return /\s$/.test(text) ? `${text}${next}` : `${text} ${next}`;
  }

  let out = text;
  // From the end, so earlier offsets stay valid.
  for (let i = matches.length - 1; i >= 0; i--) {
    const t = matches[i];
    if (i === 0 && next !== null) {
      out = out.slice(0, t.start) + next + out.slice(t.end);
      continue;
    }
    // Remove the class and one side of whitespace: after it, or before it when it is the last word.
    const after = out.slice(t.end).match(/^\s+/);
    const hasMore = /\S/.test(out.slice(t.end));
    if (after && (hasMore || t.start === 0)) out = out.slice(0, t.start) + out.slice(t.end + after[0].length);
    else {
      const before = out.slice(0, t.start).match(/\s+$/);
      out = out.slice(0, t.start - (before ? before[0].length : 0)) + out.slice(t.end);
    }
  }
  return out;
}
