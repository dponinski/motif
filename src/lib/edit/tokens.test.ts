import { describe, expect, it } from "vitest";
import { loadFixture } from "../repo-scan/fixtures";
import { memorySource, scanRepository } from "../repo-scan";
import type { RepoToken } from "../repo-scan/types";
import { NO_NAMES, groupById, readGroup, writeGroup } from "./classes";
import { setGroup } from "./element";
import { buildTokenIndex, choicesFor, isFlagged, lengthPx, splitOpacity, statusOf, suggest, type TokenIndex } from "./tokens";

const token = (name: string, tailwind: string | null, values: Record<string, string>, kind: RepoToken["kind"] = "other"): RepoToken => ({
  name, kind, values, tailwind, file: "src/app.css", line: 1,
  locations: Object.fromEntries(Object.keys(values).map((k) => [k, { file: "src/app.css", line: 1, container: "theme" as const }])),
});

describe("the fixture repository's tokens", async () => {
  const analysis = await scanRepository(memorySource(loadFixture("motif-test-system")), { repo: "a/b", ref: "main" });
  const index = buildTokenIndex(analysis.tokens, analysis.themes, analysis.stack.tailwindVersion);

  it("offers the tokens the repository exposes to Tailwind, by what a class calls them", () => {
    expect(index.themes).toEqual(["light", "dark"]);
    expect(index.byRole.color.map((c) => c.value)).toContain("primary");
    expect(index.byRole.color.map((c) => c.value)).toContain("muted-foreground");
    expect(index.byRole.color).toHaveLength(17);
    expect(index.byRole.radius.map((c) => c.value)).toEqual(["sm", "md", "lg", "xl"]);
    expect(index.byRole.shadow.map((c) => c.value)).toEqual(["card", "overlay"]);
    expect(index.byRole.font.map((c) => c.value)).toEqual(["sans", "mono"]);
  });

  it("knows what each is worth in each theme", () => {
    const primary = index.byRole.color.find((c) => c.value === "primary")!;
    expect(primary.name).toBe("primary");
    expect(primary.values).toEqual({ light: "oklch(0.52 0.21 270)", dark: "oklch(0.65 0.18 270)" });
    // A token written once applies in every theme.
    expect(index.byRole.radius.find((c) => c.value === "md")!.values).toEqual({ light: "0.5rem", dark: "0.5rem" });
  });

  it("gives a control the tokens first, then what Tailwind ships with and the repository has not replaced", () => {
    const radius = choicesFor(groupById("radius"), index, "light");
    expect(radius.tokens).toEqual([
      { value: "sm", hint: "6px", swatch: null, token: true },
      { value: "md", hint: "8px", swatch: null, token: true },
      { value: "lg", hint: "12px", swatch: null, token: true },
      { value: "xl", hint: "16px", swatch: null, token: true },
    ]);
    expect(radius.scale.map((c) => c.value)).toEqual(["none", "xs", "DEFAULT", "2xl", "3xl", "full"]);
    expect(radius.scale.find((c) => c.value === "2xl")).toMatchObject({ hint: "16px", token: false });

    const shadow = choicesFor(groupById("shadow"), index, "light");
    expect(shadow.tokens.map((c) => c.value)).toEqual(["card", "overlay"]);
    expect(shadow.scale.map((c) => c.value)).toContain("md");

    const font = choicesFor(groupById("font-family"), index, "light");
    expect(font.tokens).toEqual([
      { value: "sans", hint: "Inter", swatch: null, token: true },
      { value: "mono", hint: "JetBrains Mono", swatch: null, token: true },
    ]);
    expect(font.scale.map((c) => c.value)).toEqual(["serif"]);
  });

  it("shows a color as a swatch it worked out itself, in the theme asked for", () => {
    const light = choicesFor(groupById("bg"), index, "light").tokens.find((c) => c.value === "primary")!;
    const dark = choicesFor(groupById("bg"), index, "dark").tokens.find((c) => c.value === "primary")!;
    expect(light.swatch).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark.swatch).toMatch(/^#[0-9a-f]{6}$/);
    expect(light.swatch).not.toBe(dark.swatch);
  });

  it("puts px beside the steps of the spacing scale", () => {
    const gap = choicesFor(groupById("gap"), index, "light");
    expect(gap.tokens).toEqual([]);
    expect(gap.scale.find((c) => c.value === "4")).toEqual({ value: "4", hint: "16px", swatch: null, token: false });
    expect(gap.scale.find((c) => c.value === "px")?.hint).toBe("1px");
  });

  it("tells a token from a step of the scale, a palette color and a written-out value", () => {
    expect(statusOf("color", "primary", index)).toBe("token");
    expect(statusOf("color", "primary/90", index)).toBe("token");
    expect(statusOf("color", "transparent", index)).toBe("scale");
    expect(statusOf("color", "red-500", index)).toBe("palette");
    expect(statusOf("color", "[#4f46e5]", index)).toBe("raw");
    expect(statusOf("radius", "md", index)).toBe("token");
    expect(statusOf("radius", "2xl", index)).toBe("scale");
    expect(statusOf("radius", "[10px]", index)).toBe("raw");
    expect(statusOf("spacing", "4", index)).toBe("scale");
    expect(statusOf("spacing", "[18px]", index)).toBe("raw");
  });

  it("points out written-out values, and palette colors because the repository has colors of its own", () => {
    expect(isFlagged("color", "[#4f46e5]", index)).toBe(true);
    expect(isFlagged("color", "red-500", index)).toBe(true);
    expect(isFlagged("color", "primary", index)).toBe(false);
    expect(isFlagged("color", "white", index)).toBe(false);
    expect(isFlagged("spacing", "4", index)).toBe(false);
    const none = buildTokenIndex([], [], 4);
    expect(isFlagged("color", "red-500", none)).toBe(false);
    // With no color tokens there is nothing a written-out color should have been; a length still has the scale.
    expect(isFlagged("color", "[#4f46e5]", none)).toBe(false);
    expect(isFlagged("spacing", "[18px]", none)).toBe(true);
    expect(isFlagged("shadow", "[0_0_1px_red]", none)).toBe(false);
  });

  describe("the token a written-out value could be", () => {
    const hex = (value: string) => choicesFor(groupById("bg"), index, "light").tokens.find((c) => c.value === value)!.swatch!;

    it("finds the color token that is the same color", () => {
      expect(suggest(groupById("bg"), `[${hex("primary")}]`, index)).toMatchObject({ value: "primary", exact: true, token: true });
      expect(suggest(groupById("text-color"), `[${hex("danger")}]`, index)).toMatchObject({ value: "danger", exact: true });
    });

    it("reads the notations a color can be written in", () => {
      expect(suggest(groupById("bg"), "[oklch(0.52_0.21_270)]", index)).toMatchObject({ value: "primary", exact: true });
      expect(suggest(groupById("bg"), "[color:oklch(0.52_0.21_270)]", index)).toMatchObject({ value: "primary", exact: true });
    });

    it("keeps an opacity as the class's own", () => {
      expect(suggest(groupById("bg"), `[${hex("primary")}]/50`, index)).toMatchObject({ value: "primary/50", exact: true });
      expect(suggest(groupById("bg"), `[${hex("primary")}80]`, index)).toMatchObject({ value: "primary/50", exact: true });
    });

    it("offers the closest color when none is the same, and nothing when none is close", () => {
      const near = suggest(groupById("bg"), "[oklch(0.53_0.2_268)]", index);
      expect(near).toMatchObject({ value: "primary", exact: false });
      expect(suggest(groupById("bg"), "[#00ff00]", index)).toBeNull();
    });

    it("turns a length into the step of the spacing scale that is the same", () => {
      expect(suggest(groupById("p"), "[16px]", index)).toMatchObject({ value: "4", exact: true, hint: "16px", token: false });
      expect(suggest(groupById("gap"), "[1.125rem]", index)).toMatchObject({ value: "4.5", exact: true });
      expect(suggest(groupById("mt"), "[1px]", index)).toMatchObject({ value: "px", exact: true });
      expect(suggest(groupById("w"), "[17.5px]", index)).toMatchObject({ exact: false });
      expect(suggest(groupById("p"), "[calc(100%-2px)]", index)).toBeNull();
    });

    it("finds the radius token of the same size, or the closest within reach", () => {
      expect(suggest(groupById("radius"), "[8px]", index)).toMatchObject({ value: "md", exact: true, token: true, hint: "8px" });
      expect(suggest(groupById("radius"), "[0.75rem]", index)).toMatchObject({ value: "lg", exact: true });
      expect(suggest(groupById("radius"), "[7px]", index)).toMatchObject({ value: "sm", exact: false });
      expect(suggest(groupById("radius"), "[9999px]", index)).toMatchObject({ value: "full", exact: true, token: false });
      expect(suggest(groupById("radius"), "[40px]", index)).toBeNull();
    });

    it("prefers a token over a Tailwind default of the same size", () => {
      // 16px is both the repository's `xl` and Tailwind's `2xl`.
      expect(suggest(groupById("radius"), "[16px]", index)).toMatchObject({ value: "xl", token: true });
    });

    it("finds the shadow token that is the same shadow", () => {
      expect(suggest(groupById("shadow"), "[0_1px_2px_0_rgb(0_0_0_/_0.04),0_1px_3px_0_rgb(0_0_0_/_0.06)]", index)).toMatchObject({ value: "card", exact: true });
      expect(suggest(groupById("shadow"), "[0_0_1px_red]", index)).toBeNull();
    });

    it("has nothing to offer for a value that is already a token or a step", () => {
      expect(suggest(groupById("bg"), "primary", index)).toBeNull();
      expect(suggest(groupById("p"), "4", index)).toBeNull();
      expect(suggest(groupById("display"), "flex", index)).toBeNull();
    });
  });
});

