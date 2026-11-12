"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Layers, Loader2, Moon, Play, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildGraph, type ModuleGraph } from "@/lib/preview/graph";
import { initialProps, variantCombinations } from "@/lib/preview/props";
import { isFromPreview, type RenderItem, type ToPreview } from "@/lib/preview/protocol";
import { buildSrcdoc, newNonce, runtimeUrlFor } from "@/lib/preview/srcdoc";
import type { LibraryComponent } from "@/lib/preview/library";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
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

class Unsupported extends Error {}

function useGraph(component: LibraryComponent, source: LibrarySource, host: ReturnType<typeof useGitHost>) {
  const [state, setState] = useState<{ srcdoc: string | null; unsupported: string[]; error: string | null }>({ srcdoc: null, unsupported: [], error: null });

  useEffect(() => {
    let stale = false;
    setState({ srcdoc: null, unsupported: [], error: null });
    const version = `${source.repo}@${source.branch}#${source.importedAt}`;

    (async () => {
      try {
        if (source.tailwindVersion === 3) throw new Unsupported("This repository uses Tailwind v3, which can't be previewed yet");
        const treeKey = version;
        if (!trees.has(treeKey)) trees.set(treeKey, host.listTree(source.branch).then((t) => t.paths));
        const paths = await trees.get(treeKey)!;
        const graphKey = `${version}:${component.file}`;
        if (!graphs.has(graphKey)) {
          graphs.set(graphKey, buildGraph({
            reader: host, repo: source.repo, ref: source.branch, entry: component.file, paths,
            tailwindEntry: source.tailwindEntry, tailwindVersion: source.tailwindVersion, styleFiles: source.styleFiles,
          }));
        }
        const graph = await graphs.get(graphKey)!;
        if (graph.unsupported.length) throw Object.assign(new Unsupported("unsupported"), { reasons: graph.unsupported });
        const srcdoc = buildSrcdoc({ graph, tailwindVersion: source.tailwindVersion, runtimeUrl: runtimeUrlFor(window.location.origin), nonce: newNonce() });
        if (!stale) setState({ srcdoc, unsupported: [], error: null });
      } catch (err) {
        trees.delete(version);
        graphs.delete(`${version}:${component.file}`);
        if (stale) return;
        if (err instanceof Unsupported) {
          setState({ srcdoc: null, unsupported: (err as Unsupported & { reasons?: string[] }).reasons ?? [err.message], error: null });
        } else {
          setState({ srcdoc: null, unsupported: [], error: errorMessage(err) });
        }
      }
    })();
    return () => { stale = true; };
  }, [component.file, source, host]);

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
  const { srcdoc, unsupported, error } = useGraph(component, source, host);
  const overrides = usePreviewStore((s) => s.values[component.id]);
  const { dark, width, mode, setDark, setWidth, setMode } = usePreviewStore();

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
    () => mode === "variants" && component.variants.length > 0
      ? variants.combinations.map((c) => ({ key: c.key, label: c.label, path: component.file, exportName, props: c.props }))
      : [{ key: "main", path: component.file, exportName, props }],
    [mode, component, variants, exportName, props]
  );

  useEffect(() => {
    if (!ready) return;
    const message: ToPreview = { type: "render", id: ++renderId.current, items, layout: items.length > 1 ? "grid" : "single", dark, overrides: "" };
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }, [ready, items, dark]);

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
          {([["playground", "Playground", Play], ["variants", "All variants", Layers]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              disabled={id === "variants" && component.variants.length === 0}
              className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-40", mode === id ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}
            >
              <Icon size={11} /> {label}
            </button>
          ))}
        </div>

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
