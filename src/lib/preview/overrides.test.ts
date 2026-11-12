import { describe, expect, it } from "vitest";
import { tokenOverrides } from "./overrides";
import type { SyncDoc } from "../token-sync/doc";

const base: SyncDoc = {
  primary: { kind: "color", values: { light: "#4f46e5", dark: "#818cf8" } },
  radius: { kind: "radius", values: { light: "8" } },
  shadow: { kind: "shadow", values: { light: "0 1px 2px 0 #00000033" } },
};

describe("token overrides", () => {
  it("is empty while Motif and the repository agree", () => {
    expect(tokenOverrides(base, base, "light")).toEqual({ css: "", changed: [] });
  });

  it("emits only what changed, per theme, above the repository's own selectors", () => {
    const current: SyncDoc = { ...base, primary: { kind: "color", values: { light: "#ff0000", dark: "#818cf8" } }, radius: { kind: "radius", values: { light: "12" } } };
    const { css, changed } = tokenOverrides(current, base, "light");
    expect(changed.sort()).toEqual(["primary", "radius"]);
    expect(css).toContain("html:root {");
    expect(css).toContain("--primary: #ff0000;");
    expect(css).toMatch(/--radius: (12px|0\.75rem);/);
    expect(css).not.toContain("html.dark");
    expect(css).not.toContain("--shadow");
  });

  it("uses the dark class for the dark theme and an attribute for any other, base theme first", () => {
    const current: SyncDoc = {
      primary: { kind: "color", values: { dark: "#000000", sepia: "#f4ecd8", light: "#111111" } },
    };
    const css = tokenOverrides(current, base, "light").css;
    expect(css.indexOf("html:root")).toBeLessThan(css.indexOf("html.dark"));
    expect(css).toContain("html.dark {\n  --primary: #000000;");
    expect(css).toContain('html[data-theme="sepia"] {\n  --primary: #f4ecd8;');
  });

  it("keeps the base theme from outranking the others, which the repository orders by where they are written", () => {
    const current: SyncDoc = { primary: { kind: "color", values: { light: "#111111" } } };
    const css = tokenOverrides(current, base, "light", ["light", "dark", "sepia"]).css;
    expect(css).toBe('html:root:not(.dark):not([data-theme="sepia"]) {\n  --primary: #111111;\n}');
    // With no other theme there is nothing to exclude.
    expect(tokenOverrides(current, base, "light", ["light"]).css.startsWith("html:root {")).toBe(true);
  });

  it("includes tokens added in Motif, which the repository doesn't have yet", () => {
    const current: SyncDoc = { ...base, accent: { kind: "color", values: { light: "#00ff00" } } };
    expect(tokenOverrides(current, base, "light").css).toContain("--accent: #00ff00;");
  });

  it("writes a shadow as CSS", () => {
    const current: SyncDoc = { ...base, shadow: { kind: "shadow", values: { light: "0 4px 8px 0 #00000040" } } };
    expect(tokenOverrides(current, base, "light").css).toMatch(/--shadow: .*8px/);
  });
});
