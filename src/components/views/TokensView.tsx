"use client";

import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Plus, Trash2, ChevronDown, ChevronRight, X, Pencil,
  Download, Upload, Maximize2, Minimize2, Palette,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDesignSystemStore,
  type ColorToken,
  type TypographyToken,
  type SpacingToken,
  type RadiusToken,
  type ShadowToken,
} from "@/store/design-system";

type TokenSection = "colors" | "type" | "spacing" | "radii" | "shadows";

function downloadText(filename: string, content: string) {
  const a = document.createElement("a");
  a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

// ── Editable color group ───────────────────────────────────────────────────────

function EditableColorGroup({ group, tokens }: { group: string; tokens: ColorToken[] }) {
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { updateColor, deleteColor, addColor } = useDesignSystemStore();

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 px-3 py-1.5 w-full text-left hover:bg-surface-subtle"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider capitalize flex-1">{group}</span>
        <span className="text-2xs text-text-tertiary mr-1">({tokens.length})</span>
        <button
          className="p-0.5 rounded hover:bg-surface-overlay text-text-tertiary hover:text-text-primary"
          title="Add color to group"
          onClick={(e) => { e.stopPropagation(); addColor({ name: `${group}-new`, value: "#6366f1", group }); }}
        >
          <Plus size={9} />
        </button>
      </button>

      {expanded && (
        <div className="px-3 pb-2">
          <div className="grid grid-cols-6 gap-1.5">
            {tokens.map((token) => (
              <div key={token.id} className="group/swatch relative flex flex-col items-center gap-1">
                {editingId === token.id ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <input
                        type="color"
                        value={token.value}
                        onChange={(e) => updateColor(token.id, { value: e.target.value })}
                        className="w-6 h-6 rounded border-0 cursor-pointer"
                      />
                      <input
                        className="flex-1 bg-surface-subtle border border-surface-border rounded px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent"
                        value={token.name}
                        onChange={(e) => updateColor(token.id, { name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingId(null); }}
                        autoFocus
                      />
                      <button onClick={() => setEditingId(null)} className="text-text-tertiary hover:text-text-primary"><X size={10} /></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="w-8 h-8 rounded border border-white/10 cursor-pointer hover:scale-110 transition-transform relative"
                      style={{ backgroundColor: token.value }}
                      title={`${token.name}: ${token.value}`}
                    >
                      <div className="absolute inset-0 opacity-0 group-hover/swatch:opacity-100 flex items-center justify-center gap-0.5 bg-black/30 rounded transition-opacity">
                        <button onClick={() => setEditingId(token.id)} className="text-white hover:text-accent"><Pencil size={8} /></button>
                        <button onClick={() => deleteColor(token.id)} className="text-white hover:text-red-400"><Trash2 size={8} /></button>
                      </div>
                    </div>
                    <span className="text-2xs text-text-tertiary text-center leading-tight truncate w-full">
                      {token.name.split("-").pop()}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Row components ─────────────────────────────────────────────────────────────

function TypographyRow({ token, onUpdate, onDelete }: {
  token: TypographyToken;
  onUpdate: (u: Partial<TypographyToken>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="px-3 py-2 border-b border-surface-border">
        <div className="flex items-center justify-between mb-2">
          <input
            className="text-xs font-medium bg-transparent border-b border-accent outline-none text-text-primary flex-1 mr-2"
            value={token.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
          <button onClick={() => setEditing(false)} className="text-text-tertiary hover:text-text-primary"><X size={10} /></button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-2xs text-text-tertiary">Family</label>
            <input className="input-sm mt-0.5" value={token.fontFamily} onChange={(e) => onUpdate({ fontFamily: e.target.value })} />
          </div>
          <div>
            <label className="text-2xs text-text-tertiary">Size</label>
            <input type="number" className="input-sm mt-0.5" value={token.fontSize} onChange={(e) => onUpdate({ fontSize: parseFloat(e.target.value) || token.fontSize })} />
          </div>
          <div>
            <label className="text-2xs text-text-tertiary">Weight</label>
            <input type="number" className="input-sm mt-0.5" value={token.fontWeight} onChange={(e) => onUpdate({ fontWeight: parseFloat(e.target.value) || token.fontWeight })} />
          </div>
          <div>
            <label className="text-2xs text-text-tertiary">Line h.</label>
            <input type="number" className="input-sm mt-0.5" value={token.lineHeight} onChange={(e) => onUpdate({ lineHeight: parseFloat(e.target.value) || token.lineHeight })} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/typo px-3 py-2 hover:bg-surface-subtle border-b border-surface-border last:border-0 flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs font-medium text-text-primary">{token.name}</span>
          <span className="text-2xs text-text-tertiary">{token.fontSize}/{token.lineHeight}</span>
        </div>
        <p className="text-text-secondary truncate" style={{ fontFamily: token.fontFamily, fontSize: Math.min(13, token.fontSize), fontWeight: token.fontWeight, lineHeight: "1.4" }}>
          The quick brown fox
        </p>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover/typo:opacity-100 mt-0.5 flex-shrink-0">
        <button onClick={() => setEditing(true)} className="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-overlay"><Pencil size={9} /></button>
        <button onClick={onDelete} className="p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"><Trash2 size={9} /></button>
      </div>
    </div>
  );
}

function SpacingRow({ token, onUpdate, onDelete }: {
  token: SpacingToken;
  onUpdate: (u: Partial<SpacingToken>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="group/sp flex items-center gap-3 py-1.5 border-b border-surface-border last:border-0">
      <div className="bg-accent/30 h-2 rounded-sm flex-shrink-0" style={{ width: Math.min(token.value, 100) }} />
      <input className="flex-1 bg-transparent text-xs text-text-primary outline-none" value={token.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      <input type="number" className="w-10 bg-transparent text-xs font-mono text-text-tertiary outline-none text-right" value={token.value} onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onUpdate({ value: n }); }} />
      <span className="text-2xs text-text-tertiary flex-shrink-0">px</span>
      <button onClick={onDelete} className="opacity-0 group-hover/sp:opacity-100 p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10 flex-shrink-0"><Trash2 size={9} /></button>
    </div>
  );
}

function RadiusRow({ token, onUpdate, onDelete }: {
  token: RadiusToken;
  onUpdate: (u: Partial<RadiusToken>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="group/rad flex items-center gap-3 py-1.5 border-b border-surface-border last:border-0">
      <div className="w-5 h-5 border border-surface-border bg-surface-subtle flex-shrink-0" style={{ borderRadius: Math.min(token.value, 10) }} />
      <input className="flex-1 bg-transparent text-xs text-text-primary outline-none" value={token.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      <input type="number" className="w-10 bg-transparent text-xs font-mono text-text-tertiary outline-none text-right" value={token.value === 9999 ? 9999 : token.value} onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onUpdate({ value: n }); }} />
      <button onClick={onDelete} className="opacity-0 group-hover/rad:opacity-100 p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10 flex-shrink-0"><Trash2 size={9} /></button>
    </div>
  );
}

function ShadowRow({ token, onUpdate, onDelete }: {
  token: ShadowToken;
  onUpdate: (u: Partial<ShadowToken>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const preview = `${token.x}px ${token.y}px ${token.blur}px ${token.spread}px ${token.color}`;

  if (editing) {
    return (
      <div className="py-2 border-b border-surface-border">
        <div className="flex items-center justify-between mb-2">
          <input className="text-xs font-medium bg-transparent border-b border-accent outline-none text-text-primary flex-1 mr-2" value={token.name} onChange={(e) => onUpdate({ name: e.target.value })} />
          <button onClick={() => setEditing(false)} className="text-text-tertiary hover:text-text-primary"><X size={10} /></button>
        </div>
        <div className="grid grid-cols-4 gap-1 mb-1.5">
          {(["x", "y", "blur", "spread"] as const).map((k) => (
            <div key={k}>
              <label className="text-2xs text-text-tertiary capitalize">{k}</label>
              <input type="number" className="input-sm mt-0.5" value={token[k]} onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onUpdate({ [k]: n }); }} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input type="color" value={token.color.startsWith("rgba") ? "#000000" : token.color} onChange={(e) => onUpdate({ color: e.target.value })} className="w-6 h-6 rounded border-0 cursor-pointer flex-shrink-0" />
          <input className="input-sm flex-1" value={token.color} onChange={(e) => onUpdate({ color: e.target.value })} placeholder="rgba(0,0,0,0.1)" />
        </div>
      </div>
    );
  }

  return (
    <div className="group/sh flex items-center gap-2 py-1.5 border-b border-surface-border last:border-0">
      <div className="w-6 h-6 bg-white dark:bg-neutral-700 rounded flex-shrink-0" style={{ boxShadow: preview }} />
      <span className="flex-1 text-xs text-text-primary truncate">{token.name}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover/sh:opacity-100">
        <button onClick={() => setEditing(true)} className="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-overlay"><Pencil size={9} /></button>
        <button onClick={onDelete} className="p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"><Trash2 size={9} /></button>
      </div>
    </div>
  );
}

// ── Token panel content ────────────────────────────────────────────────────────

function TokensPanelContent() {
  const [activeSection, setActiveSection] = useState<TokenSection>("colors");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);

  const {
    colors, typography, spacing, radii, shadows,
    addColor, addTypography, addSpacing, addRadius, addShadow,
    updateTypography, deleteTypography,
    updateSpacing, deleteSpacing,
    updateRadius, deleteRadius,
    updateShadow, deleteShadow,
    exportTokens, exportCSS, exportTailwind, importFromJSON,
  } = useDesignSystemStore();

  const colorGroups = colors.reduce<Record<string, ColorToken[]>>((acc, c) => {
    if (!acc[c.group]) acc[c.group] = [];
    acc[c.group].push(c);
    return acc;
  }, {});

  const handleImport = () => {
    const result = importFromJSON(importText);
    if (result.errors.length) {
      setImportMsg(`Errors: ${result.errors.join(", ")}`);
    } else {
      setImportMsg(`Imported ${result.imported} tokens`);
      setTimeout(() => { setShowImport(false); setImportText(""); setImportMsg(""); }, 1200);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Section tabs */}
      <div className="flex border-b border-surface-border px-1 pt-1 gap-0.5 overflow-x-auto flex-shrink-0">
        {(["colors", "type", "spacing", "radii", "shadows"] as TokenSection[]).map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={cn(
              "px-2 py-1.5 text-xs rounded-t transition-colors whitespace-nowrap capitalize flex-shrink-0",
              activeSection === s ? "text-text-primary bg-surface-subtle" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {s === "type" ? "Type" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Colors */}
        {activeSection === "colors" && (
          <div className="py-1">
            {Object.entries(colorGroups).map(([group, tokens]) => (
              <EditableColorGroup key={group} group={group} tokens={tokens} />
            ))}
            {addingGroup ? (
              <div className="px-3 py-2 flex items-center gap-1.5">
                <input
                  className="flex-1 bg-surface-subtle border border-surface-border rounded px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent"
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newGroupName.trim()) {
                      addColor({ name: `${newGroupName.trim()}-500`, value: "#6366f1", group: newGroupName.trim() });
                      setNewGroupName(""); setAddingGroup(false);
                    }
                    if (e.key === "Escape") { setAddingGroup(false); setNewGroupName(""); }
                  }}
                  autoFocus
                />
                <button onClick={() => { setAddingGroup(false); setNewGroupName(""); }} className="text-text-tertiary hover:text-text-primary"><X size={11} /></button>
              </div>
            ) : (
              <button
                onClick={() => setAddingGroup(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
              >
                <Plus size={10} /> New group
              </button>
            )}
          </div>
        )}

        {/* Typography */}
        {activeSection === "type" && (
          <div>
            {typography.map((t) => (
              <TypographyRow key={t.id} token={t} onUpdate={(u) => updateTypography(t.id, u)} onDelete={() => deleteTypography(t.id)} />
            ))}
            <button
              onClick={() => addTypography({ name: "new-style", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20 })}
              className="flex items-center gap-1.5 px-3 py-1.5 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
            >
              <Plus size={10} /> Add style
            </button>
          </div>
        )}

        {/* Spacing */}
        {activeSection === "spacing" && (
          <div className="px-3 py-2">
            {spacing.map((sp) => (
              <SpacingRow key={sp.id} token={sp} onUpdate={(u) => updateSpacing(sp.id, u)} onDelete={() => deleteSpacing(sp.id)} />
            ))}
            <button onClick={() => addSpacing({ name: "space-new", value: 16 })} className="flex items-center gap-1.5 py-1.5 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors rounded">
              <Plus size={10} /> Add spacing
            </button>
          </div>
        )}

        {/* Radii */}
        {activeSection === "radii" && (
          <div className="px-3 py-2">
            {radii.map((r) => (
              <RadiusRow key={r.id} token={r} onUpdate={(u) => updateRadius(r.id, u)} onDelete={() => deleteRadius(r.id)} />
            ))}
            <button onClick={() => addRadius({ name: "radius-new", value: 4 })} className="flex items-center gap-1.5 py-1.5 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors rounded">
              <Plus size={10} /> Add radius
            </button>
          </div>
        )}

        {/* Shadows */}
        {activeSection === "shadows" && (
          <div className="px-3 py-2">
            {shadows.map((sh) => (
              <ShadowRow key={sh.id} token={sh} onUpdate={(u) => updateShadow(sh.id, u)} onDelete={() => deleteShadow(sh.id)} />
            ))}
            <button onClick={() => addShadow({ name: "shadow-new", x: 0, y: 4, blur: 8, spread: 0, color: "rgba(0,0,0,0.1)", group: "default" })} className="flex items-center gap-1.5 py-1.5 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors rounded">
              <Plus size={10} /> Add shadow
            </button>
          </div>
        )}
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="border-t border-surface-border p-3 bg-surface-raised flex-shrink-0">
          <p className="text-xs font-medium text-text-primary mb-2">Import tokens (W3C JSON)</p>
          <textarea
            className="w-full bg-surface-subtle border border-surface-border rounded px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent font-mono resize-none"
            rows={5}
            placeholder='{"color": {"primary": {"500": {"$value": "#6366f1", "$type": "color"}}}}'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          {importMsg && <p className="text-2xs mt-1 text-accent">{importMsg}</p>}
          <div className="flex gap-1.5 mt-2">
            <button onClick={handleImport} className="flex-1 bg-accent hover:bg-accent/90 text-white text-xs py-1 rounded transition-colors">Import</button>
            <button onClick={() => { setShowImport(false); setImportText(""); setImportMsg(""); }} className="flex-1 border border-surface-border text-text-secondary hover:text-text-primary text-xs py-1 rounded transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Export / Import bar */}
      {!showImport && (
        <div className="border-t border-surface-border p-2 flex items-center gap-1 flex-wrap flex-shrink-0">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors" title="Import tokens JSON">
            <Upload size={9} /> Import
          </button>
          <button onClick={() => downloadText("tokens.json", exportTokens())} className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <Download size={9} /> JSON
          </button>
          <button onClick={() => downloadText("tokens.css", exportCSS())} className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <Download size={9} /> CSS
          </button>
          <button onClick={() => downloadText("tailwind.config.js", exportTailwind())} className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <Download size={9} /> Tailwind
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main TokensView ────────────────────────────────────────────────────────────

export default function TokensView({ onClose }: { onClose?: () => void }) {
  const [isModal, setIsModal] = useState(false);
  const [modalPos, setModalPos] = useState({ x: 80, y: 60 });
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, posX: modalPos.x, posY: modalPos.y };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setModalPos({
        x: dragRef.current.posX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.posY + (ev.clientY - dragRef.current.startY),
      });
    };
    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [modalPos]);

  const popOut = () => {
    setIsModal(true);
    onClose?.();
  };

  if (isModal) {
    return createPortal(
      <div
        className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-surface-border bg-surface-raised shadow-2xl"
        style={{ left: modalPos.x, top: modalPos.y, width: 760, height: 580 }}
      >
        {/* Drag handle / header */}
        <div
          className="flex items-center gap-2 px-3 h-10 border-b border-surface-border cursor-move select-none flex-shrink-0 bg-surface-raised"
          onMouseDown={handleDragStart}
        >
          <Palette size={13} className="text-accent" />
          <span className="text-sm font-medium text-text-primary flex-1">Design Tokens</span>
          <button
            onClick={() => setIsModal(false)}
            title="Dock to panel"
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors"
          >
            <Minimize2 size={12} />
          </button>
          <button
            onClick={() => setIsModal(false)}
            title="Close"
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors"
          >
            <X size={12} />
          </button>
        </div>
        <TokensPanelContent />
      </div>,
      document.body
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Pop-out button */}
      <div className="flex items-center justify-end px-2 py-1 border-b border-surface-border flex-shrink-0">
        <button
          onClick={popOut}
          title="Open as floating window"
          className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors"
        >
          <Maximize2 size={11} /> Float
        </button>
      </div>
      <TokensPanelContent />
    </div>
  );
}
