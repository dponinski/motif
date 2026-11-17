"use client";

import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildGraph, type ModuleGraph } from "@/lib/preview/graph";
import { changedValues, channelForms, tailwind3Extend, tokenOverrides } from "@/lib/preview/overrides";
import { buildSrcdoc, newNonce, runtimeUrlFor } from "@/lib/preview/srcdoc";
import { readMotifTokens, resolveInDoc } from "@/lib/token-sync/doc";
import { keyPrefixes } from "@/lib/token-sync/keys";
import { motifOnlyTokens } from "@/lib/edit/motif-tokens";
import type { RepoToken } from "@/lib/repo-scan/types";
import { aliasTarget } from "@/lib/tokens/alias";
import { EMPTY_INDEX, buildTokenIndex, type TokenIndex } from "@/lib/edit/tokens";
import { dtcgOverrides } from "@/lib/dtcg/overrides";
import { toStored } from "@/lib/tokens/migrate";
import { snapshotTokens, useDesignSystemStore } from "@/store/design-system";
import { isDtcgLink, stylesheetLink, useGitStore } from "@/store/git";
import type { LibrarySource } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import { versionOf } from "./reader";

// What the stage and the docs share to run a repository component in a sandboxed page.

// Reading a repository is the slow part, so file lists and graphs are kept for as long as the import is current.
const trees = new Map<string, Promise<string[]>>();
const graphs = new Map<string, Promise<ModuleGraph>>();

export class Unsupported extends Error {}

export type Host = ReturnType<typeof useGitHost>;
export type Doc = { srcdoc: string | null; graph: ModuleGraph | null; unsupported: string[]; error: string | null };
export const EMPTY: Doc = { srcdoc: null, graph: null, unsupported: [], error: null };

export function loadTree(source: LibrarySource, host: Host): Promise<string[]> {
  const key = versionOf(source);
  if (!trees.has(key)) trees.set(key, host.listTree(source.branch).then((t) => t.paths));
  return trees.get(key)!;
}

// Builds a page for a module graph. `key` says what the graph is of; `enabled` lets a page wait until it is wanted.
export function useSrcdoc(enabled: boolean, key: string, source: LibrarySource, host: Host, make: (paths: string[]) => Promise<ModuleGraph>): Doc {
  const [state, setState] = useState<Doc>(EMPTY);
  const makeRef = useRef(make);
  makeRef.current = make;

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    setState(EMPTY);
    const graphKey = `${versionOf(source)}:${key}`;

    (async () => {
      try {
        const paths = await loadTree(source, host);
        if (!graphs.has(graphKey)) graphs.set(graphKey, makeRef.current(paths));
        const graph = await graphs.get(graphKey)!;
        if (graph.unsupported.length) throw Object.assign(new Unsupported("unsupported"), { reasons: graph.unsupported });
        const srcdoc = buildSrcdoc({ graph, tailwindVersion: source.tailwindVersion, runtimeUrl: runtimeUrlFor(window.location.origin), nonce: newNonce() });
        if (!stale) setState({ srcdoc, graph, unsupported: [], error: null });
      } catch (err) {
        trees.delete(versionOf(source));
        graphs.delete(graphKey);
        if (stale) return;
        if (err instanceof Unsupported) setState({ srcdoc: null, graph: null, unsupported: (err as Unsupported & { reasons?: string[] }).reasons ?? [err.message], error: null });
        else setState({ srcdoc: null, graph: null, unsupported: [], error: errorMessage(err) });
      }
    })();
    return () => { stale = true; };
  }, [enabled, key, source, host]);

  return state;
}


