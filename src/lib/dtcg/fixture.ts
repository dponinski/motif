import { emptyTokenData, type TokenData } from "../../store/design-system";
import { toStored } from "../tokens/migrate";
import type { StoredTokenData } from "../tokens/model";

// A project with everything in it, for the tests of the design tokens files: two sets that work together (primitive colors; semantic ones
// that are them), themes, numbers, strings and every kind of composition.
const PL = "p-l", PD = "p-d", SL = "s-l", SD = "s-d";

export function fixture(): StoredTokenData {
  const data: TokenData = {
    ...emptyTokenData(),
    sets: [
      { id: "set-prim", name: "Primitives", description: "Raw values", themes: [{ id: PL, name: "Light" }, { id: PD, name: "Dark" }], activeThemeId: PL },
      { id: "set-sem", name: "Semantic", themes: [{ id: SL, name: "Light" }, { id: SD, name: "Dark" }], activeThemeId: SL },
    ],
    colors: [
      { id: "g50", name: "gray-50", group: "gray", setId: "set-prim", value: "#f9fafb", themeValues: { [PL]: "#f9fafb", [PD]: "#1f2937" } },
      { id: "g900", name: "gray-900", group: "gray", setId: "set-prim", value: "#111827", themeValues: { [PL]: "#111827", [PD]: "#f3f4f6" } },
      { id: "brand", name: "brand", group: "brand", setId: "set-prim", value: "oklch(0.6 0.2 260)", themeValues: { [PL]: "oklch(0.6 0.2 260)", [PD]: "oklch(0.7 0.18 260)" } },
      { id: "overlay", name: "overlay", group: "base", setId: "set-prim", value: "#00000080", themeValues: { [PL]: "#00000080", [PD]: "#00000080" } },
      { id: "surface", name: "surface", group: "semantic", setId: "set-sem", value: "#f9fafb", themeValues: { [SL]: "#f9fafb", [SD]: "#1f2937" }, themeAlias: { [SL]: "set-prim/gray-50", [SD]: "set-prim/gray-50" } },
      { id: "text", name: "text", group: "semantic", setId: "set-sem", value: "#111827", themeValues: { [SL]: "#111827", [SD]: "#ffffff" }, themeAlias: { [SL]: "set-prim/gray-900" } },
      { id: "accent", name: "accent", group: "semantic", setId: "set-sem", value: "oklch(0.6 0.2 260)", themeValues: { [SL]: "oklch(0.6 0.2 260)", [SD]: "oklch(0.7 0.18 260)" }, themeAlias: { [SL]: "set-prim/brand", [SD]: "set-prim/brand" } },
    ],
    spacing: [{ id: "sp4", name: "space-4", value: 16, group: "base", setId: "set-prim" }],
    radii: [{ id: "rmd", name: "radius-md", value: 6, group: "base", setId: "set-prim" }],
    numbers: [
      { id: "n-xl", name: "text-xl", value: 1.5, unit: "rem", use: "font-size", setId: "set-prim" },
      { id: "n-ratio", name: "ratio", value: 1.25, unit: "", setId: "set-prim" },
      { id: "n-bold", name: "bold", value: 700, unit: "", use: "font-weight", setId: "set-prim" },
      { id: "n-em", name: "tight", value: 0.9, unit: "em", use: "line-height", setId: "set-prim" },
    ],
    strings: [
      { id: "s-sans", name: "font-sans", value: "Inter, system-ui, sans-serif", use: "font-family", setId: "set-prim" },
      { id: "s-label", name: "label", value: "Save", setId: "set-sem" },
    ],
    compositions: [
      { id: "c-head", name: "heading", kind: "typography", setId: "set-sem", group: "text", slots: [
        { name: "font-family", type: "string", ref: "s-sans" }, { name: "font-size", type: "number", ref: "n-xl" }, { name: "font-weight", type: "number", ref: "n-bold" },
        { name: "line-height", type: "number", value: "1.2", unit: "" }, { name: "letter-spacing", type: "number", value: "-0.5", unit: "px" },
      ] },
      { id: "c-card", name: "card", kind: "shadow", setId: "set-sem", inset: true, slots: [
        { name: "x", type: "number", value: "0", unit: "px" }, { name: "y", type: "number", value: "4", unit: "px" }, { name: "blur", type: "number", value: "8", unit: "px" },
        { name: "spread", type: "number", value: "0", unit: "px" }, { name: "color", type: "color", ref: "overlay" },
      ] },
      { id: "c-badge", name: "badge", kind: "custom", setId: "set-sem", slots: [
        { name: "background", type: "color", ref: "brand" }, { name: "Padding X", type: "number", ref: "sp4" }, { name: "label", type: "string", value: "New" },
      ] },
    ],
  };
  return toStored(data);
}

