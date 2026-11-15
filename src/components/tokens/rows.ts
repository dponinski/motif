import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDesignSystemStore, DEFAULT_GROUP, type ColorToken, type RadiusToken, type ShadowToken, type SpacingToken, type TokenKind, type TypographyToken } from "@/store/design-system";
import { useGitStore } from "@/store/git";
import { useTokenChanges } from "@/components/work/useWork";
import { cssName, readRepoTokens } from "@/lib/token-sync/doc";
import { hexOf } from "@/lib/tokens/contrast";

export type Token = ColorToken | TypographyToken | SpacingToken | RadiusToken | ShadowToken;

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
}

function searchText(kind: TokenKind, t: Token, themes: { id: string }[]): string {
  switch (kind) {
    case "color": {
      const c = t as ColorToken;
      return themes.map((th) => { const v = c.themeValues[th.id] ?? c.value; return `${hexOf(v)} ${v} ${c.themeAlias?.[th.id] ?? ""}`; }).join(" ");
    }
    case "spacing": return `${(t as SpacingToken).value}px`;
    case "radius": return `${(t as RadiusToken).value}px`;
    case "shadow": { const s = t as ShadowToken; return `${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}`; }
    case "typography": { const y = t as TypographyToken; return `${y.fontFamily} ${y.fontSize}px ${y.fontWeight} ${y.lineHeight}`; }
  }
}

export function useRows(kind: TokenKind, setId: string, themes: { id: string }[]): Row[] {
  const list = useDesignSystemStore(useShallow((s) => (kind === "color" ? s.colors : kind === "spacing" ? s.spacing : kind === "radius" ? s.radii : kind === "shadow" ? s.shadows : s.typography)));
  const changes = useTokenChanges();
  const analysis = useGitStore((s) => s.analysis);
  const changed = useMemo(() => new Set(changes.map((c) => c.name)), [changes]);
  const readonlyBy = useMemo(() => (analysis ? readRepoTokens(analysis.tokens, analysis.themes).readonly : {}), [analysis]);
  return useMemo(
    () => (list as Token[]).filter((t) => t.setId === setId).map((t) => {
      const repoName = (t as { repoName?: string }).repoName;
      const key = repoName ?? cssName(t.name);
      return {
        id: t.id, kind, name: t.name, group: (t as { group?: string }).group || DEFAULT_GROUP,
        text: searchText(kind, t, themes), linked: !!repoName, changed: changed.has(key), readonly: key in readonlyBy, token: t,
      };
    }),
    [list, setId, kind, changed, readonlyBy, themes]
  );
}