// What Motif has changed in its tokens since the last sync, as CSS for a preview, when the user has it switched on.
export function useTokenOverrides(repo: string | null): { css: string; changed: string[]; shown: string; theme: string } {
  const link = useGitStore((s) => stylesheetLink(s.tokenLink));
  const motifTokens = usePreviewStore((s) => s.motifTokens);
  const { colors, spacing, radii, shadows } = useDesignSystemStore(useShallow((s) => ({ colors: s.colors, spacing: s.spacing, radii: s.radii, shadows: s.shadows })));
  const analysis = useGitStore((s) => s.analysis);
  // A repository whose tokens are design tokens files (or about to be): what is shown is what the files would come to with Motif's tokens.
  const files = useGitStore((s) => (isDtcgLink(s.tokenLink) ? s.tokenLink : null));
  const tokens = useDesignSystemStore(useShallow((s) => ({ sets: s.sets, colors: s.colors, typography: s.typography, spacing: s.spacing, radii: s.radii, shadows: s.shadows, numbers: s.numbers, strings: s.strings, compositions: s.compositions })));
  const fromFiles = useMemo(
    () => (files && repo && files.repo === repo ? dtcgOverrides(files, toStored(snapshotTokens({ ...useDesignSystemStore.getState(), ...tokens }))) : null),
    [files, repo, tokens]
  );
  const motif = useMemo(
    () => (link && repo && link.repo === repo
      ? tokenOverrides(readMotifTokens({ colors, spacing, radii, shadows }, analysis ? { ...link, prefixes: keyPrefixes(analysis) } : link), link.base, link.baseTheme, Object.keys(link.themes), analysis?.stack.tailwindVersion === 3 ? channelForms(analysis.tokens) : {})
      : { css: "", changed: [] as string[] }),
    [link, repo, colors, spacing, radii, shadows, analysis]
  );
  // A Tailwind 4 preview has a class for a token the repository doesn't have only when told, in a stylesheet of its own; a Tailwind 3
  // preview, in entries of its config (which also carry the values the repository keeps there).
  const theme = useMemo(() => {
    if (!analysis || !link || !repo || link.repo !== repo) return "";
    const version = analysis.stack.tailwindVersion;
    if (version === 4) return motifOnlyTokens(readMotifTokens({ colors, spacing, radii, shadows }, { ...link, prefixes: keyPrefixes(analysis) }), analysis.tokens, 4).themeCss;
    if (version !== 3) return "";
    const extend = tailwind3Extend(readMotifTokens({ colors, spacing, radii, shadows }, { ...link, prefixes: keyPrefixes(analysis) }), link.base, link.baseTheme, analysis.tokens);
    return Object.keys(extend).length ? JSON.stringify(extend) : "";
  }, [analysis, link, repo, colors, spacing, radii, shadows]);
  if (fromFiles) return { css: fromFiles.css, changed: fromFiles.changed, shown: motifTokens ? fromFiles.css : "", theme: motifTokens ? fromFiles.theme : "" };
  return { ...motif, shown: motifTokens ? motif.css : "", theme: motifTokens ? theme : "" };
}

// The graph of one component, kept for as long as the import is current and shared by everything that shows it.
export function cachedGraph(source: LibrarySource, host: Host, reader: Parameters<typeof buildGraph>[0]["reader"], file: string): Promise<ModuleGraph> {
  const key = `${versionOf(source)}:${file}`;
  if (!graphs.has(key)) {
    const make = componentGraph(host, reader, source, file);
    graphs.set(key, loadTree(source, host).then(make));
  }
  return graphs.get(key)!.catch((err) => { graphs.delete(key); throw err; });
}

// The graph of one component, built for pages that only show it (not edit it).
export function componentGraph(host: Host, reader: Parameters<typeof buildGraph>[0]["reader"], source: LibrarySource, file: string) {
  const graphInput = { repo: source.repo, ref: source.branch, tailwindEntry: source.tailwindEntry, tailwindVersion: source.tailwindVersion, styleFiles: source.styleFiles };
  return (paths: string[]) => buildGraph({ reader, entry: file, paths, instrument: true, ...graphInput });
}

// The repository's tokens, for the controls that assign them: what a class can name, and what each is worth.
// They come from the last scan. With Motif's own changes switched on in previews, a token shows the value the
// preview shows, so a swatch and the component it is used in never disagree.
export function useTokenIndex(repo: string | null): TokenIndex {
  const analysis = useGitStore((s) => s.analysis);
  const link = useGitStore((s) => stylesheetLink(s.tokenLink));
  const motifTokens = usePreviewStore((s) => s.motifTokens);
  const { colors, spacing, radii, shadows } = useDesignSystemStore(useShallow((s) => ({ colors: s.colors, spacing: s.spacing, radii: s.radii, shadows: s.shadows })));
  return useMemo(() => {
    if (!analysis || !repo || analysis.repo !== repo) return EMPTY_INDEX;
    let overrides: Record<string, Record<string, string>> = {};
    let extra: RepoToken[] = [];
    if (link && link.repo === repo) {
      const current = readMotifTokens({ colors, spacing, radii, shadows }, { ...link, prefixes: keyPrefixes(analysis) });
      // The tokens Motif has made and the repository hasn't got yet are offered like any other.
      extra = motifOnlyTokens(current, analysis.tokens, analysis.stack.tailwindVersion).tokens;
    }
    if (motifTokens && link && link.repo === repo) {
      const current = readMotifTokens({ colors, spacing, radii, shadows }, { ...link, prefixes: keyPrefixes(analysis) });
      overrides = changedValues(current, link.base);
      // A color that is another token is shown as the color that comes to.
      for (const [name, byTheme] of Object.entries(overrides)) {
        for (const [theme, value] of Object.entries(byTheme)) {
          if (aliasTarget(value) !== null) byTheme[theme] = resolveInDoc(current, name, theme, link.baseTheme) ?? value;
        }
      }
    }
    // Without Tailwind the tokens are the repository's CSS variables, and a stylesheet's controls offer them by name.
    return buildTokenIndex([...analysis.tokens, ...extra], analysis.themes, analysis.stack.tailwindVersion, overrides, analysis.stack.tailwindVersion === null);
  }, [analysis, repo, link, motifTokens, colors, spacing, radii, shadows]);
}
