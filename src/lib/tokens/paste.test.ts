import { describe, expect, it } from "vitest";
import { parsePaste, valueKind } from "./paste";

const L = { id: "L", name: "Light" };
const D = { id: "D", name: "Dark" };
const names = (r: { drafts: { name: string }[] }) => r.drafts.map((d) => d.name);
const find = <T extends { name: string }>(r: { drafts: T[] }, name: string) => r.drafts.find((d) => d.name === name)!;

describe("what a piece of text is", () => {
  it("tells colors, shadows and lengths apart", () => {
    expect(valueKind("#6366f1")).toBe("color");
    expect(valueKind("rgb(1 2 3)")).toBe("color");
    expect(valueKind("oklch(0.5 0.2 270)")).toBe("color");
    expect(valueKind("0 1px 2px rgba(0,0,0,.1)")).toBe("shadow");
    expect(valueKind("16px")).toBe("length");
    expect(valueKind("1rem")).toBe("length");
    expect(valueKind("16")).toBe("length");
    expect(valueKind("hello")).toBeNull();
    expect(valueKind("var(--x)")).toBeNull();
    expect(valueKind("")).toBeNull();
  });
});

describe("pasted CSS", () => {
  const css = `
:root { --primary-500: #6366f1; --background: oklch(1 0 0); --radius-md: 8px; --space-4: 1rem; --shadow-sm: 0 1px 2px rgba(0,0,0,.1); --border: var(--gray-200); --font-sans: Inter, sans-serif; }
.dark { --background: oklch(0.145 0 0); --primary-500: #818cf8; }
@theme { --color-brand-500: #1d4ed8; --radius-lg: 12px; }
`;

  it("reads the tokens the way a repository's are read, with the dark block as the dark theme", async () => {
    const r = await parsePaste(css, [L, D]);
    expect(r.format).toBe("css");
    expect(names(r).sort()).toEqual(["background", "color-brand-500", "primary-500", "radius-lg", "radius-md", "shadow-sm", "space-4"]);
    expect(find(r, "primary-500")).toMatchObject({ kind: "color", values: { L: "#6366f1", D: "#818cf8" } });
    expect(find(r, "background")).toMatchObject({ kind: "color", values: { L: "oklch(1 0 0)", D: "oklch(0.145 0 0)" } });
    expect(find(r, "radius-md")).toMatchObject({ kind: "radius", value: 8 });
    expect(find(r, "space-4")).toMatchObject({ kind: "spacing", value: 16 });
    expect(find(r, "shadow-sm")).toMatchObject({ kind: "shadow", x: 0, y: 1, blur: 2 });
  });

  it("says what it left out and why", async () => {
    const r = await parsePaste(css, [L, D]);
    expect(r.notes.join("\n")).toMatch(/border: refers to .*, which isn't a color/);
    expect(r.notes.join("\n")).toMatch(/font-sans/);
  });

  it("puts a theme the set doesn't have in the notes", async () => {
    const r = await parsePaste(css, [{ id: "T", name: "Default" }]);
    expect(find(r, "primary-500")).toMatchObject({ values: { T: "#6366f1" } });
    expect(r.notes.join("\n")).toMatch(/Theme "dark" isn't one of this set's themes/);
  });

  it("takes declarations with no rule around them", async () => {
    const r = await parsePaste("--brand: #1d4ed8;\n--gap: 8px;", [L]);
    expect(r.format).toBe("css");
    expect(find(r, "brand")).toMatchObject({ kind: "color", values: { L: "#1d4ed8" } });
    expect(find(r, "gap")).toMatchObject({ kind: "spacing", value: 8 });
  });

  it("leaves out a color it can't read", async () => {
    const r = await parsePaste(":root { --a: color-mix(in srgb, red, blue); --b: #fff; }", [L]);
    expect(names(r)).toEqual(["b"]);
    expect(r.notes.join("\n")).toMatch(/a: Motif can't read this color/);
  });
});

describe("pasted W3C tokens", () => {
  it("reads nested groups and the type a group gives", async () => {
    const r = await parsePaste(JSON.stringify({
      color: { primary: { $type: "color", "500": { $value: "#6366f1" }, "600": { $value: "#4f46e5" } }, background: { $value: "#ffffff", $type: "color" } },
      spacing: { "4": { $value: "16px", $type: "dimension" } },
      borderRadius: { md: { $value: "8px", $type: "dimension" }, full: { $value: "50%", $type: "dimension" } },
      shadow: { sm: { $type: "shadow", $value: { x: 0, y: 1, blur: 2, spread: 0, color: "#00000020" } } },
    }), [L]);
    expect(r.format).toBe("json");
    expect(names(r).sort()).toEqual(["background", "full", "md", "primary-500", "primary-600", "4", "sm"].map((n) => (n === "4" ? "t-4" : n)).sort());
    expect(find(r, "primary-500")).toMatchObject({ kind: "color", values: { L: "#6366f1" } });
    expect(find(r, "t-4")).toMatchObject({ kind: "spacing", value: 16 });
    expect(find(r, "md")).toMatchObject({ kind: "radius", value: 8 });
    expect(find(r, "full")).toMatchObject({ kind: "radius", value: 9999 });
    expect(find(r, "sm")).toMatchObject({ kind: "shadow", y: 1, blur: 2 });
  });

  it("says what it can't keep", async () => {
    const r = await parsePaste(JSON.stringify({ font: { body: { $value: "Inter", $type: "fontFamily" } }, c: { $value: "#fff", $type: "color" } }), [L]);
    expect(names(r)).toEqual(["c"]);
    expect(r.notes.join("\n")).toMatch(/fontFamily/);
  });

  it("falls back to reading text that only looks like JSON as CSS", async () => {
    const r = await parsePaste("{ --a: #fff }", [L]);
    expect(r.format).toBe("css");
  });
});

describe("pasted lines", () => {
  it("takes a name and a value in the usual forms", async () => {
    const r = await parsePaste("primary #6366f1\nsecondary: #4f46e5\n--accent: rgb(1 2 3);\nBrand Blue = #1d4ed8", [L]);
    expect(r.format).toBe("lines");
    expect(names(r)).toEqual(["primary", "secondary", "accent", "brand-blue"]);
    expect(find(r, "accent")).toMatchObject({ kind: "color", values: { L: "rgb(1 2 3)" } });
  });

  it("names a list of colors by number, several to a line", async () => {
    const r = await parsePaste("#111111, #222222 #333333\n#444444", [L]);
    expect(names(r)).toEqual(["color-1", "color-2", "color-3", "color-4"]);
    expect(r.drafts.every((d) => d.auto?.prefix === "color")).toBe(true);
    const named = await parsePaste("#111 #222", [L], { prefix: "Brand" });
    expect(names(named)).toEqual(["brand-1", "brand-2"]);
  });

  it("keeps a color function whole", async () => {
    const r = await parsePaste("rgb(1 2 3) oklch(0.5 0.1 200)", [L]);
    expect(r.drafts).toHaveLength(2);
  });

  it("tells radius from spacing by the name, and shadows by their shape", async () => {
    const r = await parsePaste("radius-md 8px\nspace-4 16\ngap 1rem\nshadow-sm: 0 1px 2px rgba(0,0,0,.1)", [L]);
    expect(find(r, "radius-md")).toMatchObject({ kind: "radius", value: 8 });
    expect(find(r, "space-4")).toMatchObject({ kind: "spacing", value: 16 });
    expect(find(r, "gap")).toMatchObject({ kind: "spacing", value: 16 });
    expect(find(r, "shadow-sm")).toMatchObject({ kind: "shadow" });
  });

  it("names lengths with no names by number", async () => {
    const r = await parsePaste("4 8 16", [L]);
    expect(names(r)).toEqual(["space-1", "space-2", "space-3"]);
    expect(r.drafts.map((d) => (d.kind === "spacing" ? d.value : 0))).toEqual([4, 8, 16]);
  });

  it("ignores comments and blank lines, and numbers the problems by line", async () => {
    const r = await parsePaste("// colors\n\nprimary #6366f1 // main\n  \nnot a token at all\nsecondary: nope", [L]);
    expect(names(r)).toEqual(["primary"]);
    expect(r.notes).toHaveLength(2);
    expect(r.notes[0]).toMatch(/^Line 5:/);
    expect(r.notes[1]).toMatch(/^Line 6:/);
  });

  it("keeps the last of two tokens with the same name", async () => {
    const r = await parsePaste("a #111111\na #222222", [L]);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({ values: { L: "#222222" } });
  });

  it("says when there is nothing", async () => {
    expect((await parsePaste("   \n  ", [L])).format).toBe("empty");
  });
});

describe("pasted aliases", () => {
  it("reads a color that is another color of the text, with what it comes to", async () => {
    const r = await parsePaste(":root { --gray-50: #f9fafb; --background: var(--gray-50); }\n.dark { --gray-50: #111111; --background: var(--gray-50); }", [L, D]);
    expect(r.notes).toEqual([]);
    expect(find(r, "background")).toEqual({ kind: "color", name: "background", values: { L: "#f9fafb", D: "#111111" }, aliases: { L: "gray-50", D: "gray-50" } });
  });

  it("reads one that is a color the set has already, and refuses one that is nowhere", async () => {
    const known = { "gray-900": { L: "#111827", D: "#111827" } };
    const r = await parsePaste("--foreground: var(--gray-900);\n--lost: var(--nowhere);", [L, D], { known });
    expect(find(r, "foreground")).toMatchObject({ values: { L: "#111827" }, aliases: { L: "gray-900" } });
    expect(names(r)).toEqual(["foreground"]);
    expect(r.notes.join(" ")).toMatch(/lost: refers to nowhere/);
  });
});