describe("other shapes of repository", () => {
  it("follows references between tokens, and the sums written with them", () => {
    const index = buildTokenIndex([
      token("radius", null, { default: "0.625rem" }),
      token("radius-lg", "radius-lg", { default: "var(--radius)" }),
      token("radius-md", "radius-md", { default: "calc(var(--radius) - 2px)" }),
      token("brand", null, { default: "222 47% 11%" }),
      token("color-brand", "color-brand", { default: "hsl(var(--brand))" }),
      token("color-missing", "color-missing", { default: "var(--nowhere, #ff0000)" }),
    ], ["default"], 4);
    const radius = choicesFor(groupById("radius"), index, "default").tokens;
    expect(radius).toEqual([
      { value: "lg", hint: "10px", swatch: null, token: true },
      { value: "md", hint: "8px", swatch: null, token: true },
    ]);
    const colors = choicesFor(groupById("bg"), index, "default").tokens;
    expect(colors.find((c) => c.value === "brand")!.swatch).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors.find((c) => c.value === "missing")!.swatch).toBe("#ff0000");
  });

  it("never shows a value it could not read as a color", () => {
    const index = buildTokenIndex([token("color-x", "color-x", { default: "url(https://evil.test/x.png)" })], ["default"], 4);
    expect(choicesFor(groupById("bg"), index, "default").tokens[0].swatch).toBeNull();
  });

  it("takes the spacing step, named spacing tokens and sizes of text from the theme", () => {
    const index = buildTokenIndex([
      token("spacing", "spacing", { default: "0.5rem" }),
      token("spacing-gutter", "spacing-gutter", { default: "1.5rem" }),
      token("text-display", "text-display", { default: "3rem" }),
      token("text-display--line-height", "text-display--line-height", { default: "1" }),
    ], ["default"], 4);
    expect(index.spacingStep).toBe(8);
    const p = choicesFor(groupById("p"), index, "default");
    expect(p.tokens).toEqual([{ value: "gutter", hint: "24px", swatch: null, token: true }]);
    expect(p.scale.find((c) => c.value === "4")?.hint).toBe("32px");
    expect(suggest(groupById("p"), "[24px]", index)).toMatchObject({ value: "gutter", token: true, exact: true });
    expect(suggest(groupById("p"), "[32px]", index)).toMatchObject({ value: "4", exact: true });
    expect(choicesFor(groupById("text-size"), index, "default").tokens).toEqual([{ value: "display", hint: "48px", swatch: null, token: true }]);
    expect(suggest(groupById("text-size"), "[48px]", index)).toMatchObject({ value: "display", token: true });
    expect(suggest(groupById("text-size"), "[15px]", index)).toMatchObject({ exact: false });
  });

  it("drops Tailwind's defaults where the repository switched them off", () => {
    const index = buildTokenIndex([
      token("radius-*", "radius-*", { default: "initial" }),
      token("radius-card", "radius-card", { default: "12px" }),
    ], ["default"], 4);
    const radius = choicesFor(groupById("radius"), index, "default");
    expect(radius.tokens.map((c) => c.value)).toEqual(["card"]);
    expect(radius.scale).toEqual([]);
  });

  it("uses Tailwind 3's scale for a Tailwind 3 repository", () => {
    const index = buildTokenIndex([token("color-brand-500", "color-brand-500", { default: "#4f46e5" }, "color")], ["default"], 3);
    expect(suggest(groupById("p"), "[18px]", index)).toMatchObject({ exact: false });
    expect(suggest(groupById("p"), "[20px]", index)).toMatchObject({ value: "5", exact: true });
    expect(choicesFor(groupById("radius"), index, "default").scale.find((c) => c.value === "sm")?.hint).toBe("2px");
    expect(suggest(groupById("bg"), "[#4f46e5]", index)).toMatchObject({ value: "brand-500", exact: true });
  });

  it("shows what Motif has changed and not yet sent, in place of the repository's value", () => {
    const tokens = [token("primary", "color-primary", { light: "#111111", dark: "#222222" }, "color")];
    const index = buildTokenIndex(tokens, ["light", "dark"], 4, { primary: { light: "#ff0000" } });
    const at = (theme: string) => choicesFor(groupById("bg"), index, theme).tokens[0].swatch;
    expect(at("light")).toBe("#ff0000");
    expect(at("dark")).toBe("#222222");
  });
});

