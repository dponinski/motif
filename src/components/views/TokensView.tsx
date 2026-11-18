"use client";

import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { X, Palette, Undo2, Redo2, Plus } from "lucide-react";
import SetsSidebar from "@/components/tokens/SetsSidebar";
import SetPane, { type AddRequest } from "@/components/tokens/SetPane";
import { cn } from "@/lib/utils";
import { useDesignSystemStore, type TokenKind } from "@/store/design-system";
import { redoTokens, undoTokens, useTokenHistory } from "@/store/token-history";

// What a new token can be.
const NEW_TOKEN: { kind: TokenKind; label: string; hint: string }[] = [
  { kind: "color", label: "Color", hint: "a color, in each theme" },
  { kind: "number", label: "Number", hint: "a size, a weight, a ratio, with its unit" },
  { kind: "string", label: "String", hint: "text, such as a font family" },
  { kind: "composition", label: "Composition", hint: "tokens that go together: a text style, a shadow" },
];
const menuItem = "flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-xs text-text-secondary outline-none data-[highlighted]:bg-surface-subtle data-[highlighted]:text-text-primary";

const headerButton = "flex items-center gap-1 px-2.5 min-h-11 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors disabled:opacity-30 disabled:hover:bg-transparent";

// The tokens of the project: the sets on the left, and for the open set one table: a row for each token, a column for each theme.
export default function TokensView({ onClose }: { onClose?: () => void }) {
  const { sets, colors, typography, spacing, radii, shadows, numbers, strings, compositions } = useDesignSystemStore(useShallow((s) => ({
    sets: s.sets, colors: s.colors, typography: s.typography, spacing: s.spacing, radii: s.radii, shadows: s.shadows, numbers: s.numbers, strings: s.strings, compositions: s.compositions,
  })));
  const [activeSetId, setActiveSetId] = useState<string>(sets[0]?.id ?? "");
  // A kind chosen from New token opens with its add row ready.
  const [request, setRequest] = useState<AddRequest | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const canUndo = useTokenHistory((h) => h.past.length > 0);
  const canRedo = useTokenHistory((h) => h.future.length > 0);

  const activeSet = sets.find((s) => s.id === activeSetId) ?? sets[0];

  // Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, when no field has the keyboard (a field has its own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redoTokens(); else undoTokens();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-base">
      <div data-bar className="flex items-center gap-3 px-4 h-bar border-b border-surface-border bg-surface-raised flex-shrink-0">
        <Palette size={14} className="text-accent flex-shrink-0" />
        <span className="text-sm font-semibold text-text-primary flex-1">Design Tokens</span>

        <div className="flex items-center gap-1">
          <button onClick={() => undoTokens()} disabled={!canUndo} aria-label="Undo" title="Undo (Cmd/Ctrl+Z)" className={headerButton}><Undo2 size={12} /></button>
          <button onClick={() => redoTokens()} disabled={!canRedo} aria-label="Redo" title="Redo (Shift+Cmd/Ctrl+Z)" className={headerButton}><Redo2 size={12} /></button>
          <div className="mx-1 h-5 w-px bg-surface-border" />
          {/* Search, Filter and Bulk Add of the open set are drawn here by its pane. */}
          <div ref={setToolbar} data-toolbar className="flex items-center gap-2" />
          {activeSet && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <button type="button" aria-label="New token" title="Make a token: pick what it is" className="flex min-h-11 items-center gap-1.5 rounded-md bg-blaze px-3 text-sm font-semibold text-on-blaze transition-colors hover:bg-blaze/90"><Plus size={14} /> New token</button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content align="end" sideOffset={4} aria-label="New token" className="z-50 min-w-[230px] overflow-hidden rounded-md border border-surface-border bg-surface-raised py-1 shadow-lg">
                  {NEW_TOKEN.map((t) => (
                    <Menu.Item key={t.kind} className={menuItem} onSelect={() => setRequest((r) => ({ kind: t.kind, n: (r?.n ?? 0) + 1 }))}>
                      <span className="font-medium text-text-primary">{t.label}</span>
                      <span className="text-2xs text-text-tertiary">{t.hint}</span>
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          )}
        </div>

        <div className="w-px h-5 bg-surface-border" />

        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors" title="Back to the editor">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <SetsSidebar sets={sets} activeSetId={activeSetId} onSelectSet={(id) => { setActiveSetId(id); setRequest(null); }} />

        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSet ? (
            <>
              <div className="flex flex-shrink-0 items-center gap-2 px-4 pt-3 pb-1">
                <span className="text-base font-semibold text-text-primary flex-1">{activeSet.name}</span>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">
                <SetPane key={activeSet.id} set={activeSet} sets={sets} request={request} toolbar={toolbar} />
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
    </div>
  );
}
