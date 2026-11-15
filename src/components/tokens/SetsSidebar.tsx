"use client";

import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import { Plus, Trash2, X, Pencil, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDesignSystemStore, type TokenSet } from "@/store/design-system";

// The sets of tokens, and the themes of the one that is open.
export default function SetsSidebar({
  sets,
  activeSetId,
  onSelectSet,
}: {
  sets: TokenSet[];
  activeSetId: string | null;
  onSelectSet: (id: string) => void;
}) {
  const { createSet, renameSet, deleteSet, addThemeToSet, deleteThemeFromSet, renameTheme, setActiveTheme } = useDesignSystemStore(
    useShallow((s) => ({ createSet: s.createSet, renameSet: s.renameSet, deleteSet: s.deleteSet, addThemeToSet: s.addThemeToSet, deleteThemeFromSet: s.deleteThemeFromSet, renameTheme: s.renameTheme, setActiveTheme: s.setActiveTheme }))
  );

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
