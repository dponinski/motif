import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDesignSystemStore, DEFAULT_GROUP, type ColorToken, type NumberToken, type RadiusToken, type ShadowToken, type SpacingToken, type StringToken, type TokenKind, type TypographyToken } from "@/store/design-system";
import { isDtcgLink, useGitStore } from "@/store/git";
import { COMPOSITION_NAMESPACE, leafOf, pathOf, placeOf, repoNameOfPlace } from "@/lib/dtcg/names";
import { useTokenChanges } from "@/components/work/useWork";
import { cssName, readRepoTokens, type SyncKind } from "@/lib/token-sync/doc";
import { keyPrefixes, repoKey } from "@/lib/token-sync/keys";
import { hexOf } from "@/lib/tokens/contrast";
import { summary, type ComposeData } from "@/lib/tokens/compose";
import type { Composition } from "@/lib/tokens/model";

export type Token = ColorToken | TypographyToken | SpacingToken | RadiusToken | ShadowToken | NumberToken | StringToken | Composition;

// A token as the screen arranges it: what it is called, where it is, what a search can find in it, and how it stands with the
// repository.
export interface Row {
  id: string;
  kind: TokenKind;
  name: string;
  group: string;
  text: string;
  // The repository has a token of this name (so Motif can't rename it).
  linked: boolean;
  // Different in Motif from the repository, waiting for the next sync.
  changed: boolean;
  // The repository defines it somewhere Motif can't edit yet (a Tailwind config file, a JSON file).
  readonly: boolean;
  token: Token;
  // The variable it makes in the repository, when it is in design tokens files (`color-brand`), else its name there.
  variable: string | null;
  // Where the repository's code uses it, when that is known (the repository has been scanned for it, and the token is its own).
  use: { n: number; files: string[]; components: string[] } | null;
  // Known to be used nowhere the scan looks (class names and var() in components and stylesheets).
  unused: boolean;
  // A color that is not the same color in every theme of its set.
  differs: boolean;
}

function searchText(kind: TokenKind, t: Token, themes: { id: string }[], data: ComposeData): string {
  switch (kind) {
    case "color": {
      const c = t as ColorToken;
      return themes.map((th) => { const v = c.themeValues[th.id] ?? c.value; return `${hexOf(v)} ${v} ${c.themeAlias?.[th.id] ?? ""}`; }).join(" ");
    }
    case "spacing": return `${(t as SpacingToken).value}px`;
    case "radius": return `${(t as RadiusToken).value}px`;
    case "shadow": { const s = t as ShadowToken; return `${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}`; }
    case "number": { const n = t as NumberToken; return `${n.value}${n.unit} ${n.use ?? ""}`; }
    case "string": { const x = t as StringToken; return `${x.value} ${x.use ?? ""}`; }
    case "composition": { const c = t as Composition; return `${c.kind} ${summary(c, data)}`; }
    case "typography": { const y = t as TypographyToken; return `${y.fontFamily} ${y.fontSize}px ${y.fontWeight} ${y.lineHeight}`; }
  }
}

// Where a token is in the design tokens files: the path its variable is named by (`color.brand` is `--color-brand`).
export function pathInFiles(kind: TokenKind, t: Token): string[] | null {
  const repoName = (t as { repoName?: string }).repoName;
  const placed = placeOf(repoName);
  if (placed) return placed;
  const name = (t as { name: string }).name;
  switch (kind) {
    case "color": return pathOf("color", undefined, name);
    case "spacing": case "radius": return pathOf("number", kind, name);
    case "number": case "string": return pathOf(kind, (t as NumberToken | StringToken).use, name);
    case "shadow": return [COMPOSITION_NAMESPACE.shadow, leafOf(name, COMPOSITION_NAMESPACE.shadow)];
    default: return null;
  }
}

