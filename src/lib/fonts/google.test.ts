import { describe, expect, it } from "vitest";
import { findGoogleFont, firstFamily, fontValue, GOOGLE_FONTS, googleFamiliesIn, googleFontsUrl, searchFonts } from "./google";
import { fontImport, googleFamiliesUsed } from "./used";

describe("google fonts", () => {
  it("lists families with their kind and weights", () => {
    expect(GOOGLE_FONTS.length).toBeGreaterThan(250);
    expect(findGoogleFont("inter")).toMatchObject({ family: "Inter", kind: "sans-serif" });
    expect(findGoogleFont("Playfair Display")?.kind).toBe("serif");
    expect(findGoogleFont("Georgia")).toBeUndefined();
  });

  it("finds the first family of a value", () => {
    expect(firstFamily('"Playfair Display", serif')).toBe("Playfair Display");
    expect(firstFamily("'DM Sans', system-ui")).toBe("DM Sans");
    expect(firstFamily("Inter, sans-serif")).toBe("Inter");
    expect(firstFamily("  ")).toBeNull();
    expect(firstFamily(undefined)).toBeNull();
  });

  it("writes a family as a value with a fallback of its kind, quoting only a name that needs it", () => {
    expect(fontValue("Inter", "sans-serif")).toBe("Inter, sans-serif");
    expect(fontValue("Playfair Display", "serif")).toBe('"Playfair Display", serif');
    expect(fontValue("Caveat", "handwriting")).toBe("Caveat, cursive");
    expect(fontValue("Fira Code", "monospace")).toBe('"Fira Code", monospace');
  });

  it("asks Google for the weights a family has, once each", () => {
    const url = googleFontsUrl(["Playfair Display", "Inter", "Inter"]);
    expect(url).toMatch(/^https:\/\/fonts\.googleapis\.com\/css\?family=Inter:[\d,]+\|Playfair\+Display:[\d,]+&display=swap$/);
    expect(googleFontsUrl(["Inter"], { text: "Aa b", weights: () => [400] })).toBe("https://fonts.googleapis.com/css?family=Inter:400&text=Aa%20b&display=swap");
  });

  it("picks out the Google fonts among values", () => {
    expect(googleFamiliesIn(["Inter, sans-serif", "Georgia, serif", '"Lora", serif', undefined, "inter"])).toEqual(["Inter", "Lora"]);
  });

  it("searches by every word, names that start with it first, within a kind", () => {
    const hits = searchFonts("roboto");
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0].family.toLowerCase().startsWith("roboto")).toBe(true);
    expect(searchFonts("playfair display")[0].family).toBe("Playfair Display");
    expect(searchFonts("", "monospace").every((f) => f.kind === "monospace")).toBe(true);
    expect(searchFonts("zzzzzz")).toEqual([]);
  });

  it("collects the families a project's tokens use, in every theme", () => {
    const used = googleFamiliesUsed({
      strings: [{ value: "Inter, sans-serif", use: "font-family", themeValues: { t2: "Lora, serif" } }, { value: "Merriweather", use: undefined }],
      typography: [{ fontFamily: "Roboto Mono, monospace" }, { fontFamily: "Georgia" }],
      compositions: [{ slots: [{ name: "font-family", type: "string", value: "Poppins, sans-serif", themes: { t2: { value: "Caveat, cursive" } } }, { name: "other", type: "string", value: "Oswald" }] }],
    });
    expect(used).toEqual(["Caveat", "Inter", "Lora", "Poppins", "Roboto Mono"]);
  });

  it("makes a stylesheet line, or nothing", () => {
    expect(fontImport([])).toBe("");
    expect(fontImport(["Inter"])).toMatch(/^@import url\("https:\/\/fonts\.googleapis\.com\/css\?family=Inter:[\d,]+&display=swap"\);\n$/);
  });
});
