"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, ExternalLink, GitPullRequest, Layers, Loader2, Moon, Palette, Pencil, Play, Redo2, Sun, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { gitBlobSha } from "@/lib/github";
import { buildGraph } from "@/lib/preview/graph";
import { parseMotifKey } from "@/lib/edit/instrument";
import { findExamples, type ExampleIndex, type RepoExample } from "@/lib/preview/examples";
import { rescanComponent } from "@/lib/preview/rescan";
import { initialProps, variantCombinations } from "@/lib/preview/props";
import { isFromPreview, type RenderItem, type ToPreview } from "@/lib/preview/protocol";
import { esmUrl } from "@/lib/preview/srcdoc";
import type { LibraryComponent } from "@/lib/preview/library";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { changedFiles, useEditStore } from "@/store/edit";
import { activeComponent, useLibraryStore, type LibrarySource } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import EditPrDialog from "./EditPrDialog";
import StageCanvas from "./StageCanvas";
import { loadTree, useSrcdoc, useTokenOverrides, type Host } from "./preview-core";
import { readerFor, versionOf } from "./reader";

// "Auto" is the width the view calls for: a component on its own, or a page of them side by side.
const WIDTHS: { label: string; value: number | null }[] = [
  { label: "Auto", value: null },
  { label: "375", value: 375 },
  { label: "640", value: 640 },
  { label: "768", value: 768 },
  { label: "1024", value: 1024 },
  { label: "1280", value: 1280 },
];

