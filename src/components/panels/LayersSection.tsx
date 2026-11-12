"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { elementTree, pathTo, type TreeNode } from "@/lib/edit/tree";
import { useEditStore } from "@/store/edit";
import { useGitStore } from "@/store/git";
import { activeComponent, useLibraryStore } from "@/store/library";
import { usePreviewStore } from "@/store/preview";
import { useGitHost } from "@/components/git/hooks";
import { readerFor } from "@/components/stage/reader";

function Node({ node, depth, selected, open, toggle, pick }: {
  node: TreeNode;
  depth: number;
  selected: number | null;
  open: Set<number>;
  toggle: (start: number) => void;
  pick: (node: TreeNode) => void;
}) {
  const expanded = open.has(node.start);
  return (
    <>
      <div
        className={cn(
          "mx-1 flex items-center rounded text-xs transition-colors",
          selected === node.start ? "bg-accent/15 text-accent" : node.selectable ? "text-text-secondary hover:bg-surface-subtle hover:text-text-primary" : "text-text-tertiary"
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        data-layer={node.start}
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
          disabled={!node.selectable}
          title={node.selectable ? undefined : `${node.tag} is another component: open it to edit it`}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left disabled:cursor-default"
        >
          <span className={cn("flex-shrink-0 font-mono text-2xs", node.selectable ? "" : "italic")}>{node.selectable ? `<${node.tag}>` : node.tag}</span>
          {node.label && <span className="truncate text-2xs text-text-tertiary">{node.label}</span>}
        </button>
      </div>
      {expanded && node.children.map((child) => (
        <Node key={child.start} node={child} depth={depth + 1} selected={selected} open={open} toggle={toggle} pick={pick} />
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
  const host = useGitHost(connection ?? { owner: "", repo: "", token: "", defaultBranch: "" });
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

  const toggle = (start: number) => setOpen((o) => { const next = new Set(o); if (!next.delete(start)) next.add(start); return next; });
  const pick = (node: TreeNode) => {
    if (!component) return;
    usePreviewStore.getState().setMode("edit");
    useEditStore.getState().select({ path: component.file, start: node.start });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 flex-shrink-0 items-center gap-1.5 border-b border-surface-border px-3">
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
            <Node key={node.start} node={node} depth={0} selected={selection?.path === component.file ? selection.start : null} open={open} toggle={toggle} pick={pick} />
          ))
        )}
      </div>
    </div>
  );
}
