"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, ExternalLink, Layers, Loader2, Moon, Palette, Play, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildGraph, type ModuleGraph } from "@/lib/preview/graph";
import { findExamples, type ExampleIndex, type RepoExample } from "@/lib/preview/examples";
import { tokenOverrides } from "@/lib/preview/overrides";
import { readMotifTokens } from "@/lib/token-sync/doc";
import { initialProps, variantCombinations } from "@/lib/preview/props";
import { isFromPreview, type RenderItem, type ToPreview } from "@/lib/preview/protocol";
import { buildSrcdoc, newNonce, runtimeUrlFor } from "@/lib/preview/srcdoc";
import type { LibraryComponent } from "@/lib/preview/library";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { useDesignSystemStore } from "@/store/design-system";
import { useLibraryStore, type LibrarySource } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import { errorMessage, useGitHost } from "@/components/git/hooks";

const WIDTHS: { label: string; value: number | null }[] = [
  { label: "Fit", value: null },
  { label: "375", value: 375 },
  { label: "768", value: 768 },
  { label: "1024", value: 1024 },
];

// Reading a repository is the slow part, so file lists and graphs are kept for as long as the import is current.
const trees = new Map<string, Promise<string[]>>();
const graphs = new Map<string, Promise<ModuleGraph>>();
const exampleIndexes = new Map<string, Promise<ExampleIndex>>();

class Unsupported extends Error {}

type Host = ReturnType<typeof useGitHost>;
type Doc = { srcdoc: string | null; unsupported: string[]; error: string | null };
const EMPTY: Doc = { srcdoc: null, unsupported: [], error: null };

const versionOf = (source: LibrarySource) => `${source.repo}@${source.branch}#${source.importedAt}`;

function loadTree(source: LibrarySource, host: Host): Promise<string[]> {
  const key = versionOf(source);
  if (!trees.has(key)) trees.set(key, host.listTree(source.branch).then((t) => t.paths));
  return trees.get(key)!;
}

// Builds a page for a module graph. `key` says what the graph is of; `enabled` lets a page wait until it is wanted.
function useSrcdoc(enabled: boolean, key: string, source: LibrarySource, host: Host, make: (paths: string[]) => Promise<ModuleGraph>): Doc {
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
        if (!stale) setState({ srcdoc, unsupported: [], error: null });
      } catch (err) {
        trees.delete(versionOf(source));
        graphs.delete(graphKey);
        if (stale) return;
        if (err instanceof Unsupported) setState({ srcdoc: null, unsupported: (err as Unsupported & { reasons?: string[] }).reasons ?? [err.message], error: null });
        else setState({ srcdoc: null, unsupported: [], error: errorMessage(err) });
      }
    })();
    return () => { stale = true; };
  }, [enabled, key, source, host]);

  return state;
}

// How the repository itself uses the component, from its demo files. Optional: a failure just means no examples.
function useExamples(component: LibraryComponent, source: LibrarySource, host: Host): { list: RepoExample[]; loading: boolean } {
  const [state, setState] = useState<{ list: RepoExample[]; loading: boolean }>({ list: [], loading: true });
  useEffect(() => {
    let stale = false;
    setState({ list: [], loading: true });
    const key = versionOf(source);
    (async () => {
      try {
        if (!exampleIndexes.has(key)) {
          const components = useLibraryStore.getState().components;
          exampleIndexes.set(key, loadTree(source, host).then((paths) => findExamples({ reader: host, ref: source.branch, paths, components })));
        }
        const index = await exampleIndexes.get(key)!;
        if (!stale) setState({ list: index[component.id] ?? [], loading: false });
      } catch {
        exampleIndexes.delete(key);
        if (!stale) setState({ list: [], loading: false });
      }
    })();
    return () => { stale = true; };
  }, [component.id, source, host]);
  return state;
}

function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      {icon}
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <div className="max-w-md text-xs leading-relaxed text-text-secondary">{children}</div>
    </div>
  );
}