describe("the opacity of a color class", () => {
  it("is what comes after the last slash outside brackets", () => {
    expect(splitOpacity("primary")).toEqual({ color: "primary", opacity: null });
    expect(splitOpacity("primary/90")).toEqual({ color: "primary", opacity: "90" });
    expect(splitOpacity("[#000]/[0.33]")).toEqual({ color: "[#000]", opacity: "[0.33]" });
    expect(splitOpacity("[rgb(0_0_0_/_0.5)]")).toEqual({ color: "[rgb(0_0_0_/_0.5)]", opacity: null });
    expect(splitOpacity("[rgb(0_0_0_/_0.5)]/50")).toEqual({ color: "[rgb(0_0_0_/_0.5)]", opacity: "50" });
  });
});

describe("lengths", () => {
  it("reads px, rem and simple sums", () => {
    expect(lengthPx("12px")).toBe(12);
    expect(lengthPx("0.5rem")).toBe(8);
    expect(lengthPx("calc(0.625rem - 4px)")).toBe(6);
    expect(lengthPx("calc(0.25rem * 3)")).toBe(12);
    expect(lengthPx("calc(infinity * 1px)")).toBe(9999);
    expect(lengthPx("calc(100% - 4px)")).toBeNull();
    expect(lengthPx("50%")).toBeNull();
  });
});

