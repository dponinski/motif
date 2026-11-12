"use client";

import { useRef, useState } from "react";
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
  Plus,
  FolderPlus,
  Component,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCanvasStore,
  type CanvasElement,
  type ComponentDef,
  type ComponentGroup,
  type VariantProp,
} from "@/store/canvas";
import { useLibraryStore } from "@/store/library";
import RepoComponentsSection from "./RepoComponentsSection";

// ── Component Browser ─────────────────────────────────────────────────────────

function ComponentRow({
  def,
  isActive,
  onActivate,
  onRename,
  onDelete,
  onPlaceInstance,
}: {
  def: ComponentDef;
  isActive: boolean;
  onActivate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onPlaceInstance: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(def.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(def.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== def.name) onRename(trimmed);
    setEditing(false);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isActive) {
      startEdit(e);
    } else {
      e.stopPropagation();
      onPlaceInstance();
    }
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors mx-1 rounded",
        isActive
          ? "bg-accent/15 text-accent"
          : "text-text-secondary hover:text-text-primary hover:bg-surface-subtle"
      )}
      onClick={onActivate}
      onDoubleClick={handleDoubleClick}
    >
      <Component
        size={11}
        className={cn("flex-shrink-0", isActive ? "text-accent" : "text-text-tertiary")}
      />

      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 bg-surface-overlay text-xs text-text-primary outline-none rounded px-1 py-0.5 min-w-0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          autoFocus
        />
      ) : (
        <span className="flex-1 text-xs truncate">{def.name}</span>
      )}

      {!editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-overlay text-text-tertiary hover:text-red-400 flex-shrink-0"
          title="Delete component"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}

function GroupRow({
  group,
  expanded,
  onToggle,
  onRename,
  onDelete,
}: {
  group: ComponentGroup;
  expanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(group.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== group.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div
      className="group flex items-center gap-1 px-2 py-1 cursor-pointer text-text-secondary hover:text-text-primary hover:bg-surface-subtle mx-1 rounded transition-colors"
      onClick={onToggle}
      onDoubleClick={startEdit}
    >
      <span className="flex-shrink-0 w-3 flex items-center justify-center">
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </span>
      <Folder size={10} className="flex-shrink-0 text-text-tertiary" />

      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 bg-surface-overlay text-xs text-text-primary outline-none rounded px-1 py-0.5 min-w-0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          autoFocus
        />
      ) : (
        <span className="flex-1 text-xs font-medium truncate">{group.name}</span>
      )}

      {!editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-overlay text-text-tertiary hover:text-red-400 flex-shrink-0"
          title="Delete group"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}

function ComponentsSection() {
  const {
    componentGroups,
    componentDefs,
    activeComponentId,
    setActiveComponent: setActiveInCanvas,
    createComponent,
    deleteComponent,
    renameComponent,
    createGroup,
    deleteGroup,
    renameGroup,
    placeInstance,
  } = useCanvasStore();

  // Opening one of Motif's own components returns from a repository component to the canvas.
  const libraryActive = useLibraryStore((s) => s.activeId !== null);
  const setActiveComponent = (id: string) => {
    useLibraryStore.getState().setActive(null);
    setActiveInCanvas(id);
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (id: string) =>
    setExpandedGroups((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  const isGroupExpanded = (id: string) => expandedGroups[id] !== false;

  const handleCreateComponent = (groupId: string | null = null) => {
    const name = `Component ${componentDefs.length + 1}`;
    const id = createComponent(name, groupId);
    setActiveComponent(id);
  };

  const handleCreateGroup = () => {
    const name = `Group ${componentGroups.length + 1}`;
    createGroup(name);
  };

  const ungrouped = componentDefs.filter((c) => c.groupId === null);

  return (
    <div className="flex flex-col border-b border-surface-border" style={{ height: "240px" }}>
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 h-9 border-b border-surface-border flex-shrink-0">
        <span className="text-xs font-medium text-text-secondary flex-1">Components</span>
        <button
          onClick={handleCreateGroup}
          className="p-1 rounded hover:bg-surface-subtle text-text-tertiary hover:text-text-primary transition-colors"
          title="New group"
        >
          <FolderPlus size={11} />
        </button>
        <button
          onClick={() => handleCreateComponent(null)}
          className="p-1 rounded hover:bg-surface-subtle text-text-tertiary hover:text-text-primary transition-colors"
          title="New component"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Groups */}
        {componentGroups.map((group) => {
          const members = componentDefs.filter((c) => c.groupId === group.id);
          const expanded = isGroupExpanded(group.id);
          return (
            <div key={group.id}>
              <GroupRow
                group={group}
                expanded={expanded}
                onToggle={() => toggleGroup(group.id)}
                onRename={(name) => renameGroup(group.id, name)}
                onDelete={() => deleteGroup(group.id)}
              />
              {expanded &&
                members.map((def) => (
                  <div key={def.id} className="pl-3">
                    <ComponentRow
                      def={def}
                      isActive={!libraryActive && def.id === activeComponentId}
                      onActivate={() => setActiveComponent(def.id)}
                      onRename={(name) => renameComponent(def.id, name)}
                      onDelete={() => deleteComponent(def.id)}
                      onPlaceInstance={() => placeInstance(def.id)}
                    />
                  </div>
                ))}
              {expanded && members.length === 0 && (
                <div className="pl-7 py-1">
                  <button
                    onClick={() => handleCreateComponent(group.id)}
                    className="text-xs text-text-tertiary hover:text-accent transition-colors flex items-center gap-1"
                  >
                    <Plus size={10} /> Add component
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Ungrouped */}
        {ungrouped.map((def) => (
          <ComponentRow
            key={def.id}
            def={def}
            isActive={!libraryActive && def.id === activeComponentId}
            onActivate={() => setActiveComponent(def.id)}
            onRename={(name) => renameComponent(def.id, name)}
            onDelete={() => deleteComponent(def.id)}
            onPlaceInstance={() => placeInstance(def.id)}
          />
        ))}

        {componentDefs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-20 gap-1">
            <span className="text-xs text-text-tertiary">No components yet</span>
          </div>
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
  instance: <Component size={11} />,
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
          isSelected
            ? "bg-accent/20 text-text-primary"
            : "hover:bg-surface-subtle text-text-secondary hover:text-text-primary"
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={handleSelect}
      >
        <span
          className="w-3 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
        >
          {hasChildren ? (expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : null}
        </span>

        <span className={cn("flex-shrink-0", isSelected ? "text-accent" : "text-text-tertiary")}>
          {ELEMENT_ICONS[el.type]}
        </span>

        <span className="flex-1 text-xs truncate ml-1">{el.name}</span>

        <span
          className={cn(
            "flex items-center gap-0.5 opacity-0 group-hover:opacity-100",
            isSelected && "opacity-100"
          )}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              updateElement(id, { visible: el.visible === false ? true : false });
            }}
            className="p-0.5 rounded hover:bg-surface-overlay"
            title={el.visible === false ? "Show" : "Hide"}
          >
            {el.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              updateElement(id, { locked: !el.locked });
            }}
            className="p-0.5 rounded hover:bg-surface-overlay"
            title={el.locked ? "Unlock" : "Lock"}
          >
            {el.locked ? <Lock size={10} /> : <Unlock size={10} />}
          </button>
        </span>
      </div>

      {hasChildren &&
        expanded &&
        el.children?.map((childId) => (
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
      <RepoComponentsSection />
      <LayersSection />
    </aside>
  );
}
