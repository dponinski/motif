"use client";

import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, ExternalLink, GitPullRequest, HelpCircle, Layers, Loader2, Moon, MousePointer2, Palette, Play, Redo2, Sun, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildGraph } from "@/lib/preview/graph";
import { parseMotifKey } from "@/lib/edit/instrument";
import { findExamples, type ExampleIndex, type RepoExample } from "@/lib/preview/examples";
import { rescanComponent } from "@/lib/preview/rescan";
import { initialProps, variantCombinations } from "@/lib/preview/props";
import { isFromPreview, type ModulesMessage, type RenderItem, type ToPreview } from "@/lib/preview/protocol";
import { esmUrl } from "@/lib/preview/srcdoc";
import type { LibraryComponent } from "@/lib/preview/library";
import { repoSlug, useGitStore, type GitConnection } from "@/store/git";
import { changedFiles, createdTexts, useEditStore } from "@/store/edit";
import { activeComponent, useLibraryStore, type LibrarySource } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import { useNavRequest } from "@/store/nav";
import { useWorkRuntime } from "@/store/work";
import { useTokenChanges } from "@/components/work/useWork";
import { plan, waitingCount } from "@/lib/work/sync";
import { errorMessage, useGitHost } from "@/components/git/hooks";
import StageCanvas from "./StageCanvas";
import { BREAKPOINTS, BreakpointBar, ZoomSync } from "./Frame";
import PreviewFrame from "./PreviewFrame";
import ElementMenu from "./ElementMenu";
import Tour, { useTour } from "./Tour";
import InsertPalette, { type PaletteItem } from "./InsertPalette";
import { useCanvasActions } from "./useCanvasActions";
import { useElementEdit } from "@/components/panels/useElementEdit";
import Tip, { MOD } from "@/components/Tip";
import { loadTree, useSrcdoc, useTokenOverrides, type Host } from "./preview-core";
import { readerFor, versionOf } from "./reader";

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
  const main = useSrcdoc(true, component.file, source, host, (paths) => buildGraph({ reader, entry: component.file, paths, instrument: true, overlay: createdTexts(useEditStore.getState()), ...graphInput }));
  useEffect(() => { useEditStore.getState().adopt(`${source.repo}@${source.branch}`); }, [source]);

  // What can be done to the picked element, by the inspector or on the canvas (handles, keys, the right-click menu).
  const [editError, setEditError] = useState<string | null>(null);
  const edit = useElementEdit(component, source, connection);
  const actions = useCanvasActions(component, source, edit, setEditError);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // An element dragged from the palette over the page: where the page says it would go, and what follows the pointer.
  const probe = useRef<{ key: string | null; position: string | null }>({ key: null, position: null });
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const library = useLibraryStore((s) => s.components);

  const examples = useExamples(component, source, host);
  const overrides = usePreviewStore((s) => s.values[component.id]);
  const { dark, width, compare, mode: wanted, motifTokens, setDark, setWidth, setCompare, setMode, setMotifTokens } = usePreviewStore(useShallow((s) => ({ dark: s.dark, width: s.width, compare: s.compare, mode: s.mode, motifTokens: s.motifTokens, setDark: s.setDark, setWidth: s.setWidth, setCompare: s.setCompare, setMode: s.setMode, setMotifTokens: s.setMotifTokens })));
  const mode = wanted === "examples" && !examples.list.length ? "edit" : wanted;
  const exampleDoc = useSrcdoc(mode === "examples", `examples:${component.id}`, source, host, (paths) =>
    buildGraph({
      reader, entry: examples.list[0].path, extraEntries: examples.list.slice(1).map((e) => e.path),
      overlay: Object.fromEntries(examples.list.map((e) => [e.path, e.code])), paths, ...graphInput,
    }));
  const { srcdoc, unsupported, error } = mode === "examples" ? exampleDoc : main;

  // What Motif has changed in its tokens since the last sync, shown on the repository's own components.
  const motif = useTokenOverrides(source.repo);
  const overridesCss = motif.shown;
  const themeCss = motif.theme;

  // The previews on the canvas: one, or several at different widths. What is sent to "the preview" goes to each of them.
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const register = useCallback((id: string, element: HTMLIFrameElement | null) => { if (element) frames.current.set(id, element); else frames.current.delete(id); }, []);
  const post = (message: ToPreview) => frames.current.forEach((el) => el.contentWindow?.postMessage(message, "*"));
  const frameOf = (source: MessageEventSource | null) => [...frames.current.values()].find((el) => el.contentWindow === source) ?? null;
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // While the edge of the frame is being dragged, the canvas keeps its view.
  const [resizing, setResizing] = useState(false);

  useEffect(() => { setReady(false); setRendered(false); setRuntimeError(null); }, [srcdoc]);
  const onReady = useCallback(() => setReady(true), []);
  const onRendered = useCallback(() => setRendered(true), []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameOf(event.source);
      if (!frame || !isFromPreview(event.data)) return;
      const data = event.data;
      // What is sent back goes to the page that asked.
      const reply = (message: ToPreview) => frame.contentWindow?.postMessage(message, "*");
      if (data.type === "select") {
        const picked = parseMotifKey(data.key);
        // Clicking the canvas takes the keyboard from whatever had it (a list button would otherwise get the Enter and arrows).
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
        if (picked) useEditStore.getState().select(picked);
      } else if (data.type === "error") setRuntimeError(data.message);
      else if (data.type === "dragging") setResizing(data.on);
      else if (data.type === "dropTarget") probe.current = { key: data.key, position: data.position };
      else if (data.type === "move") void actionsRef.current.moveTo(data.key, data.target, data.position);
      else if (data.type === "textEdit") {
        // A double click: if the element's text is something that can be typed in, the page turns it into a field.
        void actionsRef.current.canEditText(data.key).then((yes) => { if (yes) reply({ type: "textEditStart", key: data.key }); });
      } else if (data.type === "text") void actionsRef.current.commitText(data.key, data.value);
      else if (data.type === "gesture") {
        // A handle was let go: what it asks for is made an edit, and the page is told whether the source changed.
        const tell = (changed: boolean) => reply({ type: "gestureEnd", changed });
        void actionsRef.current.applyGesture(data.key, data.edits).then(tell, () => tell(false));
      } else if (data.type === "key") void actionsRef.current.onKey(data);
      else if (data.type === "menu") {
        const picked = parseMotifKey(data.key);
        if (!picked) return;
        useEditStore.getState().select(picked);
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
        // The page's own pixels, on a canvas that may be zoomed.
        const box = frame.getBoundingClientRect();
        const scale = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
        setMenu({ x: box.left + data.clientX * scale, y: box.top + data.clientY * scale });
      }
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


  // ── Editing ────────────────────────────────────────────────────────────────
  // Design and Variants are both a canvas to work on: in Variants the same element is picked in every variant, and one edit changes them all.
  const editing = mode === "edit" || mode === "variants";
  const selection = useEditStore((s) => s.selection);
  const revision = useEditStore((s) => s.revision);
  const canUndo = useEditStore((s) => s.index > 0);
  const canRedo = useEditStore((s) => s.index < s.history.length - 1);
  const changed = useEditStore((s) => changedFiles(s).length);

  // Files that were edited earlier (maybe before a reload) and that the repository has changed since, which can't be
  // sent without losing the repository's change. Found by the editor (components/work/useWork.ts).
  const stale = useWorkRuntime((s) => s.stale);
  const work = useGitStore((s) => s.work ?? null);
  const tokenChanges = useTokenChanges().length;
  const waiting = useEditStore((s) => { const p = plan(changedFiles(s).map((f) => ({ path: f.path, before: f.before, after: f.after, sha: f.sha })), work); return waitingCount(p); }) + tokenChanges;

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

  // How far the canvas is zoomed, for the page to draw its handles by.
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);
  const onZoom = useCallback((z: number) => { zoomRef.current = z; setZoom(z); }, []);

  // Which element is selected, and whether clicking picks one.
  const tour = useTour(rendered && mode === "edit");
  const selectedKey = editing && selection ? `${selection.path}|${selection.start}` : null;

  // An edit changes the source of some modules; the preview runs the new code without loading again.
  const sent = useRef<Record<string, string>>({});
  const sentCss = useRef<Record<string, string>>({});
  const loaded = useRef(new Set<string>());
  const patched = useRef(false);
  // Everything that was sent to the pages, so that one opened later (another size added to the canvas) can be brought up to date.
  const patchedModules = useRef<ModulesMessage["modules"]>({});
  const patchedCss = useRef<Record<string, string>>({});
  const patchedExternals = useRef<Record<string, string>>({});
  const catchUp = useCallback((): ToPreview[] => {
    const out: ToPreview[] = [];
    if (Object.keys(patchedCss.current).length > 0) out.push({ type: "css", files: { ...patchedCss.current } });
    if (Object.keys(patchedModules.current).length > 0) out.push({ type: "modules", modules: { ...patchedModules.current }, externals: { ...patchedExternals.current } });
    return out;
  }, []);
  useEffect(() => {
    patchedModules.current = {};
    patchedCss.current = {};
    patchedExternals.current = {};
    sent.current = Object.fromEntries(Object.entries(main.graph?.modules ?? {}).map(([p, m]) => [p, m.code]));
    sentCss.current = Object.fromEntries((main.graph?.css ?? []).map((c) => [c.path, c.text]));
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
        // Stylesheets that changed, or that a new module brought along, are replaced on the page before it renders again.
        const styles = Object.fromEntries(graph.css.filter((c) => sentCss.current[c.path] !== c.text).map((c) => [c.path, c.text]));
        setEditError(null);
        if (Object.keys(styles).length > 0) {
          patched.current = true;
          Object.assign(sentCss.current, styles);
          Object.assign(patchedCss.current, styles);
          post({ type: "css", files: styles });
        }
        if (Object.keys(modules).length === 0) return;
        patched.current = true;
        for (const [p, m] of Object.entries(modules)) sent.current[p] = m.code;
        // An inserted component can bring packages the page hasn't loaded.
        const externals = Object.fromEntries(graph.bare.filter((spec) => !loaded.current.has(spec)).map((spec) => [spec, esmUrl(spec, graph.deps)]));
        for (const spec of Object.keys(externals)) loaded.current.add(spec);
        Object.assign(patchedModules.current, modules);
        Object.assign(patchedExternals.current, externals);
        post({ type: "modules", modules, externals });
      } catch (err) {
        if (!stale) setEditError(errorMessage(err));
      }
    }, 80);
    return () => { stale = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, revision, main.graph]);

  // Ctrl/Cmd+Z steps back through the changes made here, in Edit mode or not: the assistant can make some too.
  useEffect(() => {
    if (!editing && !canUndo && !canRedo) return;
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
  }, [editing, canUndo, canRedo]);

  // The width of the frame: the one chosen, or the one the view calls for.
  const frameWidth = width ?? (mode === "variants" || mode === "examples" ? 960 : 640);
  // Several sizes side by side, in Design and Preview: each is the same component, and an edit made in one shows in all.
  const sizes = compare && (mode === "edit" || mode === "playground") ? compare : null;

  // Dragging an element from the palette over the page. The palette's button keeps the pointer, so the moves and the release come here
  // even while the pointer is over the page; the page is asked where the element would go, and draws a line there.
  const startPaletteDrag = (item: PaletteItem) => {
    probe.current = { key: null, position: null };
    setResizing(true);
    // The page the pointer is over (there can be several), and where in it, in the page's own pixels.
    const toPage = (e: PointerEvent) => {
      for (const frame of frames.current.values()) {
        const box = frame.getBoundingClientRect();
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) continue;
        const scale = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
        return { frame, x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
      }
      return null;
    };
    const move = (e: PointerEvent) => {
      setGhost({ x: e.clientX, y: e.clientY, label: item.label });
      const at = toPage(e);
      // The pages the pointer is not over lose their line.
      frames.current.forEach((el) => { if (el !== at?.frame) el.contentWindow?.postMessage({ type: "dropEnd" } satisfies ToPreview, "*"); });
      if (at) at.frame.contentWindow?.postMessage({ type: "dropProbe", x: at.x, y: at.y } satisfies ToPreview, "*");
      else probe.current = { key: null, position: null };
    };
    const finish = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setGhost(null);
      setResizing(false);
      const target = probe.current;
      post({ type: "dropEnd" });
      if (e.type === "pointerup" && target.key) void actionsRef.current.insertAtKey(item, target.key, target.position);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  // The keys of editing, when nothing has the focus (with the focus in the page they come from it as messages instead). A key that
  // belongs to a field, a list or a menu is left to it.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== document.body || !useEditStore.getState().selection) return;
      const mod = e.metaKey || e.ctrlKey;
      const keys = ["Delete", "Backspace", "Escape", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!(keys.includes(e.key) || (mod && /^[dcxv]$/i.test(e.key)))) return;
      e.preventDefault();
      void actionsRef.current.onKey(e);
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
          {([["edit", "Design", MousePointer2], ["playground", "Preview", Play], ["variants", "Variants", Layers], ["examples", "Examples", BookOpen]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              disabled={(id === "variants" && component.variants.length === 0) || (id === "examples" && examples.list.length === 0)}
              title={id === "edit" ? "Select and change elements" : id === "playground" ? "Use the component: clicks reach it" : id === "variants" ? "Every variant side by side: an edit changes them all" : examples.loading ? "Looking for examples in the repository…" : examples.list.length ? "How the repository uses this component" : "No examples found in the repository's demo files"}
              className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-40", mode === id ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}
            >
              <Icon size={11} /> {label}{id === "examples" && examples.list.length > 0 && <span className="text-text-tertiary"> {examples.list.length}</span>}
            </button>
          ))}
        </div>

        {editing && <InsertPalette components={library.filter((c) => c.id !== component.id)} onInsert={(item) => void actionsRef.current.insertItem(item)} onDrag={startPaletteDrag} />}

        {(editing || canUndo || canRedo) && (
          <div className="flex items-center gap-0.5">
            <Tip label="Undo" shortcut={`${MOD}Z`}><button onClick={() => useEditStore.getState().undo()} disabled={!canUndo} aria-label="Undo" className="tool-btn !h-7 !w-7 disabled:opacity-30"><Undo2 size={13} /></button></Tip>
            <Tip label="Redo" shortcut={`⇧${MOD}Z`}><button onClick={() => useEditStore.getState().redo()} disabled={!canRedo} aria-label="Redo" className="tool-btn !h-7 !w-7 disabled:opacity-30"><Redo2 size={13} /></button></Tip>
          </div>
        )}
        {(changed > 0 || work || tokenChanges > 0) && (
          <button
            onClick={() => useNavRequest.getState().ask("sync")}
            aria-label="Sync"
            title={waiting > 0 ? `${waiting} file${waiting === 1 ? "" : "s"} waiting. Open the Sync panel.` : "Everything is in the pull request. Open the Sync panel."}
            className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors", waiting > 0 ? "bg-accent text-white hover:bg-accent/90" : "bg-surface-subtle text-text-secondary hover:bg-surface-border")}
          >
            <GitPullRequest size={11} /> {waiting > 0 ? `Sync (${waiting})` : "Synced"}
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

        {mode === "edit" && <Tip label="Show the tour"><button onClick={tour.start} aria-label="Show the tour" className="tool-btn !h-7 !w-7"><HelpCircle size={13} /></button></Tip>}
        <button onClick={() => setDark(!dark)} className="tool-btn !h-7 !w-7" title={dark ? "Switch to light" : "Switch to dark"} aria-label={dark ? "Light theme" : "Dark theme"}>
          {dark ? <Moon size={13} /> : <Sun size={13} />}
        </button>
      </div>

      {stale.length > 0 && (
        <div role="alert" className="flex flex-shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-500">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={stale.join(", ")}>
            {stale.length === 1 ? `${stale[0]} has changed in the repository since you edited it.` : `${stale.length} edited files have changed in the repository since you edited them.`} They aren&apos;t sent until you give up those edits.
          </span>
          <button
            onClick={() => { useEditStore.getState().discard(stale); useLibraryStore.getState().dropDrafts(stale); }}
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
            resetKey={`${component.id}|${mode === "edit" || mode === "playground" ? "one" : mode}|${sizes ? sizes.join("+") : width ?? "auto"}`}
            freeze={resizing}
            overlay={
              <>
                {!rendered && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-text-tertiary">
                    <Loader2 size={16} className="animate-spin" />
                    {srcdoc ? "Loading packages…" : `Reading ${component.name} from ${source.repo}…`}
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                  <BreakpointBar width={width} onChange={setWidth} compare={mode === "edit" || mode === "playground" ? compare : undefined} onCompare={setCompare} />
                </div>
                {editing && !selection && rendered && (
                  <p data-canvas-hint className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-2xs text-text-tertiary">
                    {mode === "variants" ? "Click an element to style it in every variant" : "Click an element to style it"} · scroll to pan · Ctrl or ⌘ and scroll to zoom
                  </p>
                )}
                <div className="pointer-events-none absolute inset-x-3 top-14 flex flex-col gap-2">
                  {editError && <p className="pointer-events-auto break-words rounded border border-red-400/30 bg-red-400/10 px-3 py-2 font-mono text-2xs text-red-400">The edit can&apos;t run: {editError}</p>}
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
              <div data-frames className="flex items-start gap-12">
                <ZoomSync onZoom={onZoom} />
                {(sizes ?? [null]).map((w) => {
                  const bp = w === null ? null : BREAKPOINTS.find((b) => b.value === w);
                  return (
                    <PreviewFrame
                      key={w ?? "main"}
                      id={String(w ?? "main")}
                      name={bp ? `${component.name} · ${bp.label}` : component.name}
                      srcdoc={srcdoc}
                      width={w ?? frameWidth}
                      chosen={w !== null || width !== null}
                      dark={dark}
                      items={items}
                      layout={layout}
                      overrides={overridesCss}
                      theme={themeCss}
                      editing={editing}
                      selectedKey={selectedKey}
                      file={component.file}
                      revision={revision}
                      zoom={zoom}
                      catchUp={catchUp}
                      register={register}
                      onReady={onReady}
                      onRendered={onRendered}
                      onResize={w === null ? setWidth : undefined}
                      onResizing={w === null ? setResizing : undefined}
                    />
                  );
                })}
              </div>
            )}
          </StageCanvas>
        )}
      </div>
      {ghost && <div className="pointer-events-none fixed z-[80] rounded bg-accent px-2 py-1 text-xs font-medium text-white shadow-lg" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>{ghost.label}</div>}
      {tour.open && mode === "edit" && rendered && <Tour onClose={tour.close} />}
      {menu && <ElementMenu point={menu} info={edit.info} canPaste={actions.canPaste()} actions={actions.act} onClose={() => setMenu(null)} />}
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
