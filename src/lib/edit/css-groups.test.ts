import { describe, expect, it } from "vitest";
import { CSS_GROUPS, cssGroupById, cssNames, type CssNames } from "./css-groups";
import { GROUPS } from "./classes";
import { buildTokenIndex, choicesFor, isFlagged, statusOf, suggest } from "./tokens";
import type { RepoToken } from "../repo-scan/types";

const token = (name: string, kind: RepoToken["kind"], value: string): RepoToken => ({ name, kind, values: { default: value }, locations: {}, tailwind: null, file: "tokens.css", line: 1 });
const TOKENS = [
  token("primary", "color", "#3366ff"), token("surface", "color", "#ffffff"),
  token("space-2", "spacing", "8px"), token("space-4", "spacing", "16px"),
  token("radius-md", "radius", "6px"), token("shadow-card", "shadow", "0 1px 2px rgba(0,0,0,.1)"), token("font-body", "font", "Inter, sans-serif"),
];
const index = buildTokenIndex(TOKENS, ["default"], null, {}, true);
const names: CssNames = cssNames(index);

const decls = (group: string, value: string) => Object.fromEntries(cssGroupById(group).toCss(value, names).filter(([, v]) => v !== null).map(([p, v]) => [p, v as string]));

describe("the groups as CSS", () => {
  it("are the inspector's own groups, with the same labels and sections", () => {
    for (const g of CSS_GROUPS) {
      const base = GROUPS.find((x) => x.id === g.id)!;
      expect(base, g.id).toBeDefined();
      expect([g.label, g.section]).toEqual([base.label, base.section]);
      expect(g.props.length).toBeGreaterThan(0);
    }
    // Everything a person can set with classes can be set in a stylesheet, but a few Tailwind-only ones
    const missing = GROUPS.filter((g) => !CSS_GROUPS.some((c) => c.id === g.id)).map((g) => g.id);
    expect(missing).toEqual([]);
  });

  it("write keywords as CSS and read them back", () => {
    for (const [group, value, css] of [
      ["display", "flex", "flex"], ["display", "hidden", "none"], ["direction", "col", "column"], ["justify", "between", "space-between"],
      ["items", "end", "flex-end"], ["wrap", "nowrap", "nowrap"], ["font-weight", "bold", "700"], ["text-align", "center", "center"],
      ["w", "full", "100%"], ["w", "fit", "fit-content"], ["max-w", "none", "none"], ["radius", "full", "9999px"], ["font-family", "mono", "monospace"],
    ] as const) {
      const g = cssGroupById(group);
      const written = g.toCss(value, names);
      expect(written[0][1], `${group}:${value}`).toBe(css);
      expect(g.fromCss({ [g.props[0]]: css }, names), `${group} read ${css}`).toBe(value);
    }
  });

  it("write a token as its variable and read the variable back as the token", () => {
    expect(decls("bg", "primary")).toEqual({ "background-color": "var(--primary)" });
    expect(cssGroupById("bg").fromCss({ "background-color": "var(--primary)" }, names)).toBe("primary");
    expect(decls("gap", "space-4")).toEqual({ gap: "var(--space-4)" });
    expect(cssGroupById("gap").fromCss({ gap: "var(--space-4)" }, names)).toBe("space-4");
    expect(decls("radius", "radius-md")).toEqual({ "border-radius": "var(--radius-md)" });
    expect(decls("shadow", "shadow-card")).toEqual({ "box-shadow": "var(--shadow-card)" });
    expect(decls("font-family", "font-body")).toEqual({ "font-family": "var(--font-body)" });
    // A variable that isn't a token of that kind is a value written out
    expect(cssGroupById("bg").fromCss({ "background-color": "var(--unknown)" }, names)).toBe("[var(--unknown)]");
    expect(cssGroupById("gap").fromCss({ gap: "var(--primary)" }, names)).toBe("[var(--primary)]");
  });

  it("write a value that is written out, and read one that isn't on offer the same way", () => {
    expect(decls("p", "[18px]")).toEqual({ padding: "18px" });
    expect(cssGroupById("p").fromCss({ padding: "18px" }, names)).toBe("[18px]");
    expect(cssGroupById("p").fromCss({ padding: "8px 16px" }, names)).toBe("[8px_16px]");
    expect(decls("bg", "[#4f46e5]")).toEqual({ "background-color": "#4f46e5" });
    expect(cssGroupById("bg").fromCss({ "background-color": "#4f46e5" }, names)).toBe("[#4f46e5]");
    expect(decls("shadow", "[0_2px_4px_#000]")).toEqual({ "box-shadow": "0 2px 4px #000" });
    // The ones on offer are plain
    expect(decls("p", "16px")).toEqual({ padding: "16px" });
    expect(cssGroupById("p").fromCss({ padding: "16px" }, names)).toBe("16px");
    expect(cssGroupById("p").fromCss({ padding: "0px" }, names)).toBe("0");
    expect(decls("m", "auto")).toEqual({ margin: "auto" });
  });

  it("write the properties each is, and nothing else", () => {
    expect(cssGroupById("px").props).toEqual(["padding-inline"]);
    expect(cssGroupById("gap-x").props).toEqual(["column-gap"]);
    expect(decls("pt", "8px")).toEqual({ "padding-top": "8px" });
    expect(decls("mx", "auto")).toEqual({ "margin-inline": "auto" });
    expect(decls("text-size", "24px")).toEqual({ "font-size": "24px" });
    expect(decls("text-color", "surface")).toEqual({ color: "var(--surface)" });
    expect(decls("border-color", "primary")).toEqual({ "border-color": "var(--primary)" });
  });

  it("write a color with opacity as a mix, and read it back", () => {
    expect(decls("bg", "primary/50")).toEqual({ "background-color": "color-mix(in srgb, var(--primary) 50%, transparent)" });
    expect(cssGroupById("bg").fromCss({ "background-color": "color-mix(in srgb, var(--primary) 50%, transparent)" }, names)).toBe("primary/50");
    expect(decls("bg", "[#000]/20")).toEqual({ "background-color": "color-mix(in srgb, #000 20%, transparent)" });
    expect(decls("bg", "primary/100")).toEqual({ "background-color": "var(--primary)" });
    expect(decls("text-color", "current")).toEqual({ color: "currentColor" });
    expect(cssGroupById("text-color").fromCss({ color: "currentcolor" }, names)).toBe("current");
    expect(decls("bg", "transparent")).toEqual({ "background-color": "transparent" });
  });

  it("write a border with a style, but keep a style that is there", () => {
    const g = cssGroupById("border-width");
    expect(g.toCss("2", names)).toEqual([["border-width", "2px"], ["border-style", "solid", "ifAbsent"]]);
    expect(g.toCss("0", names)).toEqual([["border-width", "0"]]);
    expect(g.fromCss({ "border-width": "2px" }, names)).toBe("2");
    expect(g.fromCss({ "border-width": "0" }, names)).toBe("0");
    expect(g.fromCss({ "border-width": "3px" }, names)).toBe("[3px]");
  });

  it("write opacity as a fraction, and shadows by name", () => {
    expect(decls("opacity", "50")).toEqual({ opacity: "0.5" });
    expect(cssGroupById("opacity").fromCss({ opacity: "0.5" }, names)).toBe("50");
    expect(cssGroupById("opacity").fromCss({ opacity: "0.33" }, names)).toBe("[0.33]");
    const sm = decls("shadow", "sm")["box-shadow"];
    expect(sm).toMatch(/^0 1px 2px/);
    expect(cssGroupById("shadow").fromCss({ "box-shadow": sm }, names)).toBe("sm");
    expect(decls("shadow", "none")).toEqual({ "box-shadow": "none" });
  });

  it("have a value to start from that is one of their own", () => {
    for (const g of CSS_GROUPS) {
      const written = g.toCss(g.start, names);
      expect(written.length, g.id).toBeGreaterThan(0);
      const back = g.fromCss(Object.fromEntries(written.filter(([, v]) => v !== null).map(([p, v]) => [p, v as string])), names);
      expect(back, `${g.id} starts as ${g.start}`).toBe(g.start);
    }
  });
});

