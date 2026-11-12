"use client";

import { useState, useEffect } from "react";
import { SlidersHorizontal, X, Minus, Plus, Code2, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore, type VariantProp } from "@/store/canvas";
import { componentInterface, componentJsx } from "@/lib/component-code";
import { activeComponent, useLibraryStore } from "@/store/library";
import RepoComponentPanel from "./RepoComponentPanel";
import { formatZoom } from "@/lib/utils";
import {
  useDesignSystemStore,
  type ColorToken,
  type TypographyToken,
} from "@/store/design-system";

// ── Shared inputs ─────────────────────────────────────────────────────────────

function NumberInput({
  label, value, onChange, onCommit, unit = "px",
}: {
  label: string; value: number; onChange: (val: number) => void; onCommit?: () => void; unit?: string;
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

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (val: string) => void }) {
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

function TokenColorPicker({ selectedId, onSelect }: { selectedId?: string; onSelect: (token: ColorToken) => void }) {
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

// ── Component props editor (no selection state) ───────────────────────────────

function ComponentPropsPanel() {
  const { activeComponentId, componentDefs, addVariantProp, updateVariantProp, removeVariantProp } =
    useCanvasStore();
  const def = componentDefs.find((c) => c.id === activeComponentId);
  if (!def) return null;

  const addProp = () => addVariantProp(def.id, `prop${def.variantProps.length + 1}`);

  const tsxSignature = componentInterface(def);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Variant props */}
      <div className="px-3 py-2 border-b border-surface-border">
        <div className="flex items-center mb-2">
          <p className="text-2xs text-text-tertiary font-medium uppercase tracking-wider flex-1">Props</p>
          <button
            onClick={addProp}
            className="text-2xs text-accent hover:text-accent/80 flex items-center gap-0.5 px-1 rounded hover:bg-accent/10 transition-colors"
          >
            <Plus size={9} /> Add
          </button>
        </div>
        {def.variantProps.length === 0 && (
          <p className="text-xs text-text-tertiary">No props yet. Add one to define variants.</p>
        )}
        {def.variantProps.map((prop) => (
          <VariantPropRow
            key={prop.id}
            prop={prop}
            onUpdate={(patch) => updateVariantProp(def.id, prop.id, patch)}
            onRemove={() => removeVariantProp(def.id, prop.id)}
          />
        ))}
      </div>

      {/* Code output */}
      {def.variantProps.length > 0 && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-1 mb-2">
            <Code2 size={11} className="text-text-tertiary" />
            <p className="text-2xs text-text-tertiary font-medium uppercase tracking-wider">Interface</p>
          </div>
          <pre className="text-2xs font-mono text-text-secondary bg-surface-subtle rounded p-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {tsxSignature}
          </pre>
        </div>
      )}
    </div>
  );
}

function VariantPropRow({
  prop,
  onUpdate,
  onRemove,
}: {
  prop: VariantProp;
  onUpdate: (patch: Partial<Omit<VariantProp, "id">>) => void;
  onRemove: () => void;
}) {
  const [valInput, setValInput] = useState("");

  const addValue = () => {
    const v = valInput.trim();
    if (!v || prop.values.includes(v)) return;
    onUpdate({ values: [...prop.values, v] });
    setValInput("");
  };

  const removeValue = (v: string) => {
    const next = prop.values.filter((x) => x !== v);
    onUpdate({
      values: next,
      default: next.includes(prop.default) ? prop.default : (next[0] ?? ""),
    });
  };

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-1 mb-1">
        <input
          className="flex-1 bg-surface-subtle border border-surface-border rounded px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent"
          value={prop.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="prop name"
        />
        <button onClick={onRemove} className="p-0.5 rounded hover:bg-surface-subtle text-text-tertiary hover:text-red-400">
          <Trash2 size={10} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1 mb-1">
        {prop.values.map((v) => (
          <span
            key={v}
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs cursor-pointer transition-colors",
              v === prop.default
                ? "bg-accent/15 text-accent"
                : "bg-surface-subtle text-text-secondary hover:bg-surface-overlay"
            )}
            onClick={() => onUpdate({ default: v })}
            title="Click to set as default"
          >
            {v}
            <button
              onClick={(e) => { e.stopPropagation(); removeValue(v); }}
              className="hover:text-red-400 leading-none"
            >
              <X size={8} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          className="flex-1 bg-surface-subtle border border-surface-border rounded px-1.5 py-0.5 text-2xs text-text-primary outline-none focus:border-accent"
          value={valInput}
          onChange={(e) => setValInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addValue(); e.stopPropagation(); }}
          placeholder="add value…"
        />
        <button onClick={addValue} className="px-1.5 rounded bg-surface-subtle text-text-tertiary hover:text-text-primary text-2xs">
          +
        </button>
      </div>
    </div>
  );
}

// ── Instance properties ───────────────────────────────────────────────────────

