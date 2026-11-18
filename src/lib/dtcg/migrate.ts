import { repoKey } from "../token-sync/keys";
import { readMotifTokens, type SyncDoc, type TokenSlices } from "../token-sync/doc";
import type { TokenLink } from "../token-sync/flow";
import type { Composition, StoredTokenData, Token } from "../tokens/model";
import { ALL_THEMES } from "../tokens/model";
import type { Conversion } from "./convert";
import { COMPOSITION_NAMESPACE, leafOf, pathOf, placeOf, themeKey } from "./names";
import type { DtcgLink } from "./sync";

// A project whose tokens were linked to the repository's stylesheets before they were read as design tokens files: the link carries colors,
// spacing, radii and shadows of one set and nothing else, so a Number, a String, a composition or a token of another set that is made here never
// reaches the repository. This moves such a project to the design tokens files (lib/dtcg/convert.ts), which carry everything, without losing
// what was changed here and not yet sent:
//
//   - the tokens are the ones the repository's stylesheets come to (what a first pull of a new project would bring in), with the arrangement
//     (the group) the person had given each;
//   - a token that was made here and is not in the repository is kept as it is;
//   - a value that was changed here is put into the token it belongs to, and a token that was deleted here is gone;
//   - everything the old link did not carry (Numbers, Strings, compositions, other sets) is kept as it is.
//
// The link is then the one of a repository converted on its first push: what is waiting is the difference, and the first push sends it.

export interface Migration {
  data: StoredTokenData;
  link: DtcgLink;
  // What was carried over from what was waiting.
  carried: { added: number; changed: number; removed: number };
}

type Converted = Conversion & { dir: string; output: string; tailwind: boolean };

const asPx = (n: number, unit: string | undefined) => String(parseFloat((unit === "rem" || unit === "em" ? n / 16 : n).toFixed(4)));

