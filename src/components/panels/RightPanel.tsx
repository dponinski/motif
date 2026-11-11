"use client";

import { useState, useEffect } from "react";
import {
  SlidersHorizontal,
  Palette,
  Plus,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  Type,
  AlignLeft,
} from "lucide-react";
import { cn, contrastColor } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas";
import {
  useDesignSystemStore,
  type ColorToken,
  type TypographyToken,
  type SpacingToken,
} from "@/store/design-system";

type Tab = "properties" | "tokens";

// ─── Properties Panel ────────────────────────────────────────────────────────

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

  useEffect(() => {
    setLocal(String(Math.round(value)));
  }, [value]);

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
          onChange={(e) => {
            setLocal(e.target.value);
            const n = parseFloat(e.target.value);
            if (!isNaN(n)) onChange(n);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); }
          }}
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
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-xs text-text-primary outline-none font-mono"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

function PropertiesPanel() {
  const { elements, selectedIds, updateElement, pushHistory } = useCanvasStore();
  const { colors } = useDesignSystemStore();

  if (!selectedIds.length) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <SlidersHorizontal size={18} className="text-text-tertiary" />
        <span className="text-xs text-text-tertiary">Select an element</span>
      </div>
    );
  }

  if (selectedIds.length > 1) {
    return (
      <div className="p-3">
        <p className="text-xs text-text-secondary">{selectedIds.length} elements selected</p>
      </div>
    );
  }

  const el = elements[selectedIds[0]];
  if (!el) return null;

  // Live update (no history) — called on every keystroke/drag
  const update = (updates: Parameters<typeof updateElement>[1]) => {
    updateElement(el.id, updates);
  };
  // Commit to history — called on blur / Enter / select change
  const commit = () => pushHistory();

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Element name */}
      <div className="px-3 py-2 border-b border-surface-border">
        <input
          className="input-sm"
          value={el.name}
          onChange={(e) => updateElement(el.id, { name: e.target.value })}
          onBlur={commit}
        />
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
          <ColorInput
            label="Color"
            value={el.fill ?? "#6366f1"}
            onChange={(v) => { update({ fill: v }); commit(); }}
          />

          {/* Token picker */}
          <div className="flex flex-wrap gap-1 mt-2">
            {colors.slice(0, 12).map((c) => (
              <button
                key={c.id}
                title={c.name}
                onClick={() => update({ fill: c.value, fillTokenId: c.id })}
                className={cn(
                  "w-5 h-5 rounded border transition-all",
                  el.fillTokenId === c.id
                    ? "border-white scale-110"
                    : "border-transparent hover:scale-110"
                )}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Stroke */}
      {el.type !== "text" && (
        <div className="px-3 py-2 border-b border-surface-border">
          <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Stroke</p>
          <div className="grid grid-cols-2 gap-2">
            <ColorInput
              label="Color"
              value={el.stroke ?? "#000000"}
              onChange={(v) => { update({ stroke: v }); commit(); }}
            />
            <NumberInput
              label="Width"
              value={el.strokeWidth ?? 0}
              onChange={(v) => update({ strokeWidth: Math.max(0, v) })}
              onCommit={commit}
            />
          </div>
        </div>
      )}

      {/* Corner Radius */}
      {(el.type === "rectangle" || el.type === "frame") && (
        <div className="px-3 py-2 border-b border-surface-border">
          <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Corner Radius</p>
          <NumberInput
            label="Radius"
            value={el.cornerRadius ?? 0}
            onChange={(v) => update({ cornerRadius: Math.max(0, v) })}
            onCommit={commit}
          />
        </div>
      )}

      {/* Text */}
      {el.type === "text" && (
        <div className="px-3 py-2 border-b border-surface-border">
          <p className="text-2xs text-text-tertiary mb-2 font-medium uppercase tracking-wider">Typography</p>
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-2xs text-text-tertiary">Content</label>
              <textarea
                className="input-sm mt-1 resize-none"
                rows={3}
                value={el.content ?? ""}
                onChange={(e) => update({ content: e.target.value })}
                onBlur={commit}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Size" value={el.fontSize ?? 16} onChange={(v) => update({ fontSize: v })} onCommit={commit} />
              <div>
                <label className="text-2xs text-text-tertiary">Weight</label>
                <select
                  className="input-sm mt-1"
                  value={el.fontWeight ?? "400"}
                  onChange={(e) => { update({ fontWeight: e.target.value }); commit(); }}
                >
                  <option value="300">Light</option>
                  <option value="400">Regular</option>
                  <option value="500">Medium</option>
                  <option value="600">Semibold</option>
                  <option value="700">Bold</option>
                </select>
              </div>
            </div>
            <ColorInput
              label="Color"
              value={el.fontColor ?? "#0a0a0a"}
              onChange={(v) => { update({ fontColor: v }); commit(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Design Tokens Panel ──────────────────────────────────────────────────────

function ColorGroup({ group, tokens }: { group: string; tokens: ColorToken[] }) {
  const [expanded, setExpanded] = useState(true);
  const { deleteColor } = useDesignSystemStore();

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 px-3 py-1.5 w-full text-left hover:bg-surface-subtle"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider capitalize">
          {group}
        </span>
        <span className="ml-1 text-2xs text-text-tertiary">({tokens.length})</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2">
          <div className="grid grid-cols-5 gap-1.5">
            {tokens.map((token) => (
              <div key={token.id} className="group relative flex flex-col items-center gap-1">
                <div
                  className="w-8 h-8 rounded border border-white/10 cursor-pointer hover:scale-110 transition-transform"
                  style={{ backgroundColor: token.value }}
                  title={`${token.name}: ${token.value}`}
                />
                <span className="text-2xs text-text-tertiary text-center leading-tight truncate w-full text-center">
                  {token.name.split("-").pop()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TypographyRow({ token }: { token: TypographyToken }) {
  return (
    <div className="px-3 py-2 hover:bg-surface-subtle border-b border-surface-border last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-text-primary">{token.name}</span>
        <span className="text-2xs text-text-tertiary">{token.fontSize}/{token.lineHeight}</span>
      </div>
      <p
        className="text-text-secondary truncate"
        style={{
          fontFamily: token.fontFamily,
          fontSize: Math.min(14, token.fontSize),
          fontWeight: token.fontWeight,
          lineHeight: "1.4",
        }}
      >
        The quick brown fox
      </p>
    </div>
  );
}

function DesignTokensPanel() {
  const [activeSection, setActiveSection] = useState<"colors" | "type" | "spacing">("colors");
  const { colors, typography, spacing } = useDesignSystemStore();

  const colorGroups = colors.reduce<Record<string, ColorToken[]>>((acc, c) => {
    if (!acc[c.group]) acc[c.group] = [];
    acc[c.group].push(c);
    return acc;
  }, {});

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Section tabs */}
      <div className="flex border-b border-surface-border px-2 pt-1 gap-1">
        {(["colors", "type", "spacing"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={cn(
              "px-2 py-1.5 text-xs rounded-t transition-colors capitalize",
              activeSection === s
                ? "text-text-primary bg-surface-subtle"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {s === "type" ? "Type" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeSection === "colors" && (
          <div className="py-1">
            {Object.entries(colorGroups).map(([group, tokens]) => (
              <ColorGroup key={group} group={group} tokens={tokens} />
            ))}
          </div>
        )}

        {activeSection === "type" && (
          <div>
            {typography.map((t) => (
              <TypographyRow key={t.id} token={t} />
            ))}
          </div>
        )}

        {activeSection === "spacing" && (
          <div className="px-3 py-2">
            {spacing.map((sp) => (
              <div key={sp.id} className="flex items-center gap-3 py-1.5 border-b border-surface-border last:border-0">
                <div
                  className="bg-accent/30 h-2 rounded-sm flex-shrink-0"
                  style={{ width: Math.min(sp.value, 120) }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-primary">{sp.name}</p>
                </div>
                <span className="text-xs font-mono text-text-tertiary flex-shrink-0">{sp.value}px</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function RightPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("properties");

  return (
    <aside className="w-[260px] flex-shrink-0 flex flex-col border-l border-surface-border bg-surface-raised overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-surface-border">
        {(["properties", "tokens"] as Tab[]).map((tab) => (
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
            {tab === "properties" ? (
              <span className="flex items-center justify-center gap-1">
                <SlidersHorizontal size={11} /> Properties
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1">
                <Palette size={11} /> Tokens
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "properties" ? <PropertiesPanel /> : <DesignTokensPanel />}
    </aside>
  );
}
