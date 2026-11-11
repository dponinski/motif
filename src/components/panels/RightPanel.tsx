"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  SlidersHorizontal,
  Palette,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
  Pencil,
  Download,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas";
import {
  useDesignSystemStore,
  type ColorToken,
  type TypographyToken,
  type SpacingToken,
  type RadiusToken,
  type ShadowToken,
} from "@/store/design-system";

type Tab = "properties" | "tokens";

// ── Shared inputs ─────────────────────────────────────────────────────────────

function NumberInput({
  label,
  value,
  onChange,
  onCommit,
  unit = "px",
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  onCommit?: () => void;
  unit?: string;
}) {
  const [local, setLocal] = useState(String(Math.round(value)));

  useEffect(() => { setLocal(String(Math.round(value))); }, [value]);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(n);
    onCommit?.();
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-2xs text-text-tertiary">{label}</label>
      <div className="flex items-center bg-surface-subtle border border-surface-border rounded px-1.5 py-1 gap-1">
        <input
          type="number"
          value={local}
          onChange={(e) => { setLocal(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(n); }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }}
          className="w-full bg-transparent text-xs text-text-primary outline-none"
        />
        {unit && <span className="text-2xs text-text-tertiary flex-shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-2xs text-text-tertiary">{label}</label>
      <div className="flex items-center bg-surface-subtle border border-surface-border rounded px-1.5 py-1 gap-2">
        <input type="color" value={value || "#000000"} onChange={(e) => onChange(e.target.value)} className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent" />
        <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} className="flex-1 bg-transparent text-xs text-text-primary outline-none font-mono" placeholder="#000000" />
      </div>
    </div>
  );
}

// ── Token swatches picker (grouped) ───────────────────────────────────────────