export function useRows(outer: TokenKind, setId: string, themes: { id: string }[]): Row[] {
  const kind = outer;
  // The spacing and radius tabs also have the numbers that are used as one (a length in rem or em, which the lists of px lengths don't hold),
  // and the numbers tab has the others.
  const list = useDesignSystemStore(useShallow((s): Token[] => (kind === "color" ? s.colors : kind === "spacing" ? [...s.spacing, ...s.numbers.filter((n) => n.use === "spacing")] : kind === "radius" ? [...s.radii, ...s.numbers.filter((n) => n.use === "radius")] : kind === "shadow" ? s.shadows : kind === "number" ? s.numbers.filter((n) => n.use !== "spacing" && n.use !== "radius") : kind === "string" ? s.strings : kind === "composition" ? s.compositions : s.typography)));
  // What a composition's slots can be (read for the compositions only).
  const data = useDesignSystemStore(useShallow((s): ComposeData => ({ colors: s.colors, numbers: s.numbers, strings: s.strings, spacing: s.spacing, radii: s.radii })));
  const changes = useTokenChanges();
  const analysis = useGitStore((s) => s.analysis);
  // The tokens are design tokens files: each token is a place in them, and the variable it makes is named by it.
  const inFiles = useGitStore((s) => isDtcgLink(s.tokenLink));
  const changed = useMemo(() => new Set(changes.map((c) => c.name)), [changes]);
  // The names tokens made here have in the repository (a radius `card` is `radius-card` there).
  const prefixes = useMemo(() => (analysis ? keyPrefixes(analysis) : undefined), [analysis]);
  const readonlyBy = useMemo(() => (analysis ? readRepoTokens(analysis.tokens, analysis.themes).readonly : {}), [analysis]);
  const componentsIn = useMemo(() => {
    const byFile = new Map<string, string[]>();
    for (const c of analysis?.components ?? []) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c.name]);
    return byFile;
  }, [analysis]);
  return useMemo(
    () => (list as Token[]).filter((t) => t.setId === setId).map((t) => {
      const repoName = (t as { repoName?: string }).repoName;
      // (A number in the radius or spacing tab is a number: what edits it is the number's.)
      const kind: TokenKind = (outer === "radius" || outer === "spacing") && "unit" in t ? "number" : outer;
      const place = inFiles ? pathInFiles(kind, t) : null;
      const key = place ? place.join("-") : kind === "typography" || kind === "number" || kind === "string" || kind === "composition" ? (repoName ?? cssName(t.name)) : repoKey(kind as SyncKind, t as { name: string; repoName?: string }, prefixes);
      // Only a token the repository has can be looked for in its code, and only once a scan has counted.
      const counted = analysis?.tokenUsage && (repoName || place) && analysis.tokens.some((x) => x.name === key) ? (analysis.tokenUsage[key] ?? { n: 0, files: [] }) : null;
      const use = counted ? { ...counted, components: [...new Set(counted.files.flatMap((f) => componentsIn.get(f) ?? []))] } : null;
      return {
        variable: place ? place.join("-") : repoName ?? null,
        id: t.id, kind, name: t.name, group: (t as { group?: string }).group || DEFAULT_GROUP,
        text: searchText(kind, t, themes, data), linked: !!repoName || (!!place && !!analysis?.tokens.some((x) => x.name === key)), changed: changed.has(place ? place.join(".") : key), readonly: key in readonlyBy, token: t, use, unused: use?.n === 0,
        differs: kind === "color" && themes.length > 1 && new Set(themes.map((th) => { const c = t as ColorToken; return hexOf(c.themeValues[th.id] ?? c.value).toLowerCase(); })).size > 1,
      };
    }),
    [list, setId, kind, changed, readonlyBy, themes, analysis, componentsIn, prefixes, data, inFiles]
  );
}

// What a token is called, and where it is when that isn't where its name puts it, once it is at `place` in the files.
export function nameAtPlace(kind: TokenKind, t: Token, place: string[]): { name: string; repoName: string | undefined } {
  const name = place.length > 1 ? place[place.length - 1] : place[0];
  const natural = pathInFiles(kind, { ...t, name, repoName: undefined } as Token);
  return { name, repoName: natural && natural.join(".") === place.join(".") ? undefined : repoNameOfPlace(place) };
}
