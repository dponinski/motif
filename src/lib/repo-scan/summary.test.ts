import { describe, expect, it } from "vitest";
import { isColorValue, stackLine, stylingLine, supportCounts } from "./summary";
import type { RepoComponent, RepoStack } from "./types";

describe("isColorValue", () => {
  it("accepts colors in the usual notations", () => {
    for (const v of ["#fff", "#1a2b3c4d", "rgb(1 2 3 / 0.5)", "oklch(0.5 0.2 270)", "hsl(10, 20%, 30%)", "transparent", "color-mix(in oklab, red 50%, blue)"]) {
      expect(isColorValue(v), v).toBe(true);
    }
  });

  it("refuses anything that could fetch a resource or is not a single color", () => {
    for (const v of ["rgb(0 0 0) url(//evil.test/x.png)", "rgb(0 0 0), image-set(\"a.png\" 1x)", "url(x)", "var(--x)", "0.5rem", "red; background: url(x)", "rgb(0 0 0) } body { x"]) {
      expect(isColorValue(v), v).toBe(false);
    }
  });
});

describe("summaries", () => {
  const stack = (extra: Partial<RepoStack> = {}): RepoStack => ({
    framework: { name: "react", version: "19.3.1" }, supported: true, typescript: true, bundler: "Vite",
    styling: { primary: "tailwind", evidence: [] }, tailwindVersion: 4, variantHelper: "cva", packages: [], entryFiles: [], ...extra,
  });

  it("describes the stack", () => {
    expect(stackLine(stack())).toBe("React 19.3.1 · TypeScript · Vite");
    expect(stackLine(stack({ framework: { name: "next", version: "15.0.0" }, bundler: "Next.js", typescript: false }))).toBe("Next.js 15.0.0 · JavaScript · Next.js");
    expect(stackLine(stack({ framework: null, bundler: null }))).toBe("No framework found · TypeScript");
    expect(stylingLine(stack())).toBe("Tailwind CSS v4 · cva");
    expect(stylingLine(stack({ styling: { primary: "css-modules", evidence: [] }, tailwindVersion: null, variantHelper: null }))).toBe("CSS modules");
    expect(stylingLine(stack({ styling: { primary: null, evidence: [] }, tailwindVersion: null }))).toBe("No styling found · cva");
  });

  it("counts components by editability", () => {
    const c = (level: "editable" | "partial" | "view-only") => ({ support: { level, reasons: [] } }) as unknown as RepoComponent;
    expect(supportCounts([c("editable"), c("editable"), c("partial"), c("view-only")])).toEqual({ editable: 2, partial: 1, "view-only": 1 });
  });
});
