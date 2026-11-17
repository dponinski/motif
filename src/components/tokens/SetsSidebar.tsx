"use client";

import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { detachedBy } from "@/lib/tokens/alias-colors";
import { useDesignSystemStore, type TokenSet } from "@/store/design-system";
import { useGitStore } from "@/store/git";
import { editTokens } from "@/store/token-history";
import ConfirmDelete from "./ConfirmDelete";

// What a set holds, in words: "12 colors, 3 numbers".
function contentsOf(state: ReturnType<typeof useDesignSystemStore.getState>, setId: string): string {
  const count = (list: { setId: string }[]) => list.filter((t) => t.setId === setId).length;
  const parts: [number, string, string][] = [
    [count(state.colors), "color", "colors"], [count(state.numbers), "number", "numbers"], [count(state.strings), "string", "strings"],
    [count(state.typography), "text style", "text styles"], [count(state.spacing), "spacing", "spacings"], [count(state.radii), "radius", "radii"], [count(state.shadows), "shadow", "shadows"],
  ];
  return parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(", ");
}

const iconButton = "p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-overlay disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-tertiary";

// The collections: sets of tokens, each with a name and a note of what it is for ("Primitives", "Semantic colors that follow them"), in an
// order of their own. (The themes of the open set are managed in the bar over its colors.) Each change is a step of the Tokens screen's undo.
export default function SetsSidebar({
  sets,
  activeSetId,
  onSelectSet,
}: {
  sets: TokenSet[];
  activeSetId: string | null;
  onSelectSet: (id: string) => void;
}) {
  const { createSet, renameSet, setSetDescription, moveSet, deleteSet } = useDesignSystemStore(
    useShallow((s) => ({ createSet: s.createSet, renameSet: s.renameSet, setSetDescription: s.setSetDescription, moveSet: s.moveSet, deleteSet: s.deleteSet }))
  );
  const linkedSetId = useGitStore((s) => s.tokenLink?.setId ?? null);

  const [addingSet, setAddingSet] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(null);
  const [deleting, setDeleting] = useState<TokenSet | null>(null);

  const finishEdit = (take: boolean) => {
    const e = editing;
    setEditing(null);
    if (!take || !e) return;
    const set = sets.find((s) => s.id === e.id);
    if (!set) return;
    const name = e.name.trim() || set.name;
    editTokens(() => {
      if (name !== set.name) renameSet(set.id, name);
      if (e.description.trim() !== (set.description ?? "")) setSetDescription(set.id, e.description);
    });
  };

  const field = "w-full rounded border bg-surface-subtle px-1.5 py-0.5 text-xs text-text-primary outline-none border-accent";

  return (
    <div className="w-[220px] flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised overflow-hidden">
      <div data-bar className="flex h-bar items-center px-3 border-b border-surface-border flex-shrink-0">
        <p className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider">Collections</p>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sets.map((s, i) => (
          <div key={s.id} data-set-row={s.id}>
            {editing?.id === s.id ? (
              <div
                className="flex flex-col gap-1 px-3 py-2 bg-accent/10"
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finishEdit(true); }}
              >
                <input
                  className={field}
                  aria-label="Name of set"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") finishEdit(true); if (e.key === "Escape") finishEdit(false); }}
                  autoFocus
                />
                <input
                  className={field}
                  aria-label="What this set is for"
                  placeholder="What is it for?"
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") finishEdit(true); if (e.key === "Escape") finishEdit(false); }}
                />
              </div>
            ) : (
              <div
                className={cn(
                  "group flex items-start gap-1.5 px-3 py-2 cursor-pointer transition-colors",
                  activeSetId === s.id ? "bg-accent/10" : "hover:bg-surface-subtle"
                )}
                onClick={() => onSelectSet(s.id)}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("text-xs font-medium", activeSetId === s.id ? "text-accent" : "text-text-primary")}>{s.name}</span>
                  {s.description && <span data-set-description className="mt-0.5 line-clamp-2 text-2xs leading-snug text-text-tertiary">{s.description}</span>}
                </span>
                <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); editTokens(() => moveSet(s.id, -1)); }} disabled={i === 0} className={iconButton} title="Move up" aria-label={`Move ${s.name} up`}><ChevronUp size={10} /></button>
                  <button onClick={(e) => { e.stopPropagation(); editTokens(() => moveSet(s.id, 1)); }} disabled={i === sets.length - 1} className={iconButton} title="Move down" aria-label={`Move ${s.name} down`}><ChevronDown size={10} /></button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditing({ id: s.id, name: s.name, description: s.description ?? "" }); }}
                    className={iconButton}
                    title="Rename set and say what it is for"
                    aria-label={`Edit ${s.name}`}
                  >
                    <Pencil size={9} />
                  </button>
                  {sets.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleting(s); }}
                      className="p-0.5 rounded text-text-tertiary hover:text-red-400 hover:bg-red-400/10"
                      title="Delete set"
                      aria-label={`Delete ${s.name}`}
                    >
                      <Trash2 size={9} />
                    </button>
                  )}
                </span>
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
              aria-label="Name of the new set"
              value={newSetName}
              onChange={(e) => setNewSetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSetName.trim()) {
                  const id = editTokens(() => createSet(newSetName.trim()));
                  onSelectSet(id);
                  setNewSetName(""); setAddingSet(false);
                }
                if (e.key === "Escape") { setAddingSet(false); setNewSetName(""); }
              }}
              autoFocus
            />
            <button onClick={() => { setAddingSet(false); setNewSetName(""); }} className="text-text-tertiary hover:text-text-primary" aria-label="Cancel"><X size={10} /></button>
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

      {deleting && <DeleteSet set={deleting} linked={linkedSetId === deleting.id} onClose={() => setDeleting(null)} onDelete={() => {
        const gone = deleting;
        setDeleting(null);
        editTokens(() => deleteSet(gone.id));
        if (activeSetId === gone.id) onSelectSet(useDesignSystemStore.getState().sets[0]?.id ?? "");
      }} />}
    </div>
  );
}

function DeleteSet({ set, linked, onClose, onDelete }: { set: TokenSet; linked: boolean; onClose: () => void; onDelete: () => void }) {
  const contents = useDesignSystemStore((s) => contentsOf(s, set.id));
  const detached = useDesignSystemStore((s) => detachedBy(s.colors, set.id));
  return (
    <ConfirmDelete
      title={`Delete ${set.name}?`}
      confirm="Delete set"
      onConfirm={onDelete}
      onClose={onClose}
      blocked={linked ? "This is the set that is synced with the repository, so it can't be deleted while it is." : undefined}
    >
      <p data-delete-contents>{contents ? <>This takes away its tokens: {contents}.</> : "It has no tokens."}</p>
      {detached > 0 && <p data-delete-detached>{detached} {detached === 1 ? "alias" : "aliases"} of colors in other sets lead into it: those colors keep the colors they have now and stop following.</p>}
      <p className="text-text-tertiary">You can undo this.</p>
    </ConfirmDelete>
  );
}
