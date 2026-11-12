import type { RepoComponent, RepoStack, StylingSystem } from "./types";

export const STYLING_LABEL: Record<StylingSystem, string> = {
  tailwind: "Tailwind CSS",
  "css-modules": "CSS modules",
  "styled-components": "styled-components",
  emotion: "Emotion",
  sass: "Sass",
  "vanilla-extract": "vanilla-extract",
  "plain-css": "Plain CSS",
};

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(.*\)|transparent|currentcolor|white|black)$/i;
// Values come from arbitrary repositories and end up in a style attribute, so anything that could fetch a resource is refused.
export const isColorValue = (value: string) => COLOR_VALUE.test(value.trim()) && !/url|image|element|[;{}]/i.test(value);

export function supportCounts(components: RepoComponent[]) {
  const counts = { editable: 0, partial: 0, "view-only": 0 };
  for (const c of components) counts[c.support.level]++;
  return counts;
}

export function stackLine(stack: RepoStack): string {
  const framework = stack.framework ? `${stack.framework.name === "next" ? "Next.js" : stack.framework.name[0].toUpperCase() + stack.framework.name.slice(1)}${stack.framework.version ? ` ${stack.framework.version}` : ""}` : "No framework found";
  return [framework, stack.typescript ? "TypeScript" : "JavaScript", stack.bundler].filter(Boolean).join(" · ");
}

export function stylingLine(stack: RepoStack): string {
  const primary = stack.styling.primary ? STYLING_LABEL[stack.styling.primary] : "No styling found";
  const version = stack.styling.primary === "tailwind" && stack.tailwindVersion ? ` v${stack.tailwindVersion}` : "";
  const helper = stack.variantHelper ? ` · ${stack.variantHelper}` : "";
  return `${primary}${version}${helper}`;
}
