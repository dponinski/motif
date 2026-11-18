"use client";

import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { X, Palette, Undo2, Redo2, Plus } from "lucide-react";
import SetsSidebar from "@/components/tokens/SetsSidebar";
import KindPane from "@/components/tokens/KindPane";
import { cn } from "@/lib/utils";
import { useDesignSystemStore, type TokenKind } from "@/store/design-system";
import { redoTokens, undoTokens, useTokenHistory } from "@/store/token-history";

const TABS: { kind: TokenKind; label: string }[] = [
  { kind: "color", label: "Colors" },
  { kind: "number", label: "Numbers" },
  { kind: "string", label: "Strings" },
  { kind: "composition", label: "Compositions" },
  { kind: "typography", label: "Typography" },
  { kind: "spacing", label: "Spacing" },
  { kind: "radius", label: "Radii" },
  { kind: "shadow", label: "Shadows" },
];

// What a new token can be.
const NEW_TOKEN: { kind: TokenKind; label: string; hint: string }[] = [
  { kind: "color", label: "Color", hint: "a color, in each theme" },
  { kind: "number", label: "Number", hint: "a size, a weight, a ratio, with its unit" },
  { kind: "string", label: "String", hint: "text, such as a font family" },
  { kind: "composition", label: "Composition", hint: "tokens that go together: a text style, a shadow" },
];
const menuItem = "flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-xs text-text-secondary outline-none data-[highlighted]:bg-surface-subtle data-[highlighted]:text-text-primary";

const headerButton = "flex items-center gap-1 px-2.5 min-h-11 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors disabled:opacity-30 disabled:hover:bg-transparent";

// The tokens of the project: sets and themes on the left, and for the open set a tab for each kind of token.
export default function TokensView({ onClose }: { onClose?: () => void }) {
  const { sets, colors, typography, spacing, radii, shadows, numbers, strings, compositions } = useDesignSystemStore(useShallow((s) => ({
    sets: s.sets, colors: s.colors, typography: s.typography, spacing: s.spacing, radii: s.radii, shadows: s.shadows, numbers: s.numbers, strings: s.strings, compositions: s.compositions,
  })));
  const counts = {
    color: colors, typography, shadow: shadows, string: strings, composition: compositions,
    spacing: [...spacing, ...numbers.filter((n) => n.use === "spacing")], radius: [...radii, ...numbers.filter((n) => n.use === "radius")],
    number: numbers.filter((n) => n.use !== "spacing" && n.use !== "radius"),
  };
  const [activeSetId, setActiveSetId] = useState<string>(sets[0]?.id ?? "");
  const [kind, setKind] = useState<TokenKind>("color");
  // A kind chosen from New token opens with its add row ready.
  const [adding, setAdding] = useState(0);
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
          {activeSet && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <button type="button" aria-label="New token" title="Make a token: pick what it is" className="flex min-h-11 items-center gap-1.5 rounded-md bg-blaze px-3 text-sm font-semibold text-on-blaze transition-colors hover:bg-blaze/90"><Plus size={14} /> New token</button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content align="end" sideOffset={4} aria-label="New token" className="z-50 min-w-[230px] overflow-hidden rounded-md border border-surface-border bg-surface-raised py-1 shadow-lg">
                  {NEW_TOKEN.map((t) => (
                    <Menu.Item key={t.kind} className={menuItem} onSelect={() => { setKind(t.kind); setAdding((n) => n + 1); }}>
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
        <SetsSidebar sets={sets} activeSetId={activeSetId} onSelectSet={(id) => { setActiveSetId(id); setKind("color"); setAdding(0); }} />

        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSet ? (
            <>
              <div className="border-b border-surface-border flex-shrink-0">
                <div className="flex items-center gap-2 px-4 pt-3 pb-0">
                  <span className="text-base font-semibold text-text-primary flex-1">{activeSet.name}</span>
                </div>
                <div className="flex gap-0.5 px-4 pt-2" role="tablist" aria-label="Kinds of token">
                  {TABS.map((t) => {
                    const n = counts[t.kind].filter((x) => x.setId === activeSet.id).length;
                    return (
                      <button
                        key={t.kind}
                        role="tab"
                        aria-selected={kind === t.kind}
                        onClick={() => { setKind(t.kind); setAdding(0); }}
                        className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t transition-colors", kind === t.kind ? "text-text-primary bg-surface-subtle border-b-2 border-accent" : "text-text-tertiary hover:text-text-secondary")}
                      >
                        {t.label}
                        <span className="text-2xs tabular-nums text-text-tertiary">{n}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                <KindPane key={`${activeSet.id}:${kind}:${adding}`} kind={kind} set={activeSet} sets={sets} addOnOpen={adding > 0} />
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