describe("the repository's variables as tokens", () => {
  it("are offered by name, by what they are", () => {
    expect(index.css).toBe(true);
    expect(index.byRole.color.map((c) => c.value)).toEqual(["primary", "surface"]);
    expect(index.byRole.spacing.map((c) => c.value)).toEqual(["space-2", "space-4"]);
    expect(index.byRole.radius.map((c) => c.value)).toEqual(["radius-md"]);
    const { tokens, scale } = choicesFor(cssGroupById("gap"), index, "default");
    expect(tokens.map((t) => [t.value, t.hint])).toEqual([["space-2", "8px"], ["space-4", "16px"]]);
    // The values on offer say what they are worth
    expect(scale.find((c) => c.value === "16px")?.hint).toBe("16px");
  });

  it("flag a value that is written out where a token could be", () => {
    expect(statusOf("spacing", "space-4", index)).toBe("token");
    expect(statusOf("spacing", "16px", index)).toBe("raw");
    expect(isFlagged("spacing", "16px", index)).toBe(true);
    expect(isFlagged("spacing", "0", index)).toBe(false);
    expect(isFlagged("spacing", "auto", index)).toBe(false);
    expect(isFlagged("spacing", "space-2", index)).toBe(false);
    expect(isFlagged("color", "[#4f46e5]", index)).toBe(true);
    expect(isFlagged("color", "transparent", index)).toBe(false);
    expect(isFlagged("color", "white", index)).toBe(false);
    expect(isFlagged("color", "primary", index)).toBe(false);
  });

  it("do not flag anything in a role the repository has no tokens for", () => {
    const sparse = buildTokenIndex([token("primary", "color", "#3366ff")], ["default"], null, {}, true);
    expect(isFlagged("spacing", "16px", sparse)).toBe(false);
    expect(isFlagged("radius", "6px", sparse)).toBe(false);
    expect(isFlagged("color", "#fff", sparse)).toBe(true);
  });

  it("offer the token a written-out value is, or the nearest", () => {
    expect(suggest(cssGroupById("gap"), "16px", index)).toMatchObject({ value: "space-4", exact: true, token: true });
    expect(suggest(cssGroupById("gap"), "[8px]", index)).toMatchObject({ value: "space-2", exact: true });
    expect(suggest(cssGroupById("gap"), "13px", index)).toBeNull();
    expect(suggest(cssGroupById("bg"), "[#3366ff]", index)).toMatchObject({ value: "primary", exact: true });
    expect(suggest(cssGroupById("bg"), "[#3a6cf5]", index)).toMatchObject({ value: "primary", exact: false });
    expect(suggest(cssGroupById("radius"), "6px", index)).toMatchObject({ value: "radius-md", exact: true });
    // The closest token, said to be only that; never a Tailwind step
    expect(suggest(cssGroupById("radius"), "8px", index)).toMatchObject({ value: "radius-md", exact: false, token: true });
    expect(suggest(cssGroupById("p"), "20px", index)).toBeNull();
    expect(suggest(cssGroupById("radius"), "40px", index)).toBeNull();
  });
});