function InstancePanel({ elementId }: { elementId: string }) {
  const { elements, updateElement, pushHistory, componentDefs } = useCanvasStore();
  const el = elements[elementId];
  if (!el || el.type !== "instance" || !el.componentId) return null;
  const def = componentDefs.find((c) => c.id === el.componentId);
  if (!def) return null;

  const props = el.instanceProps ?? {};
  const setprop = (name: string, value: string) => {
    updateElement(el.id, { instanceProps: { ...props, [name]: value } });
    pushHistory();
  };

  const jsxSnippet = componentJsx(def, props);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Instance header */}
      <div className="px-3 py-2 border-b border-surface-border">
        <p className="text-2xs text-text-tertiary font-medium uppercase tracking-wider mb-1">Component</p>
        <p className="text-xs text-text-primary font-medium">{def.name}</p>
      </div>

      {/* Position & size */}
      <div className="px-3 py-2 border-b border-surface-border">
        <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Position & Size</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="X" value={el.x} onChange={(v) => updateElement(el.id, { x: v })} onCommit={pushHistory} />
          <NumberInput label="Y" value={el.y} onChange={(v) => updateElement(el.id, { y: v })} onCommit={pushHistory} />
          <NumberInput label="W" value={el.width} onChange={(v) => updateElement(el.id, { width: Math.max(1, v) })} onCommit={pushHistory} />
          <NumberInput label="H" value={el.height} onChange={(v) => updateElement(el.id, { height: Math.max(1, v) })} onCommit={pushHistory} />
        </div>
      </div>

      {/* Props */}
      {def.variantProps.length > 0 && (
        <div className="px-3 py-2 border-b border-surface-border">
          <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Props</p>
          {def.variantProps.map((p) => (
            <div key={p.id} className="flex items-center gap-2 mb-1.5">
              <span className="text-xs text-text-secondary w-16 flex-shrink-0 truncate">{p.name}</span>
              <div className="flex-1 relative">
                <select
                  className="w-full bg-surface-subtle border border-surface-border rounded px-1.5 py-0.5 text-xs text-text-primary outline-none appearance-none pr-5"
                  value={props[p.name] ?? p.default}
                  onChange={(e) => setprop(p.name, e.target.value)}
                >
                  {p.values.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* JSX code */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1 mb-2">
          <Code2 size={11} className="text-text-tertiary" />
          <p className="text-2xs text-text-tertiary font-medium uppercase tracking-wider">JSX</p>
        </div>
        <pre className="text-2xs font-mono text-accent bg-surface-subtle rounded p-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed select-all">
          {jsxSnippet}
        </pre>
      </div>
    </div>
  );
}

// ── Properties panel ──────────────────────────────────────────────────────────

function PropertiesPanel() {
  const { elements, selectedIds, updateElement, pushHistory, activeComponentId, componentDefs } = useCanvasStore();
  const { colors, typography } = useDesignSystemStore();

  if (!selectedIds.length) {
    // Show component props editor when no element selected
    const def = componentDefs.find((c) => c.id === activeComponentId);
    if (def) return <ComponentPropsPanel />;
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

  // Instance gets its own panel
  if (el.type === "instance") return <InstancePanel elementId={el.id} />;

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
          {boundColor ? (
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded border border-white/20 flex-shrink-0" style={{ backgroundColor: boundColor.value }} />
              <span className="text-xs text-text-primary font-medium flex-1 truncate">{boundColor.name}</span>
              <button onClick={() => { update({ fillTokenId: undefined }); commit(); }} className="text-text-tertiary hover:text-text-primary p-0.5 rounded hover:bg-surface-subtle" title="Detach token">
                <X size={10} />
              </button>
            </div>
          ) : (
            <ColorInput label="Color" value={el.fill ?? "#6366f1"} onChange={(v) => { update({ fill: v, fillTokenId: undefined }); commit(); }} />
          )}
          <TokenColorPicker selectedId={el.fillTokenId} onSelect={(t) => { update({ fill: t.value, fillTokenId: t.id }); commit(); }} />
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

// ── Main ──────────────────────────────────────────────────────────────────────

function ZoomControls() {
  const { zoom, setZoom } = useCanvasStore();
  return (
    <div className="flex items-center gap-1 px-3 h-9 border-b border-surface-border flex-shrink-0">
      <span className="text-2xs text-text-tertiary flex-1">Zoom</span>
      <button onClick={() => setZoom(Math.max(0.05, zoom / 1.25))} className="tool-btn" title="Zoom out">
        <Minus size={11} />
      </button>
      <button
        onClick={() => setZoom(1)}
        className="px-1.5 h-6 text-xs text-text-secondary hover:text-text-primary transition-colors min-w-[46px] text-center"
        title="Reset zoom"
      >
        {formatZoom(zoom)}
      </button>
      <button onClick={() => setZoom(Math.min(32, zoom * 1.25))} className="tool-btn" title="Zoom in">
        <Plus size={11} />
      </button>
    </div>
  );
}

export default function RightPanel() {
  const active = useLibraryStore(activeComponent);
  if (active) {
    return (
      <aside className="w-[260px] flex-shrink-0 flex flex-col border-l border-surface-border bg-surface-raised overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 h-9 border-b border-surface-border flex-shrink-0">
          <SlidersHorizontal size={12} className="text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">Repository component</span>
        </div>
        <RepoComponentPanel component={active} />
      </aside>
    );
  }
  return (
    <aside className="w-[260px] flex-shrink-0 flex flex-col border-l border-surface-border bg-surface-raised overflow-hidden">
      <ZoomControls />
      <div className="flex items-center gap-1.5 px-3 h-9 border-b border-surface-border flex-shrink-0">
        <SlidersHorizontal size={12} className="text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">Properties</span>
      </div>
      <PropertiesPanel />
    </aside>
  );
}
