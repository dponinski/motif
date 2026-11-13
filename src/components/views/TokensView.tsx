"use client";

import { useState } from "react";
import {
  Plus, Trash2, ChevronDown, ChevronRight, X, Pencil,
  Download, Upload, Palette, Check, GitBranch, Layers,
} from "lucide-react";
import TokenSyncDialog from "@/components/git/TokenSyncDialog";
import FrameworkDialog from "@/components/git/FrameworkDialog";
import { cn } from "@/lib/utils";
import {
  useDesignSystemStore,
  type ColorToken,
  type TypographyToken,
  type SpacingToken,
  type RadiusToken,
  type ShadowToken,
  type TokenSet,
} from "@/store/design-system";

type TokenTab = "colors" | "type" | "spacing" | "radii" | "shadows";

function downloadText(filename: string, content: string) {
  const a = document.createElement("a");
  a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

// ── Sets sidebar ───────────────────────────────────────────────────────────────

function SetsSidebar({
  sets,
  activeSetId,
  onSelectSet,
}: {
  sets: TokenSet[];
  activeSetId: string | null;
  onSelectSet: (id: string) => void;
}) {
  const { createSet, renameSet, deleteSet, addThemeToSet, deleteThemeFromSet, renameTheme, setActiveTheme } =
    useDesignSystemStore();

  const [addingSet, setAddingSet] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [renamingSetId, setRenamingSetId] = useState<string | null>(null);
  const [renamingSetName, setRenamingSetName] = useState("");
  const [addingThemeForSet, setAddingThemeForSet] = useState<string | null>(null);
  const [newThemeName, setNewThemeName] = useState("");
  const [renamingTheme, setRenamingTheme] = useState<{ setId: string; themeId: string; name: string } | null>(null);

  return (
    <div className="w-[220px] flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised overflow-hidden">
      <div className="px-3 py-2.5 border-b border-surface-border flex-shrink-0">
        <p className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider">Sets</p>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sets.map((s) => (
          <div key={s.id}>
            {/* Set row */}
            <div
              className={cn(
                "group flex items-center gap-1.5 px-3 py-2 cursor-pointer transition-colors",
                activeSetId === s.id ? "bg-accent/10" : "hover:bg-surface-subtle"
              )}
              onClick={() => onSelectSet(s.id)}
            >
              {renamingSetId === s.id ? (
                <input
                  className="flex-1 bg-surface-subtle border border-accent rounded px-1.5 py-0.5 text-xs text-text-primary outline-none"
                  value={renamingSetName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenamingSetName(e.target.value)}
                  onBlur={() => { renameSet(s.id, renamingSetName.trim() || s.name); setRenamingSetId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { renameSet(s.id, renamingSetName.trim() || s.name); setRenamingSetId(null); }
                    if (e.key === "Escape") setRenamingSetId(null);
                  }}
                  autoFocus
                />
              ) : (
                <>
                  <span className={cn("flex-1 text-xs font-medium", activeSetId === s.id ? "text-accent" : "text-text-primary")}>
                    {s.name}
                  </span>
                  <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingSetId(s.id); setRenamingSetName(s.name); }}
                      className="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-overlay"
                      title="Rename set"
                    >
                      <Pencil size={9} />
                    </button>
                    {sets.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSet(s.id); if (activeSetId === s.id) onSelectSet(sets.find(x => x.id !== s.id)?.id ?? ""); }}
                        className="p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"
                        title="Delete set"
                      >
                        <Trash2 size={9} />
                      </button>
                    )}
                  </span>
                </>
              )}
            </div>

            {/* Themes for this set */}
            {activeSetId === s.id && (
              <div className="px-3 pb-2">
                <p className="text-2xs text-text-tertiary mb-1.5 mt-0.5">Themes</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {s.themes.map((t) => (
                    <div key={t.id} className="group/theme relative flex items-center">
                      {renamingTheme?.themeId === t.id ? (
                        <input
                          className="bg-surface-subtle border border-accent rounded px-1.5 py-0.5 text-xs text-text-primary outline-none w-24"
                          value={renamingTheme.name}
                          onChange={(e) => setRenamingTheme({ ...renamingTheme, name: e.target.value })}
                          onBlur={() => { renameTheme(s.id, t.id, renamingTheme.name.trim() || t.name); setRenamingTheme(null); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { renameTheme(s.id, t.id, renamingTheme.name.trim() || t.name); setRenamingTheme(null); }
                            if (e.key === "Escape") setRenamingTheme(null);
                          }}
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => setActiveTheme(s.id, t.id)}
                          onDoubleClick={() => setRenamingTheme({ setId: s.id, themeId: t.id, name: t.name })}
                          className={cn(
                            "flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors",
                            s.activeThemeId === t.id
                              ? "bg-accent/15 border-accent/40 text-accent"
                              : "border-surface-border text-text-secondary hover:border-accent/30 hover:text-text-primary"
                          )}
                        >
                          {s.activeThemeId === t.id && <Check size={9} />}
                          {t.name}
                        </button>
                      )}
                      {s.themes.length > 1 && (
                        <button
                          onClick={() => deleteThemeFromSet(s.id, t.id)}
                          className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full text-white opacity-0 group-hover/theme:opacity-100 flex items-center justify-center transition-opacity"
                          title="Remove theme"
                        >
                          <X size={8} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {addingThemeForSet === s.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      className="flex-1 bg-surface-subtle border border-surface-border rounded px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent"
                      placeholder="Theme name…"
                      value={newThemeName}
                      onChange={(e) => setNewThemeName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newThemeName.trim()) {
                          addThemeToSet(s.id, newThemeName.trim());
                          setNewThemeName(""); setAddingThemeForSet(null);
                        }
                        if (e.key === "Escape") { setAddingThemeForSet(null); setNewThemeName(""); }
                      }}
                      autoFocus
                    />
                    <button onClick={() => { setAddingThemeForSet(null); setNewThemeName(""); }} className="text-text-tertiary hover:text-text-primary"><X size={10} /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingThemeForSet(s.id)}
                    className="flex items-center gap-1 text-2xs text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    <Plus size={9} /> Add theme
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* New set */}
        {addingSet ? (
          <div className="px-3 py-1.5 flex items-center gap-1.5">
            <input
              className="flex-1 bg-surface-subtle border border-surface-border rounded px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent"
              placeholder="Set name…"
              value={newSetName}
              onChange={(e) => setNewSetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSetName.trim()) {
                  const id = createSet(newSetName.trim());
                  onSelectSet(id);
                  setNewSetName(""); setAddingSet(false);
                }
                if (e.key === "Escape") { setAddingSet(false); setNewSetName(""); }
              }}
              autoFocus
            />
            <button onClick={() => { setAddingSet(false); setNewSetName(""); }} className="text-text-tertiary hover:text-text-primary"><X size={10} /></button>
          </div>
        ) : (
          <button
            onClick={() => setAddingSet(true)}
            className="flex items-center gap-1.5 px-3 py-2 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
          >
            <Plus size={10} /> New set
          </button>
        )}
      </div>
    </div>
  );
}