export function migrateStylesheetLink(input: { link: TokenLink; slices: TokenSlices; legacy: StoredTokenData; conversion: Converted; repo: string }): Migration {
  const { link, slices, legacy, conversion, repo } = input;
  const prefixes = link.prefixes;

  // The repository's name for every token the old link carried, by the token's id.
  const keyOf = new Map<string, string>();
  for (const c of slices.colors) if (c.setId === link.setId) keyOf.set(c.id, repoKey("color", c, prefixes));
  for (const r of slices.radii) if (r.setId === link.setId) keyOf.set(r.id, repoKey("radius", r, prefixes));
  for (const s of slices.spacing) if (s.setId === link.setId) keyOf.set(s.id, repoKey("spacing", s, prefixes));
  for (const s of slices.shadows) if (s.setId === link.setId) keyOf.set(s.id, repoKey("shadow", s, prefixes));

  // What is waiting: the difference between the tokens now and the tokens as of the last sync.
  const now: SyncDoc = readMotifTokens(slices, link);
  const added = Object.keys(now).filter((k) => !(k in link.base));
  const removed = Object.keys(link.base).filter((k) => !(k in now));
  const changed = Object.keys(now).filter((k) => k in link.base && JSON.stringify(now[k].values) !== JSON.stringify(link.base[k].values));

  // The converted model, by the variable each token is.
  const data: StoredTokenData = JSON.parse(JSON.stringify(conversion.model));
  const main = data.sets[0];
  const varOfToken = (t: Token) => (placeOf(t.repoName) ?? pathOf(t.type, t.use, t.name)).join("-");
  const varOfComposition = (c: Composition) => (placeOf(c.repoName) ?? [COMPOSITION_NAMESPACE[c.kind], leafOf(c.name, COMPOSITION_NAMESPACE[c.kind])]).join("-");
  const tokenByVar = new Map(data.tokens.map((t) => [varOfToken(t), t]));
  const compositionByVar = new Map(data.compositions.map((c) => [varOfComposition(c), c]));

  // The theme of the old set is the theme of the new one that the repository calls the same.
  const oldSet = legacy.sets.find((s) => s.id === link.setId);
  const themeFor = new Map<string, string>();
  for (const [key, oldId] of Object.entries(link.themes)) {
    const found = main.themes.find((t) => (t.repoKey ?? themeKey(t.name)) === key || t.name.toLowerCase() === key.toLowerCase());
    if (found) themeFor.set(oldId, found.id);
  }
  const baseTheme = main.themes[0].id;
  const rehome = <T extends Token | Composition>(x: T): T => {
    const out = { ...x, setId: main.id } as T;
    if ("values" in out && out.values) {
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(out.values)) values[k === ALL_THEMES ? k : themeFor.get(k) ?? (k === oldSet?.activeThemeId ? baseTheme : k)] = v;
      (out as Token).values = values;
    }
    return out;
  };

  // Tokens that only exist here come along as they are; the old link's own arrangement is given to the ones the repository has.
  for (const t of legacy.tokens) {
    if (t.setId !== link.setId) { data.tokens.push(t); continue; }
    const key = keyOf.get(t.id);
    if (key === undefined) { data.tokens.push(rehome(t)); continue; }
    if (added.includes(key)) { data.tokens.push(rehome(t)); continue; }
    const there = tokenByVar.get(key);
    if (there && t.group !== undefined) there.group = t.group;
  }
  for (const c of legacy.compositions) {
    if (c.setId !== link.setId) { data.compositions.push(c); continue; }
    const key = keyOf.get(c.id);
    if (key === undefined) { data.compositions.push(rehome(c)); continue; }
    if (added.includes(key)) { data.compositions.push(rehome(c)); continue; }
    const there = compositionByVar.get(key);
    if (there && c.group !== undefined) there.group = c.group;
  }
  for (const s of legacy.sets) if (s.id !== link.setId) data.sets.push(s);
  data.components = legacy.components;

  // A value that was changed here goes into the token the repository has.
  for (const key of changed) {
    const mine = now[key];
    const token = tokenByVar.get(key);
    const composition = compositionByVar.get(key);
    if (mine.kind === "color" && token) {
      for (const [repoTheme, value] of Object.entries(mine.values)) {
        const oldId = link.themes[repoTheme];
        const id = (oldId && themeFor.get(oldId)) || (repoTheme === link.baseTheme ? baseTheme : undefined);
        if (id) token.values[id] = value;
      }
      token.value = token.values[baseTheme] ?? token.value;
    } else if ((mine.kind === "radius" || mine.kind === "spacing") && token) {
      const px = parseFloat(mine.values[link.baseTheme] ?? Object.values(mine.values)[0]);
      if (Number.isFinite(px)) token.values[ALL_THEMES] = asPx(px, token.unit);
    } else if (mine.kind === "shadow" && composition) {
      const own = legacy.compositions.find((c) => keyOf.get(c.id) === key);
      if (own) {
        const i = data.compositions.indexOf(composition);
        data.compositions[i] = { ...rehome(own), repoName: composition.repoName };
      }
    }
  }

  // A token deleted here is not in the repository after the first push.
  for (const key of removed) {
    const token = tokenByVar.get(key);
    if (token) data.tokens.splice(data.tokens.indexOf(token), 1);
    const composition = compositionByVar.get(key);
    if (composition) data.compositions.splice(data.compositions.indexOf(composition), 1);
  }

  const dtcg: DtcgLink = {
    format: "dtcg", repo, branch: link.branch, dir: conversion.dir, files: "single", output: conversion.output, tailwind: conversion.tailwind,
    base: conversion.files,
    convert: { converted: conversion.converted, containers: conversion.containers, selectors: conversion.selectors, left: conversion.left },
    syncedAt: Date.now(),
  };
  return { data, link: dtcg, carried: { added: added.length, changed: changed.length, removed: removed.length } };
}