function Stage({ component, source, connection }: { component: LibraryComponent; source: LibrarySource; connection: GitConnection }) {
  const host = useGitHost(connection);
  const graphInput = { repo: source.repo, ref: source.branch, tailwindEntry: source.tailwindEntry, tailwindVersion: source.tailwindVersion, styleFiles: source.styleFiles };
  const main = useSrcdoc(true, component.file, source, host, (paths) => buildGraph({ reader: host, entry: component.file, paths, ...graphInput }));

  const examples = useExamples(component, source, host);
  const overrides = usePreviewStore((s) => s.values[component.id]);
  const { dark, width, mode: wanted, motifTokens, setDark, setWidth, setMode, setMotifTokens } = usePreviewStore();
  const mode = wanted === "examples" && !examples.list.length ? "playground" : wanted;
  const exampleDoc = useSrcdoc(mode === "examples", `examples:${component.id}`, source, host, (paths) =>
    buildGraph({
      reader: host, entry: examples.list[0].path, extraEntries: examples.list.slice(1).map((e) => e.path),
      overlay: Object.fromEntries(examples.list.map((e) => [e.path, e.code])), paths, ...graphInput,
    }));
  const { srcdoc, unsupported, error } = mode === "examples" ? exampleDoc : main;

  // What Motif has changed in its tokens since the last sync, shown on the repository's own components.
  const link = useGitStore((s) => s.tokenLink);
  const { colors, spacing, radii, shadows } = useDesignSystemStore();
  const motif = useMemo(
    () => (link && link.repo === source.repo ? tokenOverrides(readMotifTokens({ colors, spacing, radii, shadows }, link), link.base, link.baseTheme, Object.keys(link.themes)) : { css: "", changed: [] as string[] }),
    [link, source.repo, colors, spacing, radii, shadows]
  );
  const overridesCss = motifTokens ? motif.css : "";

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const renderId = useRef(0);
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [height, setHeight] = useState(120);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => { setReady(false); setRendered(false); setRuntimeError(null); }, [srcdoc]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isFromPreview(event.data)) return;
      if (event.data.type === "ready") setReady(true);
      else if (event.data.type === "rendered") { setRendered(true); setHeight(event.data.height); }
      else setRuntimeError(event.data.message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const exportName = component.exported === "default" ? "default" : component.name;
  const props = useMemo(() => ({ ...initialProps(component), ...(overrides ?? {}) }), [component, overrides]);
  const variants = useMemo(() => variantCombinations(component, props), [component, props]);
  const items: RenderItem[] = useMemo(
    () => mode === "examples"
      ? examples.list.map((e) => ({ key: e.id, label: `${e.title}  ·  ${e.file}:${e.line}`, path: e.path, exportName: "default", props: {} }))
      : mode === "variants" && component.variants.length > 0
        ? variants.combinations.map((c) => ({ key: c.key, label: c.label, path: component.file, exportName, props: c.props }))
        : [{ key: "main", path: component.file, exportName, props }],
    [mode, examples.list, component, variants, exportName, props]
  );
  const layout = mode === "examples" ? "stack" : items.length > 1 ? "grid" : "single";

  useEffect(() => {
    if (!ready) return;
    const message: ToPreview = { type: "render", id: ++renderId.current, items, layout, dark, overrides: overridesCss };
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }, [ready, items, layout, dark, overridesCss]);

  const githubUrl = `https://github.com/${source.repo}/blob/${source.branch}/${component.file}#L${component.line}`;

  return (
    <div className="flex h-full flex-col bg-surface-base">
      <div className="flex h-10 flex-shrink-0 items-center gap-3 border-b border-surface-border bg-surface-raised px-3">
        <span className="text-sm font-medium text-text-primary">{component.name}</span>
        <a href={githubUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 truncate font-mono text-2xs text-text-tertiary hover:text-text-secondary">
          {component.file}:{component.line} <ExternalLink size={9} className="flex-shrink-0" />
        </a>
        <div className="flex-1" />

        <div className="flex items-center gap-0.5 rounded bg-surface-subtle p-0.5">
          {([["playground", "Playground", Play], ["variants", "All variants", Layers], ["examples", "Examples", BookOpen]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              disabled={(id === "variants" && component.variants.length === 0) || (id === "examples" && examples.list.length === 0)}
              title={id === "examples" ? (examples.loading ? "Looking for examples in the repository…" : examples.list.length ? "How the repository uses this component" : "No examples found in the repository's demo files") : undefined}
              className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-40", mode === id ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}
            >
              <Icon size={11} /> {label}{id === "examples" && examples.list.length > 0 && <span className="text-text-tertiary"> {examples.list.length}</span>}
            </button>
          ))}
        </div>

        {motif.changed.length > 0 && (
          <button
            onClick={() => setMotifTokens(!motifTokens)}
            aria-pressed={motifTokens}
            aria-label="Motif token changes"
            title={`${motif.changed.length} token${motif.changed.length === 1 ? "" : "s"} changed in Motif since the last sync: ${motifTokens ? "shown" : "hidden"}. Click to ${motifTokens ? "hide" : "show"}.`}
            className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors", motifTokens ? "bg-accent/15 text-accent" : "bg-surface-subtle text-text-tertiary")}
          >
            <Palette size={11} /> {motif.changed.length}
          </button>
        )}

        <button onClick={() => setDark(!dark)} className="tool-btn !h-7 !w-7" title={dark ? "Switch to light" : "Switch to dark"} aria-label={dark ? "Light theme" : "Dark theme"}>
          {dark ? <Moon size={13} /> : <Sun size={13} />}
        </button>
        <select className="input-sm !w-[72px]" aria-label="Preview width" value={width ?? ""} onChange={(e) => setWidth(e.target.value ? Number(e.target.value) : null)}>
          {WIDTHS.map((w) => <option key={w.label} value={w.value ?? ""}>{w.label}</option>)}
        </select>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {unsupported.length > 0 ? (
          <Notice icon={<AlertTriangle size={20} className="text-amber-500" />} title="This component can't be previewed yet">
            <ul className="list-disc text-left">{unsupported.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="mt-2 text-text-tertiary">Previews work for React with Tailwind v4, plain CSS or CSS-in-JS.</p>
          </Notice>
        ) : error ? (
          <Notice icon={<AlertTriangle size={20} className="text-red-400" />} title="The preview couldn't be built">
            <p className="break-words font-mono text-2xs">{error}</p>
          </Notice>
        ) : (
          <>
            {srcdoc && (
              <div className="flex justify-center p-6">
                <iframe
                  ref={iframeRef}
                  title="Component preview"
                  // Opaque origin: no access to Motif's storage, tokens or cookies.
                  sandbox="allow-scripts"
                  srcDoc={srcdoc}
                  style={{ width: width ?? "100%", height: Math.max(height, 80), maxWidth: "100%" }}
                  className="rounded-lg border border-surface-border bg-white shadow-sm"
                />
              </div>
            )}
            {!rendered && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-text-tertiary">
                <Loader2 size={16} className="animate-spin" />
                {srcdoc ? "Loading packages…" : `Reading ${component.name} from ${source.repo}…`}
              </div>
            )}
            {mode === "examples" && (
              <ul className="mx-6 mb-6 flex flex-col gap-1.5 text-2xs text-text-tertiary">
                {examples.list.filter((e) => e.notes.length > 0).map((e) => (
                  <li key={e.id}>
                    <a href={`https://github.com/${source.repo}/blob/${source.branch}/${e.file}#L${e.line}`} target="_blank" rel="noreferrer" className="font-mono hover:text-text-secondary">{e.file}:{e.line}</a>
                    {" "}as shown here, {e.notes.join("; ")}.
                  </li>
                ))}
              </ul>
            )}
            {runtimeError && <p className="mx-6 mb-6 break-words rounded border border-red-400/30 bg-red-400/10 px-3 py-2 font-mono text-2xs text-red-400">{runtimeError}</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default function ComponentStage() {
  const component = useLibraryStore((s) => s.components.find((c) => c.id === s.activeId));
  const source = useLibraryStore((s) => s.source);
  const connection = useGitStore((s) => s.connection);

  if (!component || !source) return null;
  if (!connection || repoSlug(connection) !== source.repo) {
    return (
      <Notice icon={<AlertTriangle size={20} className="text-amber-500" />} title={`Connect ${source.repo} to preview`}>
        Previews are read from the repository when you open them. Connect it in the Git panel.
      </Notice>
    );
  }
  return <Stage key={component.id} component={component} source={source} connection={connection} />;
}