const exampleIndexes = new Map<string, Promise<ExampleIndex>>();

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
  // Shared with the inspector, so a file read for one is not read again for the other.
  const reader = useMemo(() => readerFor(source, host), [source, host]);
  const graphInput = { repo: source.repo, ref: source.branch, tailwindEntry: source.tailwindEntry, tailwindVersion: source.tailwindVersion, styleFiles: source.styleFiles };
  // Elements are marked with where they are in the source, so one can be picked in edit mode.
  const main = useSrcdoc(true, component.file, source, host, (paths) => buildGraph({ reader, entry: component.file, paths, instrument: true, ...graphInput }));
  useEffect(() => { useEditStore.getState().adopt(`${source.repo}@${source.branch}`); }, [source]);

  const examples = useExamples(component, source, host);
  const overrides = usePreviewStore((s) => s.values[component.id]);
  const { dark, width, mode: wanted, motifTokens, setDark, setWidth, setMode, setMotifTokens } = usePreviewStore();
  const mode = wanted === "examples" && !examples.list.length ? "playground" : wanted;
  const exampleDoc = useSrcdoc(mode === "examples", `examples:${component.id}`, source, host, (paths) =>
    buildGraph({
      reader, entry: examples.list[0].path, extraEntries: examples.list.slice(1).map((e) => e.path),
      overlay: Object.fromEntries(examples.list.map((e) => [e.path, e.code])), paths, ...graphInput,
    }));
  const { srcdoc, unsupported, error } = mode === "examples" ? exampleDoc : main;

  // What Motif has changed in its tokens since the last sync, shown on the repository's own components.
  const motif = useTokenOverrides(source.repo);
  const overridesCss = motif.shown;

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
      const data = event.data;
      if (data.type === "ready") setReady(true);
      else if (data.type === "rendered") { setRendered(true); setHeight(data.height); }
      else if (data.type === "select") {
        const picked = parseMotifKey(data.key);
        if (picked) useEditStore.getState().select(picked);
      } else if (data.type === "error") setRuntimeError(data.message);
      // Wheel and Space are for the canvas around the preview, which listens for them itself.
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

  // ── Editing ────────────────────────────────────────────────────────────────
  const editing = mode === "edit";
  const selection = useEditStore((s) => s.selection);
  const revision = useEditStore((s) => s.revision);
  const canUndo = useEditStore((s) => s.index > 0);
  const canRedo = useEditStore((s) => s.index < s.history.length - 1);
  const changed = useEditStore((s) => changedFiles(s).length);
  const [prOpen, setPrOpen] = useState(false);

  // Files that were edited earlier (maybe before a reload) and that the repository has changed since, which a
  // pull request couldn't be made for without losing the repository's change.
  const [stale, setStale] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: string[] = [];
      for (const f of changedFiles(useEditStore.getState())) {
        const text = await reader.readText(f.path, source.branch).catch(() => null);
        if (text === null || (await gitBlobSha(text)) !== f.sha) out.push(f.path);
      }
      if (alive) setStale(out);
    })();
    return () => { alive = false; };
  }, [reader, source.branch, changed]);
  const [editError, setEditError] = useState<string | null>(null);

  // The props and variants shown for a component follow the edits made to its file.
  useEffect(() => {
    let stale = false;
    (async () => {
      const edits = useEditStore.getState();
      const texts = edits.history[edits.index].texts;
      const library = useLibraryStore.getState();
      const original = library.components.find((c) => c.id === component.id);
      if (!original) return;
      if (!(component.file in texts)) { library.setLive(component.id, null); return; }
      try {
        const paths = await loadTree(source, host);
        const next = await rescanComponent({ reader, ref: source.branch, paths, overlay: texts, component: original });
        if (!stale && next) library.setLive(component.id, next);
      } catch { /* an edit that doesn't read yet leaves what was shown */ }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, component.id, component.file]);
  const post = (message: ToPreview) => iframeRef.current?.contentWindow?.postMessage(message, "*");

  // The preview is on a canvas: scrolling, pinching and Space over it move the canvas, not the page inside.
  useEffect(() => {
    if (ready) post({ type: "canvas", on: true });
  }, [ready]);

  // Which element is selected, and whether clicking picks one.
  const selectedKey = editing && selection ? `${selection.path}|${selection.start}` : null;
  useEffect(() => {
    if (ready) post({ type: "edit", on: editing, selected: selectedKey });
  }, [ready, editing, selectedKey, revision]);

  // An edit changes the source of some modules; the preview runs the new code without loading again.
  const sent = useRef<Record<string, string>>({});
  const loaded = useRef(new Set<string>());
  const patched = useRef(false);
  useEffect(() => {
    sent.current = Object.fromEntries(Object.entries(main.graph?.modules ?? {}).map(([p, m]) => [p, m.code]));
    loaded.current = new Set(["react", "react/jsx-runtime", "react-dom", "react-dom/client", ...(main.graph?.bare ?? [])]);
    patched.current = false;
  }, [main.graph]);
  useEffect(() => {
    if (!ready || !main.graph) return;
    const texts = useEditStore.getState().history[useEditStore.getState().index].texts;
    if (Object.keys(texts).length === 0 && !patched.current) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const paths = await loadTree(source, host);
        const graph = await buildGraph({ reader, entry: component.file, paths, instrument: true, overlay: texts, ...graphInput });
        if (stale) return;
        const modules = Object.fromEntries(Object.entries(graph.modules).filter(([p, m]) => sent.current[p] !== m.code));
        setEditError(null);
        if (Object.keys(modules).length === 0) return;
        patched.current = true;
        for (const [p, m] of Object.entries(modules)) sent.current[p] = m.code;
        // An inserted component can bring packages the page hasn't loaded.
        const externals = Object.fromEntries(graph.bare.filter((spec) => !loaded.current.has(spec)).map((spec) => [spec, esmUrl(spec, graph.deps)]));
        for (const spec of Object.keys(externals)) loaded.current.add(spec);
        post({ type: "modules", modules, externals });
      } catch (err) {
        if (!stale) setEditError(errorMessage(err));
      }
    }, 80);
    return () => { stale = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, revision, main.graph]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) useEditStore.getState().redo();
      else useEditStore.getState().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

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
          {([["playground", "Playground", Play], ["variants", "All variants", Layers], ["examples", "Examples", BookOpen], ["edit", "Edit", Pencil]] as const).map(([id, label, Icon]) => (
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

        {(editing || canUndo || canRedo) && (
          <div className="flex items-center gap-0.5">
            <button onClick={() => useEditStore.getState().undo()} disabled={!canUndo} aria-label="Undo" title="Undo" className="tool-btn !h-7 !w-7 disabled:opacity-30"><Undo2 size={13} /></button>
            <button onClick={() => useEditStore.getState().redo()} disabled={!canRedo} aria-label="Redo" title="Redo" className="tool-btn !h-7 !w-7 disabled:opacity-30"><Redo2 size={13} /></button>
          </div>
        )}
        {changed > 0 && (
          <button
            onClick={() => setPrOpen(true)}
            aria-label="Create pull request"
            title={`${changed} file${changed === 1 ? "" : "s"} changed. Open a pull request with the changes.`}
            className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-accent/90"
          >
            <GitPullRequest size={11} /> {changed} {changed === 1 ? "file" : "files"}
          </button>
        )}

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

      {stale.length > 0 && (
        <div role="alert" className="flex flex-shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-500">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={stale.join(", ")}>
            {stale.length === 1 ? `${stale[0]} has changed in the repository since you edited it.` : `${stale.length} edited files have changed in the repository since you edited them.`} A pull request can't be made for them as they are.
          </span>
          <button
            onClick={() => useEditStore.getState().discard(stale)}
            className="flex-shrink-0 rounded border border-amber-500/40 px-2 py-0.5 hover:bg-amber-500/15"
            aria-label="Discard edits to changed files"
          >
            Discard those edits
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
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
          <StageCanvas
            resetKey={`${component.id}|${mode === "edit" || mode === "playground" ? "one" : mode}|${width ?? "auto"}`}
            overlay={
              <>
                {!rendered && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-text-tertiary">
                    <Loader2 size={16} className="animate-spin" />
                    {srcdoc ? "Loading packages…" : `Reading ${component.name} from ${source.repo}…`}
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
                  {editError && <p className="pointer-events-auto break-words rounded border border-red-400/30 bg-red-400/10 px-3 py-2 font-mono text-2xs text-red-400">The edit can't run: {editError}</p>}
                  {runtimeError && <p className="pointer-events-auto break-words rounded border border-red-400/30 bg-red-400/10 px-3 py-2 font-mono text-2xs text-red-400">{runtimeError}</p>}
                </div>
                {mode === "examples" && examples.list.some((e) => e.notes.length > 0) && (
                  <ul className="absolute inset-x-3 bottom-3 ml-24 flex max-h-24 flex-col gap-1 overflow-y-auto rounded bg-surface-raised/90 p-2 text-2xs text-text-tertiary">
                    {examples.list.filter((e) => e.notes.length > 0).map((e) => (
                      <li key={e.id}>
                        <a href={`https://github.com/${source.repo}/blob/${source.branch}/${e.file}#L${e.line}`} target="_blank" rel="noreferrer" className="font-mono hover:text-text-secondary">{e.file}:{e.line}</a>
                        {" "}as shown here, {e.notes.join("; ")}.
                      </li>
                    ))}
                  </ul>
                )}
              </>
            }
          >
            {srcdoc && (
              <iframe
                ref={iframeRef}
                title="Component preview"
                // Opaque origin: no access to Motif's storage, tokens or cookies.
                sandbox="allow-scripts"
                srcDoc={srcdoc}
                // Content-box, so a 768 preview is 768 wide inside its border and a `md:` class applies.
                style={{ display: "block", width: width ?? (mode === "variants" || mode === "examples" ? 960 : 640), height: Math.max(height, 80), boxSizing: width ? "content-box" : "border-box" }}
                className="rounded-lg border border-surface-border bg-white shadow-sm"
              />
            )}
          </StageCanvas>
        )}
      </div>
      <EditPrDialog open={prOpen} onOpenChange={setPrOpen} connection={connection} source={source} subject={component.name} />
    </div>
  );
}

export default function ComponentStage() {
  const component = useLibraryStore(activeComponent);
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
