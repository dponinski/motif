"use client";

import { useState } from "react";
import {
  Layers,
  Component,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasElement } from "@/store/canvas";
import { useDesignSystemStore } from "@/store/design-system";

type Tab = "layers" | "components";

const ELEMENT_ICONS: Record<CanvasElement["type"], React.ReactNode> = {
  rectangle: <Square size={11} />,
  ellipse: <Circle size={11} />,
  text: <Type size={11} />,
  frame: <Frame size={11} />,
  group: <Layers size={11} />,
};

function LayerItem({
  id,
  depth = 0,
}: {
  id: string;
  depth?: number;
}) {
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

  const handleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateElement(id, { visible: el.visible === false ? true : false });
  };

  const handleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateElement(id, { locked: !el.locked });
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
        {/* Expand toggle */}
        <span
          className="w-3 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
        >
          {hasChildren ? (
            expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
          ) : null}
        </span>

        {/* Icon */}
        <span className={cn("flex-shrink-0", isSelected ? "text-accent" : "text-text-tertiary")}>
          {ELEMENT_ICONS[el.type]}
        </span>

        {/* Name */}
        <span className="flex-1 text-xs truncate ml-1">{el.name}</span>

        {/* Actions (shown on hover/selected) */}
        <span className={cn("flex items-center gap-0.5 opacity-0 group-hover:opacity-100", isSelected && "opacity-100")}>
          <button
            onClick={handleVisibility}
            className="p-0.5 rounded hover:bg-surface-overlay"
            title={el.visible === false ? "Show" : "Hide"}
          >
            {el.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
          </button>
          <button
            onClick={handleLock}
            className="p-0.5 rounded hover:bg-surface-overlay"
            title={el.locked ? "Unlock" : "Lock"}
          >
            {el.locked ? <Lock size={10} /> : <Unlock size={10} />}
          </button>
        </span>
      </div>

      {/* Children */}
      {hasChildren && expanded && el.children?.map((childId) => (
        <LayerItem key={childId} id={childId} depth={depth + 1} />
      ))}
    </div>
  );
}

function LayersTab() {
  const { order, elements, selectedIds, deleteSelected, duplicateSelected } =
    useCanvasStore();

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Actions bar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface-border">
          <span className="text-2xs text-text-tertiary flex-1">{selectedIds.length} selected</span>
          <button
            onClick={duplicateSelected}
            className="p-1 rounded hover:bg-surface-subtle text-text-secondary hover:text-text-primary"
            title="Duplicate"
          >
            <Copy size={11} />
          </button>
          <button
            onClick={deleteSelected}
            className="p-1 rounded hover:bg-surface-subtle text-text-secondary hover:text-red-400"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}

      {order.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 gap-2">
          <Layers size={20} className="text-text-tertiary" />
          <span className="text-xs text-text-tertiary">No elements yet</span>
          <span className="text-2xs text-text-tertiary">Use the tools above to draw</span>
        </div>
      ) : (
        <div className="py-1">
          {[...order].reverse().map((id) => (
            <LayerItem key={id} id={id} />
          ))}
        </div>
      )}
    </div>
  );
}

function ComponentsTab() {
  const { components } = useDesignSystemStore();

  const builtIn = [
    { name: "Button", category: "UI", preview: "▸ Button" },
    { name: "Input", category: "UI", preview: "[ Input ]" },
    { name: "Card", category: "Layout", preview: "┌─ Card ─┐" },
    { name: "Badge", category: "UI", preview: "• Badge" },
    { name: "Avatar", category: "UI", preview: "○ Avatar" },
    { name: "Toggle", category: "UI", preview: "● Toggle" },
    { name: "Nav Bar", category: "Navigation", preview: "≡ Nav Bar" },
    { name: "Tab Bar", category: "Navigation", preview: "⊟ Tabs" },
  ];

  const categories = Array.from(new Set(builtIn.map((c) => c.category)));

  return (
    <div className="flex-1 overflow-y-auto">
      {categories.map((cat) => (
        <div key={cat}>
          <p className="section-title">{cat}</p>
          <div className="grid grid-cols-2 gap-1 px-2 pb-2">
            {builtIn
              .filter((c) => c.category === cat)
              .map((c) => (
                <div
                  key={c.name}
                  className="flex flex-col items-center gap-1.5 p-2 rounded border border-surface-border bg-surface-subtle hover:border-accent/40 hover:bg-accent/5 cursor-grab transition-colors"
                  title={`Add ${c.name}`}
                >
                  <span className="text-2xs font-mono text-text-tertiary">{c.preview}</span>
                  <span className="text-xs text-text-secondary">{c.name}</span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LeftPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("layers");

  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-surface-border">
        {(["layers", "components"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-2 text-xs font-medium capitalize transition-colors",
              activeTab === tab
                ? "text-text-primary border-b border-accent"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {tab === "layers" ? (
              <span className="flex items-center justify-center gap-1">
                <Layers size={11} /> Layers
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1">
                <Component size={11} /> Assets
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "layers" ? <LayersTab /> : <ComponentsTab />}
    </aside>
  );
}
