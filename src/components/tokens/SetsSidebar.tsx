"use client";

import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import { Plus, Trash2, X, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDesignSystemStore, type TokenSet } from "@/store/design-system";

// The sets of tokens. (The themes of the open set are managed in the bar over its colors.)
export default function SetsSidebar({
  sets,
  activeSetId,
  onSelectSet,
}: {
  sets: TokenSet[];
  activeSetId: string | null;
  onSelectSet: (id: string) => void;
}) {
  const { createSet, renameSet, deleteSet } = useDesignSystemStore(
    useShallow((s) => ({ createSet: s.createSet, renameSet: s.renameSet, deleteSet: s.deleteSet }))
  );

  const [addingSet, setAddingSet] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [renamingSetId, setRenamingSetId] = useState<string | null>(null);
  const [renamingSetName, setRenamingSetName] = useState("");

  return (
    <div className="w-[220px] flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised overflow-hidden">
      <div data-bar className="flex h-bar items-center px-3 border-b border-surface-border flex-shrink-0">
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