// ── Color section ──────────────────────────────────────────────────────────────

function ColorGroup({
  group,
  tokens,
  themes,
  activeThemeId,
  setId,
}: {
  group: string;
  tokens: ColorToken[];
  themes: { id: string; name: string }[];
  activeThemeId: string;
  setId: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { updateColor, updateColorThemeValue, deleteColor, addColor } = useDesignSystemStore();

  return (
    <div className="mb-1">
      {/* The toggle and the add button are side by side: a button can't hold another button. */}
      <div className="flex items-center w-full hover:bg-surface-subtle transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex flex-1 min-w-0 items-center gap-1.5 pl-4 pr-1 py-1.5 text-left"
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          <span className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider flex-1 capitalize">{group}</span>
          <span className="text-2xs text-text-tertiary mr-2">{tokens.length}</span>
        </button>
        <button
          className="mr-4 p-0.5 rounded hover:bg-surface-overlay text-text-tertiary hover:text-text-primary"
          title="Add color to group"
          onClick={() => addColor({ name: `${group}-new`, value: "#6366f1", group, setId })}
        >
          <Plus size={9} />
        </button>
      </div>

      {expanded && (
        <div className="pb-1">
          {tokens.map((token) => (
            <div key={token.id} className="group/row">
              {editingId === token.id ? (
                <div className="px-4 py-2 flex items-center gap-2 bg-surface-subtle border-y border-surface-border">
                  <input
                    className="flex-1 bg-surface-base border border-surface-border rounded px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent min-w-0"
                    value={token.name}
                    onChange={(e) => updateColor(token.id, { name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingId(null); }}
                    autoFocus
                  />
                  <button onClick={() => setEditingId(null)} className="text-text-tertiary hover:text-text-primary flex-shrink-0"><X size={10} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-1.5 hover:bg-surface-subtle transition-colors">
                  {/* Token name */}
                  <span className="text-xs text-text-secondary w-32 truncate flex-shrink-0">{token.name}</span>

                  {/* Per-theme color swatches */}
                  <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
                    {themes.map((theme) => {
                      const val = token.themeValues[theme.id] ?? token.value;
                      const isActive = theme.id === activeThemeId;
                      return (
                        <div
                          key={theme.id}
                          className={cn("flex items-center gap-1.5 flex-shrink-0", isActive && "opacity-100", !isActive && "opacity-60")}
                          title={`${theme.name}: ${val}`}
                        >
                          <label className={cn("flex items-center gap-1 cursor-pointer group/swatch rounded px-1 py-0.5 hover:bg-surface-overlay transition-colors", isActive && "ring-1 ring-accent/30 bg-surface-overlay/50")}>
                            <input
                              type="color"
                              value={val.startsWith("rgba") ? "#000000" : val}
                              onChange={(e) => updateColorThemeValue(token.id, theme.id, e.target.value)}
                              className="w-5 h-5 rounded border-0 cursor-pointer"
                            />
                            <span className="text-2xs text-text-tertiary font-mono">{themes.length > 1 ? theme.name : val}</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 flex-shrink-0">
                    <button onClick={() => setEditingId(token.id)} className="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-overlay"><Pencil size={9} /></button>
                    <button onClick={() => deleteColor(token.id)} className="p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"><Trash2 size={9} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorsEditor({ setId, themes, activeThemeId }: { setId: string; themes: { id: string; name: string }[]; activeThemeId: string }) {
  const { colors, addColor } = useDesignSystemStore();
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const setColors = colors.filter((c) => c.setId === setId);
  const groups = Array.from(new Set(setColors.map((c) => c.group)));

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map((group) => (
        <ColorGroup
          key={group}
          group={group}
          tokens={setColors.filter((c) => c.group === group)}
          themes={themes}
          activeThemeId={activeThemeId}
          setId={setId}
        />
      ))}

      {addingGroup ? (
        <div className="px-4 py-2 flex items-center gap-1.5">
          <input
            className="flex-1 bg-surface-subtle border border-surface-border rounded px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent"
            placeholder="Group name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newGroupName.trim()) {
                addColor({ name: `${newGroupName.trim()}-500`, value: "#6366f1", group: newGroupName.trim(), setId });
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
          className="flex items-center gap-1.5 px-4 py-2 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
        >
          <Plus size={10} /> New group
        </button>
      )}
    </div>
  );
}

// ── Typography section ─────────────────────────────────────────────────────────

function TypoEditor({ setId }: { setId: string }) {
  const { typography, addTypography, updateTypography, deleteTypography } = useDesignSystemStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const tokens = typography.filter((t) => t.setId === setId);

  return (
    <div className="flex-1 overflow-y-auto">
      {tokens.map((t) => (
        <div key={t.id} className="group/typo border-b border-surface-border">
          {editingId === t.id ? (
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  className="flex-1 text-sm font-medium bg-transparent border-b border-accent outline-none text-text-primary"
                  value={t.name}
                  onChange={(e) => updateTypography(t.id, { name: e.target.value })}
                />
                <button onClick={() => setEditingId(null)} className="text-text-tertiary hover:text-text-primary"><X size={10} /></button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {([["Family", "fontFamily", "text"], ["Size", "fontSize", "number"], ["Weight", "fontWeight", "number"], ["Line h", "lineHeight", "number"]] as const).map(([label, key, type]) => (
                  <div key={key}>
                    <label className="text-2xs text-text-tertiary">{label}</label>
                    <input
                      type={type}
                      className="input-sm mt-0.5"
                      value={t[key as keyof typeof t] as string | number}
                      onChange={(e) => updateTypography(t.id, { [key]: type === "number" ? parseFloat(e.target.value) || t[key as keyof typeof t] : e.target.value } as Parameters<typeof updateTypography>[1])}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="text-xs font-medium text-text-primary">{t.name}</span>
                  <span className="text-2xs text-text-tertiary">{t.fontSize}px · {t.fontWeight} · {t.lineHeight}</span>
                </div>
                <p className="text-text-secondary truncate" style={{ fontFamily: t.fontFamily, fontSize: Math.min(14, t.fontSize), fontWeight: t.fontWeight, lineHeight: "1.4" }}>
                  The quick brown fox
                </p>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover/typo:opacity-100 flex-shrink-0">
                <button onClick={() => setEditingId(t.id)} className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-overlay"><Pencil size={10} /></button>
                <button onClick={() => deleteTypography(t.id)} className="p-1 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"><Trash2 size={10} /></button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button
        onClick={() => addTypography({ name: "new-style", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20, setId })}
        className="flex items-center gap-1.5 px-4 py-2 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
      >
        <Plus size={10} /> Add style
      </button>
    </div>
  );
}

// ── Spacing section ────────────────────────────────────────────────────────────

function SpacingEditor({ setId }: { setId: string }) {
  const { spacing, addSpacing, updateSpacing, deleteSpacing } = useDesignSystemStore();
  const tokens = spacing.filter((sp) => sp.setId === setId);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-2">
        {tokens.map((sp) => (
          <div key={sp.id} className="group/sp flex items-center gap-3 py-2 border-b border-surface-border last:border-0">
            <div className="bg-accent/30 h-2 rounded-sm flex-shrink-0" style={{ width: Math.min(sp.value, 120) }} />
            <input className="flex-1 bg-transparent text-xs text-text-primary outline-none" value={sp.name} onChange={(e) => updateSpacing(sp.id, { name: e.target.value })} />
            <input type="number" className="w-12 bg-transparent text-xs font-mono text-text-tertiary outline-none text-right" value={sp.value} onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) updateSpacing(sp.id, { value: n }); }} />
            <span className="text-2xs text-text-tertiary flex-shrink-0">px</span>
            <button onClick={() => deleteSpacing(sp.id)} className="opacity-0 group-hover/sp:opacity-100 p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"><Trash2 size={10} /></button>
          </div>
        ))}
        <button onClick={() => addSpacing({ name: "space-new", value: 16, setId })} className="flex items-center gap-1.5 py-2 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary transition-colors">
          <Plus size={10} /> Add spacing
        </button>
      </div>
    </div>
  );
}

// ── Radii section ──────────────────────────────────────────────────────────────

function RadiiEditor({ setId }: { setId: string }) {
  const { radii, addRadius, updateRadius, deleteRadius } = useDesignSystemStore();
  const tokens = radii.filter((r) => r.setId === setId);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-2">
        {tokens.map((r) => (
          <div key={r.id} className="group/rad flex items-center gap-3 py-2 border-b border-surface-border last:border-0">
            <div className="w-6 h-6 border border-surface-border bg-surface-subtle flex-shrink-0" style={{ borderRadius: Math.min(r.value, 12) }} />
            <input className="flex-1 bg-transparent text-xs text-text-primary outline-none" value={r.name} onChange={(e) => updateRadius(r.id, { name: e.target.value })} />
            <input type="number" className="w-12 bg-transparent text-xs font-mono text-text-tertiary outline-none text-right" value={r.value === 9999 ? 9999 : r.value} onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) updateRadius(r.id, { value: n }); }} />
            <button onClick={() => deleteRadius(r.id)} className="opacity-0 group-hover/rad:opacity-100 p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"><Trash2 size={10} /></button>
          </div>
        ))}
        <button onClick={() => addRadius({ name: "radius-new", value: 4, setId })} className="flex items-center gap-1.5 py-2 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary transition-colors">
          <Plus size={10} /> Add radius
        </button>
      </div>
    </div>
  );
}

// ── Shadows section ────────────────────────────────────────────────────────────

function ShadowsEditor({ setId }: { setId: string }) {
  const { shadows, addShadow, updateShadow, deleteShadow } = useDesignSystemStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const tokens = shadows.filter((sh) => sh.setId === setId);

  return (
    <div className="flex-1 overflow-y-auto">
      {tokens.map((sh) => {
        const preview = `${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread}px ${sh.color}`;
        return (
          <div key={sh.id} className="group/sh border-b border-surface-border">
            {editingId === sh.id ? (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <input className="flex-1 text-sm font-medium bg-transparent border-b border-accent outline-none text-text-primary" value={sh.name} onChange={(e) => updateShadow(sh.id, { name: e.target.value })} />
                  <button onClick={() => setEditingId(null)} className="text-text-tertiary hover:text-text-primary"><X size={10} /></button>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {(["x", "y", "blur", "spread"] as const).map((k) => (
                    <div key={k}>
                      <label className="text-2xs text-text-tertiary capitalize">{k}</label>
                      <input type="number" className="input-sm mt-0.5" value={sh[k]} onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) updateShadow(sh.id, { [k]: n }); }} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input type="color" value={sh.color.startsWith("rgba") ? "#000000" : sh.color} onChange={(e) => updateShadow(sh.id, { color: e.target.value })} className="w-6 h-6 rounded border-0 cursor-pointer flex-shrink-0" />
                  <input className="input-sm flex-1" value={sh.color} onChange={(e) => updateShadow(sh.id, { color: e.target.value })} placeholder="rgba(0,0,0,0.1)" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle transition-colors">
                <div className="w-8 h-8 bg-surface-base rounded flex-shrink-0 border border-surface-border" style={{ boxShadow: preview }} />
                <span className="flex-1 text-xs text-text-primary">{sh.name}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/sh:opacity-100 flex-shrink-0">
                  <button onClick={() => setEditingId(sh.id)} className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-overlay"><Pencil size={10} /></button>
                  <button onClick={() => deleteShadow(sh.id)} className="p-1 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"><Trash2 size={10} /></button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="px-4">
        <button onClick={() => addShadow({ name: "shadow-new", x: 0, y: 4, blur: 8, spread: 0, color: "rgba(0,0,0,0.1)", group: "default", setId })} className="flex items-center gap-1.5 py-2 w-full text-left text-2xs text-text-tertiary hover:text-text-secondary transition-colors">
          <Plus size={10} /> Add shadow
        </button>
      </div>
    </div>
  );
}

// ── Import panel ───────────────────────────────────────────────────────────────

function ImportPanel({ onClose }: { onClose: () => void }) {
  const { importFromJSON } = useDesignSystemStore();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");

  const handleImport = () => {
    const result = importFromJSON(text);
    if (result.errors.length) {
      setMsg(`Errors: ${result.errors.join(", ")}`);
    } else {
      setMsg(`Imported ${result.imported} tokens`);
      setTimeout(onClose, 1200);
    }
  };

  return (
    <div className="border-t border-surface-border p-4 bg-surface-raised flex-shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-sm font-medium text-text-primary flex-1">Import W3C JSON</p>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={13} /></button>
      </div>
      <textarea
        className="w-full bg-surface-subtle border border-surface-border rounded px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent font-mono resize-none"
        rows={6}
        placeholder={'{"color": {"primary": {"500": {"$value": "#6366f1", "$type": "color"}}}}'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {msg && <p className="text-2xs mt-1 text-accent">{msg}</p>}
      <div className="flex gap-2 mt-2">
        <button onClick={handleImport} className="flex-1 bg-accent hover:bg-accent/90 text-white text-xs py-1.5 rounded transition-colors">Import</button>
        <button onClick={onClose} className="flex-1 border border-surface-border text-text-secondary hover:text-text-primary text-xs py-1.5 rounded transition-colors">Cancel</button>
      </div>
    </div>
  );
}

// ── Main TokensView (full-screen) ──────────────────────────────────────────────

export default function TokensView({ onClose }: { onClose?: () => void }) {
  const { sets, exportTokens, exportCSS, exportTailwind } = useDesignSystemStore();
  const [activeSetId, setActiveSetId] = useState<string>(sets[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState<TokenTab>("colors");
  const [showImport, setShowImport] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [frameworkOpen, setFrameworkOpen] = useState(false);

  const activeSet = sets.find((s) => s.id === activeSetId) ?? sets[0];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-base">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-11 border-b border-surface-border bg-surface-raised flex-shrink-0">
        <Palette size={14} className="text-accent flex-shrink-0" />
        <span className="text-sm font-semibold text-text-primary flex-1">Design Tokens</span>

        {/* Export actions */}
        <div className="flex items-center gap-1">
          <button onClick={() => setSyncOpen(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <GitBranch size={11} /> Repo sync
          </button>
          <button onClick={() => setFrameworkOpen(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <Layers size={11} /> Add a framework
          </button>
          <button onClick={() => setShowImport(!showImport)} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <Upload size={11} /> Import
          </button>
          <button onClick={() => downloadText("tokens.json", exportTokens())} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <Download size={11} /> JSON
          </button>
          <button onClick={() => downloadText("tokens.css", exportCSS())} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <Download size={11} /> CSS
          </button>
          <button onClick={() => downloadText("tailwind.config.js", exportTailwind())} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors">
            <Download size={11} /> Tailwind
          </button>
        </div>

        <div className="w-px h-5 bg-surface-border" />

        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors" title="Back to the editor">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sets sidebar */}
        <SetsSidebar
          sets={sets}
          activeSetId={activeSetId}
          onSelectSet={(id) => { setActiveSetId(id); setActiveTab("colors"); }}
        />

        {/* Token editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSet ? (
            <>
              {/* Set header + tab bar */}
              <div className="border-b border-surface-border flex-shrink-0">
                <div className="flex items-center gap-2 px-4 pt-3 pb-0">
                  <span className="text-base font-semibold text-text-primary flex-1">{activeSet.name}</span>
                </div>
                <div className="flex gap-0.5 px-4 pt-2">
                  {(["colors", "type", "spacing", "radii", "shadows"] as TokenTab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "px-3 py-1.5 text-xs rounded-t transition-colors capitalize",
                        activeTab === tab
                          ? "text-text-primary bg-surface-subtle border-b-2 border-accent"
                          : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      {tab === "type" ? "Typography" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === "colors" && (
                  <ColorsEditor
                    setId={activeSet.id}
                    themes={activeSet.themes}
                    activeThemeId={activeSet.activeThemeId}
                  />
                )}
                {activeTab === "type" && <TypoEditor setId={activeSet.id} />}
                {activeTab === "spacing" && <SpacingEditor setId={activeSet.id} />}
                {activeTab === "radii" && <RadiiEditor setId={activeSet.id} />}
                {activeTab === "shadows" && <ShadowsEditor setId={activeSet.id} />}

                {showImport && <ImportPanel onClose={() => setShowImport(false)} />}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Palette size={32} className="text-text-tertiary mx-auto mb-3" />
                <p className="text-sm text-text-secondary mb-1">No set selected</p>
                <p className="text-xs text-text-tertiary">Create a set to get started</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <TokenSyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
      <FrameworkDialog open={frameworkOpen} onOpenChange={setFrameworkOpen} />
    </div>
  );
}
