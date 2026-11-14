import { describe, expect, it } from "vitest";
import { classesIn, hasRule, readDeclarations, setDeclarations, CssError } from "./css";

const SHEET = `/* Button */\n.button {\n  padding: 16px;\n  color: var(--text);\n}\n\n.other {\n  margin: 0;\n}\n`;

describe("reading a class's declarations", () => {
  it("gives what the plain rule has, the last of a property winning", () => {
    expect(readDeclarations(SHEET, "button")).toEqual({ padding: "16px", color: "var(--text)" });
    expect(readDeclarations(`.a { color: red; color: blue; }`, "a")).toEqual({ color: "blue" });
    expect(readDeclarations(SHEET, "missing")).toEqual({});
  });

  it("reads each state from its own rule", () => {
    const css = `.a { color: red; }\n.a:hover { color: blue; }\n.dark .a { color: white; }\n@media (min-width: 768px) {\n  .a { color: green; }\n}\n`;
    expect(readDeclarations(css, "a", "hover:")).toEqual({ color: "blue" });
    expect(readDeclarations(css, "a", "dark:")).toEqual({ color: "white" });
    expect(readDeclarations(css, "a", "md:")).toEqual({ color: "green" });
    expect(readDeclarations(css, "a", "lg:")).toEqual({});
    expect(readDeclarations(css, "a", "focus:")).toEqual({});
  });

  it("knows which classes there are", () => {
    expect([...classesIn(SHEET)].sort()).toEqual(["button", "other"]);
    expect(hasRule(SHEET, "button")).toBe(true);
    expect(hasRule(SHEET, "button__x")).toBe(false);
    expect(hasRule(`.a:hover { color: red; }`, "a")).toBe(false);
  });

  it("says when the stylesheet can't be read", () => {
    expect(() => readDeclarations(".a { color: red;", "a")).toThrow(CssError);
  });
});

describe("changing them", () => {
  it("changes a value in place, leaving everything around it as written", () => {
    expect(setDeclarations(SHEET, "button", "", [["padding", "24px"]])).toBe(SHEET.replace("16px", "24px"));
  });

  it("adds a property at the end of the rule, indented like the others", () => {
    expect(setDeclarations(SHEET, "button", "", [["gap", "8px"]])).toBe(`/* Button */\n.button {\n  padding: 16px;\n  color: var(--text);\n  gap: 8px;\n}\n\n.other {\n  margin: 0;\n}\n`);
  });

  it("takes a property away, and the rule when nothing is left", () => {
    expect(setDeclarations(SHEET, "button", "", [["color", null]])).toBe(SHEET.replace("  color: var(--text);\n", ""));
    const gone = setDeclarations(SHEET, "other", "", [["margin", null]]);
    expect(gone).not.toContain(".other");
    expect(gone).toContain(".button");
  });

  it("makes the rule for a class that has none, at the end", () => {
    const out = setDeclarations(SHEET, "button__label", "", [["font-weight", "600"]]);
    expect(out.startsWith(SHEET)).toBe(true);
    expect(out).toMatch(/\.button__label \{\n\s+font-weight: 600;\n\}/);
    expect(readDeclarations(out, "button__label")).toEqual({ "font-weight": "600" });
  });

  it("does nothing to a missing rule when asked to remove", () => {
    expect(setDeclarations(SHEET, "nope", "", [["color", null]])).toBe(SHEET);
  });

  it("writes a state next to the class's own rule", () => {
    const out = setDeclarations(SHEET, "button", "hover:", [["color", "red"]]);
    expect(out).toMatch(/\.button \{[^}]*\}\n\.button:hover \{\n\s+color: red;\n\}/);
    expect(out.indexOf(".button:hover")).toBeLessThan(out.indexOf(".other"));
    expect(readDeclarations(out, "button", "hover:")).toEqual({ color: "red" });
    expect(readDeclarations(out, "button")).toEqual({ padding: "16px", color: "var(--text)" });
  });

  it("writes the other states with their selectors", () => {
    let css = "";
    for (const [state, selector] of [["focus:", ".a:focus-visible"], ["active:", ".a:active"], ["disabled:", ".a:disabled"], ["dark:", ".dark .a"]] as const) {
      css = setDeclarations(css, "a", state, [["opacity", "0.5"]]);
      expect(css).toContain(`${selector} {`);
    }
  });

  it("writes breakpoints in media queries, narrower ones first", () => {
    let css = `.a { color: red; }\n`;
    css = setDeclarations(css, "a", "lg:", [["color", "blue"]]);
    css = setDeclarations(css, "a", "md:", [["color", "green"]]);
    expect(css.indexOf("min-width: 768px")).toBeLessThan(css.indexOf("min-width: 1024px"));
    expect(readDeclarations(css, "a", "md:")).toEqual({ color: "green" });
    expect(readDeclarations(css, "a", "lg:")).toEqual({ color: "blue" });
    // Changing one again changes it in place
    const again = setDeclarations(css, "a", "md:", [["color", "pink"]]);
    expect(again.match(/min-width: 768px/g)).toHaveLength(1);
    expect(readDeclarations(again, "a", "md:")).toEqual({ color: "pink" });
  });

  it("removes a media query when its last rule goes", () => {
    const css = setDeclarations(`.a { color: red; }\n`, "a", "md:", [["color", "blue"]]);
    const out = setDeclarations(css, "a", "md:", [["color", null]]);
    expect(out).not.toContain("@media");
    expect(out).toBe(`.a { color: red; }\n`);
  });

  it("only sets a property that isn't there when asked to", () => {
    const css = `.a { border-style: dashed; }\n`;
    expect(setDeclarations(css, "a", "", [["border-style", "solid", "ifAbsent"]])).toBe(css);
    expect(setDeclarations(`.a { }\n`.replace("{ }", "{ color: red; }"), "a", "", [["border-style", "solid", "ifAbsent"]])).toContain("border-style: solid");
  });

  it("keeps the other selectors of a rule shared with other classes out of it", () => {
    const css = `.a, .b { color: red; }\n`;
    // A rule for several selectors isn't this class's own: a new one is made.
    const out = setDeclarations(css, "a", "", [["margin", "0"]]);
    expect(out).toContain(".a, .b { color: red; }");
    expect(readDeclarations(out, "a")).toEqual({ margin: "0" });
  });

  it("refuses a value that could end the declaration, and a property that isn't one", () => {
    for (const bad of ["red; } body { display: none", "a}b", "url(x)\\", "red\nblue", "/* x */"]) {
      expect(() => setDeclarations(SHEET, "button", "", [["color", bad]])).toThrow(/can't be written/);
    }
    expect(() => setDeclarations(SHEET, "button", "", [["color: red; x", "1"]])).toThrow(/isn't a CSS property/);
    expect(() => setDeclarations(SHEET, "button", "weird:", [["color", "red"]])).toThrow(/can't be written in CSS/);
  });

  it("works on an empty stylesheet", () => {
    const out = setDeclarations("", "button", "", [["padding", "16px"]]);
    expect(readDeclarations(out, "button")).toEqual({ padding: "16px" });
  });
});
