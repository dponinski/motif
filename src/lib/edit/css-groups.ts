import { groupById, type ClassGroup, type TokenRole } from "./classes";
import { splitOpacity, type TokenIndex } from "./tokens";

// The inspector's groups (gap, padding, background, ...) as CSS: which properties each is, and how a value in the
// inspector's terms (a token's name, a keyword, `[16px]` for a value written out) goes to and from what the stylesheet
// says. The groups keep their ids, labels and sections, so the same controls drive a stylesheet as drive classes.

export type CssNames = Record<TokenRole, ReadonlySet<string>>;

export const cssNames = (index: TokenIndex): CssNames => {
  const of = (role: TokenRole) => new Set(index.byRole[role].map((c) => c.value));
  return { color: of("color"), spacing: of("spacing"), radius: of("radius"), shadow: of("shadow"), text: of("text"), font: of("font") };
};

export type CssChange = [prop: string, value: string | null, ifAbsent?: "ifAbsent"];

export interface CssGroup extends ClassGroup {
  props: string[];
  // What a new value starts as, when the group is added.
  start: string;
  fromCss(decls: Record<string, string>, names: CssNames): string | null;
  toCss(value: string, names: CssNames): CssChange[];
}

const VAR = /^var\(\s*--([\w-]+)\s*\)$/;
const arbitrary = (v: string) => `[${v.trim().replace(/\s+/g, "_")}]`;
const unwrap = (field: string) => field.slice(1, -1).replace(/_/g, " ");
const isArbitrary = (field: string) => /^\[.*\]$/.test(field);

// A value of a group that takes tokens: a token's name, one of the group's keywords, or a value written out.
function read(role: TokenRole | undefined, css: string, names: CssNames, options: string[], keywords: Record<string, string>): string {
  const t = css.trim();
  const v = t.match(VAR);
  if (v) return role && names[role].has(v[1]) ? v[1] : arbitrary(t);
  if (t === "0px" || t === "0") return options.includes("0") ? "0" : arbitrary(t);
  const keyword = Object.entries(keywords).find(([, c]) => c === t);
  if (keyword) return keyword[0];
  return options.includes(t) ? t : arbitrary(t);
}

function write(role: TokenRole | undefined, field: string, names: CssNames, keywords: Record<string, string>): string {
  if (role && names[role].has(field)) return `var(--${field})`;
  if (isArbitrary(field)) return unwrap(field);
  return keywords[field] ?? field;
}

function make(id: string, props: string[], role: TokenRole | undefined, options: string[] | null, start: string, keywords: Record<string, string> = {}, extra: Partial<CssGroup> = {}): CssGroup {
  const base = groupById(id);
  const prop = props[0];
  return {
    id, label: base.label, section: base.section, options, control: "select", role,
    read: () => null, write: (v) => v,
    props, start,
    fromCss: (decls, names) => (decls[prop] === undefined ? null : read(role, decls[prop], names, options ?? [], keywords)),
    toCss: (value, names) => [[prop, write(role, value, names, keywords)]],
    ...extra,
  };
}

const PX = ["0", "2px", "4px", "6px", "8px", "12px", "16px", "20px", "24px", "32px", "40px", "48px", "64px"];
const PX_AUTO = [...PX, "auto"];
const space = (id: string, prop: string, auto = false): CssGroup => make(id, [prop], "spacing", auto ? PX_AUTO : PX, auto ? "0" : "16px");