describe("classes that only the repository's names can place", () => {
  const index: TokenIndex = buildTokenIndex([
    token("text-display", "text-display", { default: "3rem" }),
    token("color-primary", "color-primary", { default: "#4f46e5" }, "color"),
    token("shadow-card", "shadow-card", { default: "0 1px 2px #0001" }, "shadow"),
    token("font-display", "font-display", { default: "Lora, serif" }, "font"),
    token("radius-card", "radius-card", { default: "12px" }, "radius"),
  ], ["default"], 4);
  const { names } = index;

  it("reads a text size token as a size and not a color", () => {
    expect(readGroup("text-display text-primary", groupById("text-size"), "", names)).toBe("display");
    expect(readGroup("text-display text-primary", groupById("text-color"), "", names)).toBe("primary");
    // Without the names there is no telling, and it is taken for a color as before.
    expect(readGroup("text-display", groupById("text-color"), "", NO_NAMES)).toBe("display");
  });

  it("reads a shadow token as a shadow and a color token after shadow- as the shadow's color", () => {
    expect(readGroup("shadow-card shadow-primary/40", groupById("shadow"), "", names)).toBe("card");
    expect(readGroup("shadow-primary", groupById("shadow"), "", names)).toBeNull();
  });

  it("reads the repository's fonts and radii", () => {
    expect(readGroup("font-display font-bold", groupById("font-family"), "", names)).toBe("display");
    expect(readGroup("font-display font-bold", groupById("font-weight"), "", names)).toBe("bold");
    expect(readGroup("rounded-card", groupById("radius"), "", names)).toBe("card");
    expect(readGroup("rounded-[10px]", groupById("radius"))).toBe("[10px]");
    expect(readGroup("rounded-t-lg rounded-tl-card", groupById("radius"), "", names)).toBeNull();
  });

  it("replaces only the class of the same kind", () => {
    expect(writeGroup("text-display text-primary", groupById("text-color"), "danger", "", names)).toBe("text-display text-danger");
    expect(writeGroup("text-display text-primary", groupById("text-size"), "lg", "", names)).toBe("text-lg text-primary");
    expect(writeGroup("rounded-[10px] p-2", groupById("radius"), "card", "", names)).toBe("rounded-card p-2");
  });

  it("writes the token into the source where the raw value was", async () => {
    const code = `export function A() {\n  return <div className="rounded-[12px] bg-[#4f46e5] text-display">x</div>;\n}\n`;
    const start = code.indexOf("<div");
    const radius = suggest(groupById("radius"), "[12px]", index)!;
    const a = await setGroup("A.tsx", code, start, "radius", radius.value, {}, "", names);
    expect(a!.code).toContain('className="rounded-card bg-[#4f46e5] text-display"');
    const bg = suggest(groupById("bg"), "[#4f46e5]", index)!;
    const b = await setGroup("A.tsx", a!.code, start, "bg", bg.value, {}, "", names);
    expect(b!.code).toContain('className="rounded-card bg-primary text-display"');
    const c = await setGroup("A.tsx", b!.code, start, "text-color", "primary", {}, "", names);
    expect(c!.code).toContain('className="rounded-card bg-primary text-display text-primary"');
  });
});
