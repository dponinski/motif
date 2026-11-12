"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildGraph, type ModuleGraph } from "@/lib/preview/graph";
import { tokenOverrides } from "@/lib/preview/overrides";
import { buildSrcdoc, newNonce, runtimeUrlFor } from "@/lib/preview/srcdoc";
import { readMotifTokens } from "@/lib/token-sync/doc";
import { useDesignSystemStore } from "@/store/design-system";
import { useGitStore } from "@/store/git";
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
        if (source.tailwindVersion === 3) throw new Unsupported("This repository uses Tailwind v3, which can't be previewed yet");
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
export function useTokenOverrides(repo: string | null): { css: string; changed: string[]; shown: string } {
  const link = useGitStore((s) => s.tokenLink);
  const motifTokens = usePreviewStore((s) => s.motifTokens);
  const { colors, spacing, radii, shadows } = useDesignSystemStore();
  const motif = useMemo(
    () => (link && repo && link.repo === repo ? tokenOverrides(readMotifTokens({ colors, spacing, radii, shadows }, link), link.base, link.baseTheme, Object.keys(link.themes)) : { css: "", changed: [] as string[] }),
    [link, repo, colors, spacing, radii, shadows]
  );
  return { ...motif, shown: motifTokens ? motif.css : "" };
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
