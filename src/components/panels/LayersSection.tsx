"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { elementTree, findNode, pathTo, within, type TreeNode } from "@/lib/edit/tree";
import type { InsertPosition } from "@/lib/edit/insert";
import { moveInFile } from "./fileEdits";
import { describeTag } from "@/lib/edit/names";
import ElementIcon from "./ElementIcon";
import { useEditStore } from "@/store/edit";
import { NO_CONNECTION, useGitStore } from "@/store/git";
import { activeComponent, useLibraryStore } from "@/store/library";
import { useGitHost } from "@/components/git/hooks";
import { readerFor } from "@/components/stage/reader";

type Drop = { start: number; position: InsertPosition };

function Node({ node, depth, selected, open, toggle, pick, press, drop, dragged }: {
  node: TreeNode;
  depth: number;
  selected: number | null;
  open: Set<number>;
  toggle: (start: number) => void;
  pick: (node: TreeNode) => void;
  // A press on the row, which becomes a drag if the pointer moves.
  press: (node: TreeNode, event: React.PointerEvent) => void;
  drop: Drop | null;
  dragged: number | null;
}) {
  const expanded = open.has(node.start);
  return (
    <>
      <div
        className={cn(
          "mx-1 flex items-center rounded text-xs transition-colors",
          selected === node.start ? "bg-accent/15 text-accent" : node.selectable ? "text-text-secondary hover:bg-surface-subtle hover:text-text-primary" : "text-text-tertiary",
          dragged === node.start && "opacity-50",
          drop?.start === node.start && drop.position === "before" && "shadow-[inset_0_2px_0_0_var(--cobalt)]",
          drop?.start === node.start && drop.position === "after" && "shadow-[inset_0_-2px_0_0_var(--cobalt)]",
          drop?.start === node.start && drop.position === "last-child" && "bg-accent/20 outline outline-1 outline-accent"
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        data-layer={node.start}
        data-drop={drop?.start === node.start ? drop.position : undefined}
      >
        <button
          onClick={() => toggle(node.start)}
          disabled={node.children.length === 0}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-text-tertiary disabled:opacity-0"
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <button
          onClick={() => pick(node)}
          onPointerDown={(e) => press(node, e)}
          disabled={!node.selectable}
          title={node.selectable ? undefined : `${node.tag} is another component: open it to edit it`}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left disabled:cursor-default"
        >
          <ElementIcon name={describeTag(node.tag).icon} size={11} className="flex-shrink-0 text-text-tertiary" />
          <span className={cn("flex-shrink-0", node.selectable ? "" : "italic")}>{describeTag(node.tag).kind}</span>
          {node.label && <span className="min-w-0 truncate text-2xs text-text-tertiary">· {node.label}</span>}
          {node.selectable && <span className="ml-auto flex-shrink-0 pl-1 font-mono text-2xs opacity-50">{`<${node.tag}>`}</span>}
        </button>
      </div>
      {expanded && node.children.map((child) => (
        <Node key={child.start} node={child} depth={depth + 1} selected={selected} open={open} toggle={toggle} pick={pick} press={press} drop={drop} dragged={dragged} />
      ))}
    </>
  );
}

// What the open component renders, as a tree: pick an element here or in the preview. Replaces a layer list: the
// structure is the component's own markup, read from its source, and follows every edit.
export default function LayersSection() {
  const component = useLibraryStore(activeComponent);
  const source = useLibraryStore((s) => s.source);
  const connection = useGitStore((s) => s.connection);
  const host = useGitHost(connection ?? NO_CONNECTION);
  const revision = useEditStore((s) => s.revision);
  const selection = useEditStore((s) => s.selection);
  const reader = useMemo(() => (source ? readerFor(source, host) : null), [source, host]);

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  // The component the tree was last opened for, so a new one opens its first level once it has loaded.
  const openedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!component || !reader || !source) { setTree([]); return; }
    let stale = false;
    (async () => {
      try {
        const edits = useEditStore.getState();
        const edited = edits.history[edits.index].texts[component.file];
        const code = edited ?? (await reader.readText(component.file, source.branch));
        if (code === null || code === undefined) throw new Error("not found");
        const next = await elementTree(component.file, code, component.exported === "default" ? "default" : component.name);
        if (stale) return;
        setTree(next);
        setFailed(false);
        if (openedFor.current !== component.id) {
          openedFor.current = component.id;
          setOpen(new Set(next.slice(0, 1).map((n) => n.start)));
        }
      } catch {
        // An edit that doesn't parse yet leaves what was shown.
        if (!stale) setFailed(true);
      }
    })();
    return () => { stale = true; };
  }, [component, reader, source, revision]);

  // A picked element opens the way down to it.
  useEffect(() => {
    if (!selection || selection.path !== component?.file) return;
    const way = pathTo(tree, selection.start);
    if (way.length) setOpen((o) => new Set([...o, ...way.slice(0, -1)]));
  }, [selection, tree, component?.file]);

  // Dragging a row to another place: before or after the row it is over (near its edge), or inside it. Not into itself or what it
  // holds, and not inside a component (which is shown but isn't edited here).
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const press = (node: TreeNode, event: React.PointerEvent) => {
    if (!node.selectable || !component || !source || !reader || event.button !== 0) return;
    const from = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let at: Drop | null = null;
    const target = (e: PointerEvent): Drop | null => {
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-layer]") as HTMLElement | null;
      if (!row) return null;
      const over = findNode(treeRef.current, Number(row.getAttribute("data-layer")));
      const moving = findNode(treeRef.current, node.start);
      if (!over || !moving || within(moving, over.start)) return null;
      const box = row.getBoundingClientRect();
      const f = (e.clientY - box.top) / box.height;
      const position: InsertPosition = over.selectable ? (f < 0.3 ? "before" : f > 0.7 ? "after" : "last-child") : f < 0.5 ? "before" : "after";
      return { start: over.start, position };
    };
    const move = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - from.x, e.clientY - from.y) < 5) return;
      if (!dragging) { dragging = true; setDragged(node.start); }
      at = target(e);
      setDrop(at);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrop(null);
      setDragged(null);
      if (dragging && at) void moveInFile({ file: component.file, branch: source.branch, reader }, node.start, at.start, at.position).catch(() => undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const toggle = (start: number) => setOpen((o) => { const next = new Set(o); if (!next.delete(start)) next.add(start); return next; });
  const pick = (node: TreeNode) => {
    if (!component) return;
    useEditStore.getState().select({ path: component.file, start: node.start });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-tour="layers">
      <div data-bar className="flex h-bar flex-shrink-0 items-center gap-1.5 border-b border-surface-border px-3">
        <Layers size={12} className="text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">Layers</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!component ? (
          <p className="px-3 py-2 text-2xs leading-relaxed text-text-tertiary">Open a component to see its elements here.</p>
        ) : tree.length === 0 ? (
          <p className="px-3 py-2 text-2xs leading-relaxed text-text-tertiary">{failed ? "This file can't be read right now." : "Reading…"}</p>
        ) : (
          tree.map((node) => (
            <Node key={node.start} node={node} depth={0} selected={selection?.path === component.file ? selection.start : null} open={open} toggle={toggle} pick={pick} press={press} drop={drop} dragged={dragged} />
          ))
        )}
      </div>
    </div>
  );
}
