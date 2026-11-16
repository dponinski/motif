"use client";

import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import { X, Download, Upload, Palette, GitBranch, Layers, Undo2, Redo2 } from "lucide-react";
import TokenSyncDialog from "@/components/git/TokenSyncDialog";
import FrameworkDialog from "@/components/git/FrameworkDialog";
import SetsSidebar from "@/components/tokens/SetsSidebar";
import ImportPanel from "@/components/tokens/ImportPanel";
import KindPane from "@/components/tokens/KindPane";
import { cn } from "@/lib/utils";
import { useDesignSystemStore, type TokenKind } from "@/store/design-system";
import { redoTokens, undoTokens, useTokenHistory } from "@/store/token-history";

const TABS: { kind: TokenKind; label: string }[] = [
  { kind: "color", label: "Colors" },
  { kind: "typography", label: "Typography" },
  { kind: "spacing", label: "Spacing" },
  { kind: "radius", label: "Radii" },
  { kind: "shadow", label: "Shadows" },
];

function downloadText(filename: string, content: string) {
  const a = document.createElement("a");
  a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

const headerButton = "flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors disabled:opacity-30 disabled:hover:bg-transparent";

// The tokens of the project: sets and themes on the left, and for the open set a tab for each kind of token.
export default function TokensView({ onClose }: { onClose?: () => void }) {
  const { sets, colors, typography, spacing, radii, shadows, exportTokens, exportCSS, exportTailwind } = useDesignSystemStore(useShallow((s) => ({
    sets: s.sets, colors: s.colors, typography: s.typography, spacing: s.spacing, radii: s.radii, shadows: s.shadows,
    exportTokens: s.exportTokens, exportCSS: s.exportCSS, exportTailwind: s.exportTailwind,
  })));
  const counts = { color: colors, typography, spacing, radius: radii, shadow: shadows };
  const [activeSetId, setActiveSetId] = useState<string>(sets[0]?.id ?? "");
  const [kind, setKind] = useState<TokenKind>("color");
  const [showImport, setShowImport] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [frameworkOpen, setFrameworkOpen] = useState(false);
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
          <button onClick={() => setSyncOpen(true)} className={headerButton}><GitBranch size={11} /> Repo sync</button>
          <button onClick={() => setFrameworkOpen(true)} className={headerButton}><Layers size={11} /> Add a framework</button>
          <button onClick={() => setShowImport(!showImport)} className={headerButton}><Upload size={11} /> Import</button>
          <button onClick={() => downloadText("tokens.json", exportTokens())} className={headerButton}><Download size={11} /> JSON</button>
          <button onClick={() => downloadText("tokens.css", exportCSS())} className={headerButton}><Download size={11} /> CSS</button>
          <button onClick={() => downloadText("tailwind.config.js", exportTailwind())} className={headerButton}><Download size={11} /> Tailwind</button>
        </div>

        <div className="w-px h-5 bg-surface-border" />

        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors" title="Back to the editor">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <SetsSidebar sets={sets} activeSetId={activeSetId} onSelectSet={(id) => { setActiveSetId(id); setKind("color"); }} />

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
                        onClick={() => setKind(t.kind)}
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
                <KindPane key={`${activeSet.id}:${kind}`} kind={kind} set={activeSet} sets={sets} />
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
