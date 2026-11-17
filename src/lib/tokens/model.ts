import type { ComponentDefinition, TokenSet } from "../../store/design-system";

// The token model as a project keeps it (on the device and on the server): tokens have a type, and tokens that belong together are
// compositions. The live token store (store/design-system.ts) still arranges the same tokens as five lists; lib/tokens/migrate.ts
// turns one into the other, losslessly, so a project can be read in either shape.

export const TOKENS_VERSION = 3;

// The key of `Token.values` for a value that is the same in every theme (everything but colors, for now).
export const ALL_THEMES = "*";

export type TokenType = "color" | "number" | "string";

// What a Number is measured in; "" is a bare number (a font weight, a ratio).
export type Unit = "px" | "rem" | "em" | "%" | "";

export interface Token {
  id: string;
  name: string;
  setId: string;
  // Motif's own way of arranging tokens; never sent to a repository. Absent for a token that was never put in a group.
  group?: string;
  type: TokenType;
  // By theme id (`ALL_THEMES` for a value that doesn't change with the theme): a color as the person wrote it, a number as text
  // ("16"), a string as it is.
  values: Record<string, string>;
  // Colors: what the color is in the theme that is open in its set, kept so that what shows a color needs nothing to work it out.
  value?: string;
  unit?: Unit;
  // Where the token belongs in the repository: the group it is written under (spacing, radius, color, …). Absent for a plain variable.
  use?: string;
  // Themes in which this token is another token: theme id -> the id of the token it is, which can be in another set.
  ref?: Record<string, string>;
  // Name of the repository token this one is synced with, when it came from (or went to) a repo.
  repoName?: string;
}

// One part of a composition: a literal, or another token of the same type.
export interface Slot {
  name: string;
  type: TokenType;
  value?: string;
  unit?: Unit;
  ref?: string;
}

// Tokens that go together as one: a text style (font family, size, weight, line height) or a shadow (offsets, blur, spread, color).
export interface Composition {
  id: string;
  name: string;
  setId: string;
  group?: string;
  kind: "typography" | "shadow" | "custom";
  slots: Slot[];
  repoName?: string;
  // Shadows: an inner shadow, and the whole value of a multi-layer shadow as canonical text (the slots hold its first layer).
  inset?: boolean;
  raw?: string;
}

export interface StoredTokenData {
  tokensVersion: typeof TOKENS_VERSION;
  sets: TokenSet[];
  tokens: Token[];
  compositions: Composition[];
  components: ComponentDefinition[];
}