function TokenColorPicker({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (token: ColorToken) => void;
}) {
  const { colors } = useDesignSystemStore();
  const groups = colors.reduce<Record<string, ColorToken[]>>((acc, c) => {
    if (!acc[c.group]) acc[c.group] = [];
    acc[c.group].push(c);
    return acc;
  }, {});

  return (
    <div className="mt-2 space-y-2">
      {Object.entries(groups).map(([group, tokens]) => (
        <div key={group}>
          <p className="text-2xs text-text-tertiary uppercase tracking-wider mb-1 capitalize">{group}</p>
          <div className="flex flex-wrap gap-1">
            {tokens.map((t) => (
              <button
                key={t.id}
                title={`${t.name}: ${t.value}`}
                onClick={() => onSelect(t)}
                className={cn(
                  "w-5 h-5 rounded border-2 transition-transform hover:scale-110",
                  selectedId === t.id ? "border-white scale-110 ring-1 ring-accent" : "border-transparent"
                )}
                style={{ backgroundColor: t.value }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Properties panel ──────────────────────────────────────────────────────────

function PropertiesPanel() {
  const { elements, selectedIds, updateElement, pushHistory } = useCanvasStore();
  const { colors, typography } = useDesignSystemStore();

  if (!selectedIds.length) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <SlidersHorizontal size={18} className="text-text-tertiary" />
        <span className="text-xs text-text-tertiary">Select an element</span>
      </div>
    );
  }

  if (selectedIds.length > 1) {
    return <div className="p-3"><p className="text-xs text-text-secondary">{selectedIds.length} elements selected</p></div>;
  }

  const el = elements[selectedIds[0]];
  if (!el) return null;

  const update = (updates: Parameters<typeof updateElement>[1]) => updateElement(el.id, updates);
  const commit = () => pushHistory();

  const boundColor = el.fillTokenId ? colors.find((c) => c.id === el.fillTokenId) : null;
  const boundTypo = el.typographyTokenId ? typography.find((t) => t.id === el.typographyTokenId) : null;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Element name */}
      <div className="px-3 py-2 border-b border-surface-border">
        <input className="input-sm" value={el.name} onChange={(e) => updateElement(el.id, { name: e.target.value })} onBlur={commit} />
      </div>

      {/* Position & Size */}
      <div className="px-3 py-2 border-b border-surface-border">
        <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Position & Size</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="X" value={el.x} onChange={(v) => update({ x: v })} onCommit={commit} />
          <NumberInput label="Y" value={el.y} onChange={(v) => update({ y: v })} onCommit={commit} />
          <NumberInput label="W" value={el.width} onChange={(v) => update({ width: Math.max(1, v) })} onCommit={commit} />
          <NumberInput label="H" value={el.height} onChange={(v) => update({ height: Math.max(1, v) })} onCommit={commit} />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <NumberInput label="Rotation" value={el.rotation} onChange={(v) => update({ rotation: v })} onCommit={commit} unit="°" />
          <NumberInput label="Opacity" value={(el.opacity ?? 1) * 100} onChange={(v) => update({ opacity: Math.min(1, Math.max(0, v / 100)) })} onCommit={commit} unit="%" />
        </div>
      </div>

      {/* Fill */}
      {el.type !== "text" && (
        <div className="px-3 py-2 border-b border-surface-border">
          <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Fill</p>

          {/* Token badge when bound */}
          {boundColor ? (
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded border border-white/20 flex-shrink-0" style={{ backgroundColor: boundColor.value }} />
              <span className="text-xs text-text-primary font-medium flex-1 truncate">{boundColor.name}</span>
              <button
                onClick={() => { update({ fillTokenId: undefined }); commit(); }}
                className="text-text-tertiary hover:text-text-primary p-0.5 rounded hover:bg-surface-subtle"
                title="Detach token"
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <ColorInput
              label="Color"
              value={el.fill ?? "#6366f1"}
              onChange={(v) => { update({ fill: v, fillTokenId: undefined }); commit(); }}
            />
          )}

          <TokenColorPicker
            selectedId={el.fillTokenId}
            onSelect={(t) => { update({ fill: t.value, fillTokenId: t.id }); commit(); }}
          />
        </div>
      )}

      {/* Stroke */}
      {el.type !== "text" && (
        <div className="px-3 py-2 border-b border-surface-border">
          <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Stroke</p>
          <div className="grid grid-cols-2 gap-2">
            <ColorInput label="Color" value={el.stroke ?? "#000000"} onChange={(v) => { update({ stroke: v }); commit(); }} />
            <NumberInput label="Width" value={el.strokeWidth ?? 0} onChange={(v) => update({ strokeWidth: Math.max(0, v) })} onCommit={commit} />
          </div>
        </div>
      )}

      {/* Corner Radius */}
      {(el.type === "rectangle" || el.type === "frame") && (
        <div className="px-3 py-2 border-b border-surface-border">
          <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Corner Radius</p>
          <NumberInput label="Radius" value={el.cornerRadius ?? 0} onChange={(v) => update({ cornerRadius: Math.max(0, v) })} onCommit={commit} />
        </div>
      )}

      {/* Text */}
      {el.type === "text" && (
        <div className="px-3 py-2 border-b border-surface-border">
          <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Typography</p>
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-2xs text-text-tertiary">Content</label>
              <textarea className="input-sm mt-1 resize-none" rows={3} value={el.content ?? ""} onChange={(e) => update({ content: e.target.value })} onBlur={commit} />
            </div>

            {/* Typography token binding */}
            {boundTypo ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-text-primary font-medium truncate block">{boundTypo.name}</span>
                  <span className="text-2xs text-text-tertiary">{boundTypo.fontFamily} · {boundTypo.fontSize}px · {boundTypo.fontWeight}</span>
                </div>
                <button onClick={() => { update({ typographyTokenId: undefined }); commit(); }} className="text-text-tertiary hover:text-text-primary p-0.5 rounded hover:bg-surface-subtle" title="Detach style">
                  <X size={10} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <NumberInput label="Size" value={el.fontSize ?? 16} onChange={(v) => update({ fontSize: v })} onCommit={commit} />
                <div>
                  <label className="text-2xs text-text-tertiary">Weight</label>
                  <select className="input-sm mt-1" value={el.fontWeight ?? "400"} onChange={(e) => { update({ fontWeight: e.target.value }); commit(); }}>
                    <option value="300">Light</option>
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">Semibold</option>
                    <option value="700">Bold</option>
                  </select>
                </div>
              </div>
            )}

            <ColorInput label="Color" value={el.fontColor ?? "#0a0a0a"} onChange={(v) => { update({ fontColor: v }); commit(); }} />

            {/* Typography token picker */}
            {!boundTypo && (
              <div>
                <p className="text-2xs text-text-tertiary mb-1">Text styles</p>
                <div className="space-y-0.5 max-h-28 overflow-y-auto">
                  {typography.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { update({ typographyTokenId: t.id, fontSize: t.fontSize, fontWeight: String(t.fontWeight), fontFamily: t.fontFamily }); commit(); }}
                      className="w-full text-left px-2 py-1 rounded hover:bg-surface-subtle transition-colors"
                    >
                      <span className="text-xs text-text-primary block" style={{ fontFamily: t.fontFamily, fontSize: 12, fontWeight: t.fontWeight }}>{t.name}</span>
                      <span className="text-2xs text-text-tertiary">{t.fontSize}px · {t.fontWeight}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Editable color group ───────────────────────────────────────────────────────

function EditableColorGroup({ group, tokens }: { group: string; tokens: ColorToken[] }) {
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { updateColor, deleteColor, addColor } = useDesignSystemStore();

  return (
    <div className="mb-2">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 px-3 py-1.5 w-full text-left hover:bg-surface-subtle">
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
          <div className="grid grid-cols-5 gap-1.5">
            {tokens.map((token) => (
              <div key={token.id} className="group/swatch relative flex flex-col items-center gap-1">
                {editingId === token.id ? (
                  <div className="col-span-5 w-full" onClick={(e) => e.stopPropagation()}>
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
                    <span className="text-2xs text-text-tertiary text-center leading-tight truncate w-full text-center">
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

// ── Tokens panel ──────────────────────────────────────────────────────────────

type TokenSection = "colors" | "type" | "spacing" | "radii" | "shadows";

function downloadText(filename: string, content: string) {
  const a = document.createElement("a");
  a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

function DesignTokensPanel() {
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Section tabs */}
      <div className="flex border-b border-surface-border px-1 pt-1 gap-0.5 overflow-x-auto">
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

        {/* ── Colors ── */}
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

        {/* ── Typography ── */}
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

        {/* ── Spacing ── */}
        {activeSection === "spacing" && (
          <div className="px-3 py-2">
            {spacing.map((sp) => (
              <SpacingRow key={sp.id} token={sp} onUpdate={(u) => updateSpacing(sp.id, u)} onDelete={() => deleteSpacing(sp.id)} />
            ))}
            <button
              onClick={() => addSpacing({ name: "space-new", value: 16 })}
              className="flex items-center gap-1.5 py-1.5 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors rounded"
            >
              <Plus size={10} /> Add spacing
            </button>
          </div>
        )}

        {/* ── Radii ── */}
        {activeSection === "radii" && (
          <div className="px-3 py-2">
            {radii.map((r) => (
              <RadiusRow key={r.id} token={r} onUpdate={(u) => updateRadius(r.id, u)} onDelete={() => deleteRadius(r.id)} />
            ))}
            <button
              onClick={() => addRadius({ name: "radius-new", value: 4 })}
              className="flex items-center gap-1.5 py-1.5 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors rounded"
            >
              <Plus size={10} /> Add radius
            </button>
          </div>
        )}

        {/* ── Shadows ── */}
        {activeSection === "shadows" && (
          <div className="px-3 py-2">
            {shadows.map((sh) => (
              <ShadowRow key={sh.id} token={sh} onUpdate={(u) => updateShadow(sh.id, u)} onDelete={() => deleteShadow(sh.id)} />
            ))}
            <button
              onClick={() => addShadow({ name: "shadow-new", x: 0, y: 4, blur: 8, spread: 0, color: "rgba(0,0,0,0.1)", group: "default" })}
              className="flex items-center gap-1.5 py-1.5 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors rounded"
            >
              <Plus size={10} /> Add shadow
            </button>
          </div>
        )}
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="border-t border-surface-border p-3 bg-surface-raised">
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
        <div className="border-t border-surface-border p-2 flex items-center gap-1 flex-wrap">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors" title="Import tokens JSON">
            <Upload size={9} /> Import
          </button>
          <button onClick={() => downloadText("tokens.json", exportTokens())} className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors" title="Download W3C tokens.json">
            <Download size={9} /> JSON
          </button>
          <button onClick={() => downloadText("tokens.css", exportCSS())} className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors" title="Download CSS variables">
            <Download size={9} /> CSS
          </button>
          <button onClick={() => downloadText("tailwind.config.js", exportTailwind())} className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors" title="Download Tailwind config">
            <Download size={9} /> Tailwind
          </button>
        </div>
      )}
    </div>
  );
}

// ── Row components for editable tokens ───────────────────────────────────────

function TypographyRow({ token, onUpdate, onDelete }: { token: TypographyToken; onUpdate: (u: Partial<TypographyToken>) => void; onDelete: () => void }) {
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

function SpacingRow({ token, onUpdate, onDelete }: { token: SpacingToken; onUpdate: (u: Partial<SpacingToken>) => void; onDelete: () => void }) {
  return (
    <div className="group/sp flex items-center gap-3 py-1.5 border-b border-surface-border last:border-0">
      <div className="bg-accent/30 h-2 rounded-sm flex-shrink-0" style={{ width: Math.min(token.value, 100) }} />
      <input
        className="flex-1 bg-transparent text-xs text-text-primary outline-none"
        value={token.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
      />
      <input
        type="number"
        className="w-10 bg-transparent text-xs font-mono text-text-tertiary outline-none text-right"
        value={token.value}
        onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onUpdate({ value: n }); }}
      />
      <span className="text-2xs text-text-tertiary flex-shrink-0">px</span>
      <button onClick={onDelete} className="opacity-0 group-hover/sp:opacity-100 p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10 flex-shrink-0"><Trash2 size={9} /></button>
    </div>
  );
}

function RadiusRow({ token, onUpdate, onDelete }: { token: RadiusToken; onUpdate: (u: Partial<RadiusToken>) => void; onDelete: () => void }) {
  const display = token.value === 9999 ? "∞" : `${token.value}px`;
  return (
    <div className="group/rad flex items-center gap-3 py-1.5 border-b border-surface-border last:border-0">
      <div className="w-5 h-5 border border-surface-border bg-surface-subtle flex-shrink-0" style={{ borderRadius: Math.min(token.value, 10) }} />
      <input
        className="flex-1 bg-transparent text-xs text-text-primary outline-none"
        value={token.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
      />
      <input
        type="number"
        className="w-10 bg-transparent text-xs font-mono text-text-tertiary outline-none text-right"
        value={token.value === 9999 ? 9999 : token.value}
        onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onUpdate({ value: n }); }}
      />
      <span className="text-2xs text-text-tertiary flex-shrink-0 w-4">{display}</span>
      <button onClick={onDelete} className="opacity-0 group-hover/rad:opacity-100 p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10 flex-shrink-0"><Trash2 size={9} /></button>
    </div>
  );
}

function ShadowRow({ token, onUpdate, onDelete }: { token: ShadowToken; onUpdate: (u: Partial<ShadowToken>) => void; onDelete: () => void }) {
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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function RightPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("properties");

  return (
    <aside className="w-[260px] flex-shrink-0 flex flex-col border-l border-surface-border bg-surface-raised overflow-hidden">
      <div className="flex border-b border-surface-border">
        {(["properties", "tokens"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-2 text-xs font-medium capitalize transition-colors",
              activeTab === tab ? "text-text-primary border-b border-accent" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {tab === "properties" ? (
              <span className="flex items-center justify-center gap-1"><SlidersHorizontal size={11} /> Properties</span>
            ) : (
              <span className="flex items-center justify-center gap-1"><Palette size={11} /> Tokens</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "properties" ? <PropertiesPanel /> : <DesignTokensPanel />}
    </aside>
  );
}
