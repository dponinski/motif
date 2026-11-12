"use client";

import { useState } from "react";
import {
  Layers,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Square,
  Circle,
  Type,
  Frame,
  Trash2,
  Copy,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasElement } from "@/store/canvas";

// ── Built-in components (page-list style) ────────────────────────────────────

const BUILT_IN = [
  { name: "Button", category: "UI" },
  { name: "Input", category: "UI" },
  { name: "Badge", category: "UI" },
  { name: "Avatar", category: "UI" },
  { name: "Toggle", category: "UI" },
  { name: "Chip", category: "UI" },
  { name: "Dropdown", category: "UI" },
  { name: "Tooltip", category: "UI" },
  { name: "Card", category: "Layout" },
  { name: "Modal", category: "Layout" },
  { name: "Nav Bar", category: "Navigation" },
  { name: "Tab Bar", category: "Navigation" },
];

function ComponentsSection() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = query
    ? BUILT_IN.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : BUILT_IN;

  const categories = Array.from(new Set(filtered.map((c) => c.category)));

  return (
    <div className="flex flex-col border-b border-surface-border" style={{ height: "240px" }}>
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 h-9 border-b border-surface-border flex-shrink-0">
        <span className="text-xs font-medium text-text-secondary">Components</span>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-surface-subtle border border-surface-border rounded px-2 py-1">
          <Search size={11} className="text-text-tertiary flex-shrink-0" />
          <input
            type="text"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none"
          />
        </div>
      </div>

      {/* Component list */}
      <div className="flex-1 overflow-y-auto">
        {categories.length === 0 ? (
          <div className="flex items-center justify-center h-10">
            <span className="text-xs text-text-tertiary">No results</span>
          </div>
        ) : (
          categories.map((cat) => (
            <div key={cat}>
              <p className="section-title">{cat}</p>
              {filtered
                .filter((c) => c.category === cat)
                .map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setSelected(selected === c.name ? null : c.name)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2",
                      selected === c.name
                        ? "bg-accent/15 text-accent"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-subtle"
                    )}
                  >
                    <Square size={10} className="flex-shrink-0 opacity-50" />
                    {c.name}
                  </button>
                ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Layer tree ────────────────────────────────────────────────────────────────

const ELEMENT_ICONS: Record<CanvasElement["type"], React.ReactNode> = {
  rectangle: <Square size={11} />,
  ellipse: <Circle size={11} />,
  text: <Type size={11} />,
  frame: <Frame size={11} />,
  group: <Layers size={11} />,
};

function LayerItem({ id, depth = 0 }: { id: string; depth?: number }) {
  const { elements, selectedIds, setSelectedIds, updateElement, deleteSelected, duplicateSelected } =
    useCanvasStore();
  const el = elements[id];
  const [expanded, setExpanded] = useState(true);

  if (!el) return null;

  const isSelected = selectedIds.includes(id);
  const hasChildren = el.children && el.children.length > 0;

  const handleSelect = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      setSelectedIds(isSelected ? selectedIds.filter((i) => i !== id) : [...selectedIds, id]);
    } else {
      setSelectedIds([id]);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 px-2 py-1 cursor-pointer rounded mx-1 transition-colors",
          isSelected ? "bg-accent/20 text-text-primary" : "hover:bg-surface-subtle text-text-secondary hover:text-text-primary"
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={handleSelect}
      >
        <span
          className="w-3 flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setExpanded(!expanded); }}
        >
          {hasChildren ? (expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : null}
        </span>

        <span className={cn("flex-shrink-0", isSelected ? "text-accent" : "text-text-tertiary")}>
          {ELEMENT_ICONS[el.type]}
        </span>

        <span className="flex-1 text-xs truncate ml-1">{el.name}</span>

        <span className={cn("flex items-center gap-0.5 opacity-0 group-hover:opacity-100", isSelected && "opacity-100")}>
          <button
            onClick={(e) => { e.stopPropagation(); updateElement(id, { visible: el.visible === false ? true : false }); }}
            className="p-0.5 rounded hover:bg-surface-overlay"
            title={el.visible === false ? "Show" : "Hide"}
          >
            {el.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); updateElement(id, { locked: !el.locked }); }}
            className="p-0.5 rounded hover:bg-surface-overlay"
            title={el.locked ? "Unlock" : "Lock"}
          >
            {el.locked ? <Lock size={10} /> : <Unlock size={10} />}
          </button>
        </span>
      </div>

      {hasChildren && expanded && el.children?.map((childId) => (
        <LayerItem key={childId} id={childId} depth={depth + 1} />
      ))}
    </div>
  );
}

function LayersSection() {
  const { order, selectedIds, deleteSelected, duplicateSelected } = useCanvasStore();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 h-9 border-b border-surface-border flex-shrink-0">
        <Layers size={12} className="text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary flex-1">Layers</span>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-0.5">
            <button onClick={duplicateSelected} className="p-1 rounded hover:bg-surface-subtle text-text-secondary hover:text-text-primary" title="Duplicate">
              <Copy size={11} />
            </button>
            <button onClick={deleteSelected} className="p-1 rounded hover:bg-surface-subtle text-text-secondary hover:text-red-400" title="Delete">
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {order.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-1">
            <Layers size={18} className="text-text-tertiary" />
            <span className="text-xs text-text-tertiary">No elements yet</span>
          </div>
        ) : (
          <div className="py-1">
            {[...order].reverse().map((id) => (
              <LayerItem key={id} id={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LeftPanel() {
  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised overflow-hidden">
      <ComponentsSection />
      <LayersSection />
    </aside>
  );
}
