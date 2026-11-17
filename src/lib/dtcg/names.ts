import type { TokenType } from "../tokens/model";

// How a Motif token is named and placed in a DTCG file. The top-level groups are Tailwind's own namespaces (`color`, `spacing`, `radius`,
// `text`, `leading`, `tracking`, `font`, `font-weight`, `shadow`), so `color.brand` is `--color-brand` and Tailwind gives it its classes.
// A token that isn't used as one of those (a plain number or string) is a token of the top level, and is a variable with just its name.

// What a token is used as -> the namespace it is written under.
const NAMESPACE_OF_USE: Record<string, string> = {
  color: "color",
  spacing: "spacing",
  radius: "radius",
  "font-size": "text",
  "line-height": "leading",
  "letter-spacing": "tracking",
  "font-weight": "font-weight",
  "font-family": "font",
};
const USE_OF_NAMESPACE = Object.fromEntries(Object.entries(NAMESPACE_OF_USE).map(([use, ns]) => [ns, use]));

// Compositions live in namespaces too: a text style is `text.<name>`, a shadow `shadow.<name>`, one of your own `composition.<name>.<part>`.
export const COMPOSITION_NAMESPACE = { typography: "text", shadow: "shadow", custom: "composition" } as const;

// The groups that Tailwind builds classes from: the variables in them go in `@theme`.
export const THEME_NAMESPACES = new Set(["color", "spacing", "radius", "text", "leading", "tracking", "font", "font-weight", "shadow"]);

// What a name may start with that the namespace already says (`space-4` in `spacing` is `4`; the name is kept in the extension).
const ALIASES: Record<string, string[]> = {
  color: ["color-"], spacing: ["spacing-", "space-"], radius: ["radius-"], text: ["text-"], leading: ["leading-"], tracking: ["tracking-"],
  font: ["font-"], "font-weight": ["font-weight-"], shadow: ["shadow-"],
};

// The slug a token name becomes as a path part (and so as a variable name).
export function slug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/\.+/g, "-").replace(/^-+|-+$/g, "");
  return /^[0-9]/.test(s) && !/^[0-9]+$/.test(s) ? `t-${s}` : s || "token";
}

export const namespaceOf = (type: TokenType, use: string | undefined): string => (type === "color" ? "color" : use ? NAMESPACE_OF_USE[use] ?? "" : "");
export const purposeOfNamespace = (namespace: string): string | undefined => USE_OF_NAMESPACE[namespace];

// The last part of a path: the name without what the namespace says.
export function leafOf(name: string, namespace: string): string {
  const s = slug(name);
  for (const alias of ALIASES[namespace] ?? []) if (s.startsWith(alias) && s.length > alias.length) return s.slice(alias.length);
  return s;
}

export const pathOf = (type: TokenType, use: string | undefined, name: string): string[] => {
  const ns = namespaceOf(type, use);
  return ns ? [ns, leafOf(name, ns)] : [slug(name)];
};

// A token that is somewhere else in the files than Motif would put it (a repository's own groups: `color.brand.500`) keeps that place in its
// `repoName`, written `dtcg:color.brand.500`, so a push writes it back where it was.
const PLACE = "dtcg:";
export const placeOf = (repoName: string | undefined): string[] | null => (repoName?.startsWith(PLACE) ? repoName.slice(PLACE.length).split(".") : null);
export const repoNameOfPlace = (path: string[]): string => `${PLACE}${path.join(".")}`;

// The name of the variable a path is.
export const variableOf = (path: string[]): string => `--${path.join("-")}`;

// The text of a reference to the token at `path` (`{color.brand}`), and the path a reference names.
export const refOf = (path: string[]): string => `{${path.join(".")}}`;
export const pathOfRef = (text: string): string[] | null => {
  const m = /^\{([^{}]+)\}$/.exec(text.trim());
  return m ? m[1].split(".") : null;
};

// The key of a theme: its name as a path part (`Dark` -> `dark`).
export const themeKey = (name: string): string => slug(name);
