"use client";

import { useEffect, useState } from "react";
import { previewKey, repoKey } from "@/lib/docs";
import { previewPage, type PreviewView } from "@/lib/preview/docs-previews";
import type { LibraryComponent } from "@/lib/preview/library";
import { RUNTIME_PATH } from "@/lib/preview/srcdoc";
import type { LibrarySource } from "@/store/library";
import { errorMessage } from "@/components/git/hooks";
import { cachedGraph, type Host } from "./preview-core";
import { readerFor, versionOf } from "./reader";

// The preview runtime's own code, fetched once, for pages that carry it inside them.
let runtime: Promise<string> | null = null;
const runtimeSource = () => (runtime ??= fetch(RUNTIME_PATH).then((r) => {
  if (!r.ok) throw new Error(`Couldn't load the preview runtime (${r.status})`);
  return r.text();
}).catch((err) => { runtime = null; throw err; }));

const pages = new Map<string, Promise<string>>();

// A page that shows a component by itself, for a documentation page and the site exported from it.
export function previewPageFor(component: LibraryComponent, view: PreviewView, source: LibrarySource, host: Host): Promise<string> {
  const key = `${versionOf(source)}|${previewKey(component, view)}`;
  if (!pages.has(key)) {
    pages.set(key, (async () => {
      if (source.tailwindVersion === 3) throw new Error("This repository uses Tailwind v3, which can't be previewed yet");
      const graph = await cachedGraph(source, host, readerFor(source, host), component.file);
      if (graph.unsupported.length) throw new Error(graph.unsupported[0]);
      return previewPage({ graph, tailwindVersion: source.tailwindVersion, runtimeSource: await runtimeSource(), component, view });
    })().catch((err) => { pages.delete(key); throw err; }));
  }
  return pages.get(key)!;
}

export function usePreviewPage(component: LibraryComponent | undefined, view: PreviewView, source: LibrarySource | null, host: Host | null): { page: string | null; error: string | null } {
  const [state, setState] = useState<{ page: string | null; error: string | null }>({ page: null, error: null });
  useEffect(() => {
    if (!component || !source || !host) { setState({ page: null, error: null }); return; }
    let alive = true;
    setState({ page: null, error: null });
    previewPageFor(component, view, source, host).then(
      (page) => { if (alive) setState({ page, error: null }); },
      (err) => { if (alive) setState({ page: null, error: errorMessage(err) }); }
    );
    return () => { alive = false; };
  }, [component, view, source, host]);
  return state;
}

// Every preview the given blocks need, by `previewKey`. One that can't be built is left out, and the page says so.
export async function buildPreviews(wanted: { component: LibraryComponent; view: PreviewView }[], source: LibrarySource, host: Host): Promise<Record<string, string>> {
  const unique = new Map(wanted.map((w) => [previewKey(w.component, w.view), w]));
  const out: Record<string, string> = {};
  const queue = [...unique];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [key, { component, view }] = next;
      try { out[key] = await previewPageFor(component, view, source, host); } catch { /* left out */ }
    }
  }));
  return out;
}

export const componentKey = repoKey;
