// Converting a repository's stylesheet tokens on pull is off until what the tokens screen and the editor do with a linked repository
// (renaming a token everywhere it is used, previews with Motif's values, the pickers, Save as token) works on design tokens files as it does on
// stylesheets. It is switched on in a browser with `localStorage["motif-convert-tokens"] = "1"`, and in tests with `setConvertOnPull`.

let override: boolean | null = null;
export const setConvertOnPull = (on: boolean | null) => { override = on; };

export function convertOnPull(): boolean {
  if (override !== null) return override;
  try { return typeof localStorage !== "undefined" && localStorage.getItem("motif-convert-tokens") === "1"; } catch { return false; }
}