const color = (id: string, prop: string, start: string): CssGroup => {
  const base = groupById(id);
  const fromColor = (css: string, names: CssNames): string => {
    const t = css.trim();
    const v = t.match(VAR);
    if (v) return names.color.has(v[1]) ? v[1] : arbitrary(t);
    const mix = t.match(/^color-mix\(\s*in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/);
    if (mix) return `${fromColor(mix[1], names)}/${mix[2]}`;
    if (/^currentcolor$/i.test(t)) return "current";
    return ["transparent", "white", "black", "inherit"].includes(t) ? t : arbitrary(t);
  };
  const toColor = (field: string, names: CssNames): string => {
    if (names.color.has(field)) return `var(--${field})`;
    if (isArbitrary(field)) return unwrap(field);
    return field === "current" ? "currentColor" : field;
  };
  return {
    id, label: base.label, section: base.section, options: null, control: "color", role: "color",
    read: () => null, write: (v) => v,
    props: [prop], start,
    fromCss: (decls, names) => (decls[prop] === undefined ? null : fromColor(decls[prop], names)),
    toCss: (value, names) => {
      const { color: c, opacity } = splitOpacity(value);
      const base = toColor(c, names);
      return [[prop, opacity && opacity !== "100" ? `color-mix(in srgb, ${base} ${opacity}%, transparent)` : base]];
    },
  };
};

const WEIGHTS: Record<string, string> = { thin: "100", extralight: "200", light: "300", normal: "400", medium: "500", semibold: "600", bold: "700", extrabold: "800", black: "900" };
const SHADOWS: Record<string, string> = {
  sm: "0 1px 2px 0 rgba(0, 0, 0, 0.08)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.12)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.15)",
};

export const CSS_GROUPS: CssGroup[] = [
  make("display", ["display"], undefined, ["block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid", "hidden", "contents"], "flex", { hidden: "none" }),
  make("direction", ["flex-direction"], undefined, ["row", "col", "row-reverse", "col-reverse"], "column", { col: "column", "col-reverse": "column-reverse" }, { start: "col" }),
  make("wrap", ["flex-wrap"], undefined, ["wrap", "nowrap", "wrap-reverse"], "wrap"),
  make("justify", ["justify-content"], undefined, ["start", "center", "end", "between", "around", "evenly", "stretch"], "center", { start: "flex-start", end: "flex-end", between: "space-between", around: "space-around", evenly: "space-evenly" }, { start: "center" }),
  make("items", ["align-items"], undefined, ["start", "center", "end", "stretch", "baseline"], "center", { start: "flex-start", end: "flex-end" }, { start: "center" }),
  space("gap", "gap"), space("gap-x", "column-gap"), space("gap-y", "row-gap"),
  space("p", "padding"), space("px", "padding-inline"), space("py", "padding-block"),
  space("pt", "padding-top"), space("pr", "padding-right"), space("pb", "padding-bottom"), space("pl", "padding-left"),
  space("m", "margin", true), space("mx", "margin-inline", true), space("my", "margin-block", true),
  space("mt", "margin-top", true), space("mr", "margin-right", true), space("mb", "margin-bottom", true), space("ml", "margin-left", true),
  make("w", ["width"], "spacing", ["auto", "full", "fit", "64px", "128px", "256px", "320px", "480px", "640px"], "full", { full: "100%", fit: "fit-content" }),
  make("h", ["height"], "spacing", ["auto", "full", "fit", "32px", "64px", "128px", "256px", "320px", "480px"], "full", { full: "100%", fit: "fit-content" }),
  make("max-w", ["max-width"], undefined, ["none", "full", "320px", "480px", "640px", "768px", "1024px", "1280px"], "640px", { full: "100%" }),
  make("text-size", ["font-size"], "text", ["12px", "14px", "16px", "18px", "20px", "24px", "30px", "36px", "48px"], "16px"),
  make("font-weight", ["font-weight"], undefined, Object.keys(WEIGHTS), "medium", WEIGHTS, { start: "medium" }),
  make("font-family", ["font-family"], "font", ["sans", "serif", "mono"], "sans", { sans: "sans-serif", mono: "monospace" }),
  make("text-align", ["text-align"], undefined, ["left", "center", "right", "justify", "start", "end"], "center"),
  color("text-color", "color", "current"),
  color("bg", "background-color", "transparent"),
  {
    ...make("border-width", ["border-width"], undefined, ["0", "1", "2", "4", "8"], "1"),
    // A border needs a style to show; one that is already there is kept.
    fromCss: (decls) => {
      const v = decls["border-width"]?.trim();
      if (v === undefined) return null;
      const n = v.match(/^(\d+)(px)?$/)?.[1];
      return n !== undefined && ["0", "1", "2", "4", "8"].includes(n) ? n : arbitrary(v);
    },
    toCss: (value, names) => {
      const css = isArbitrary(value) ? unwrap(value) : `${value}px`;
      void names;
      return value === "0" ? [["border-width", "0"]] : [["border-width", css], ["border-style", "solid", "ifAbsent"]];
    },
  },
  color("border-color", "border-color", "current"),
  make("radius", ["border-radius"], "radius", ["0", "2px", "4px", "6px", "8px", "12px", "16px", "full"], "8px", { full: "9999px" }),
  {
    ...make("shadow", ["box-shadow"], "shadow", ["none", ...Object.keys(SHADOWS)], "md", {}),
    fromCss: (decls, names) => {
      const t = decls["box-shadow"]?.trim();
      if (t === undefined) return null;
      if (t === "none") return "none";
      const v = t.match(VAR);
      if (v) return names.shadow.has(v[1]) ? v[1] : arbitrary(t);
      const preset = Object.entries(SHADOWS).find(([, css]) => css === t);
      return preset ? preset[0] : arbitrary(t);
    },
    toCss: (value, names) => [["box-shadow", names.shadow.has(value) ? `var(--${value})` : isArbitrary(value) ? unwrap(value) : SHADOWS[value] ?? value]],
  },
  {
    ...make("opacity", ["opacity"], undefined, ["0", "5", "10", "20", "25", "30", "40", "50", "60", "70", "75", "80", "90", "95", "100"], "50"),
    fromCss: (decls) => {
      const n = Number(decls.opacity);
      if (decls.opacity === undefined) return null;
      const pct = Math.round(n * 100);
      return Number.isFinite(n) && ["0", "5", "10", "20", "25", "30", "40", "50", "60", "70", "75", "80", "90", "95", "100"].includes(String(pct)) ? String(pct) : arbitrary(decls.opacity);
    },
    toCss: (value) => [["opacity", isArbitrary(value) ? unwrap(value) : String(Number(value) / 100)]],
  },
];

export const cssGroupById = (id: string): CssGroup => {
  const g = CSS_GROUPS.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown style group ${id}`);
  return g;
};

// The value a group has in a rule's declarations, in the inspector's terms.
export const readCssGroup = (decls: Record<string, string>, group: CssGroup, names: CssNames): string | null => group.fromCss(decls, names);
