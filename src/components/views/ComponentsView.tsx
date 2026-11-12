"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useCanvasStore } from "@/store/canvas";

const BUILT_IN = [
  { name: "Button", category: "UI", preview: "▸ Button" },
  { name: "Input", category: "UI", preview: "[ Input ]" },
  { name: "Card", category: "Layout", preview: "┌─ Card ─┐" },
  { name: "Badge", category: "UI", preview: "• Badge" },
  { name: "Avatar", category: "UI", preview: "○ Avatar" },
  { name: "Toggle", category: "UI", preview: "● Toggle" },
  { name: "Nav Bar", category: "Navigation", preview: "≡ Nav Bar" },
  { name: "Tab Bar", category: "Navigation", preview: "⊟ Tabs" },
  { name: "Modal", category: "Layout", preview: "┌─ Modal ─┐" },
  { name: "Dropdown", category: "UI", preview: "▾ Menu" },
  { name: "Tooltip", category: "UI", preview: "◌ Tip" },
  { name: "Chip", category: "UI", preview: "● Chip" },
];

export default function ComponentsView() {
  const [query, setQuery] = useState("");

  const filtered = query
    ? BUILT_IN.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : BUILT_IN;

  const categories = Array.from(new Set(filtered.map((c) => c.category)));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Search */}
      <div className="px-3 py-2 border-b border-surface-border">
        <div className="flex items-center gap-2 bg-surface-subtle border border-surface-border rounded px-2 py-1.5">
          <Search size={12} className="text-text-tertiary flex-shrink-0" />
          <input
            type="text"
            placeholder="Search components…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {categories.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-text-tertiary">No components found</span>
          </div>
        ) : (
          categories.map((cat) => (
            <div key={cat}>
              <p className="section-title">{cat}</p>
              <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
                {filtered
                  .filter((c) => c.category === cat)
                  .map((c) => (
                    <div
                      key={c.name}
                      className="flex flex-col items-center gap-1.5 p-2.5 rounded border border-surface-border bg-surface-subtle hover:border-accent/40 hover:bg-accent/5 cursor-grab transition-colors select-none"
                      title={`Add ${c.name}`}
                    >
                      <span className="text-2xs font-mono text-text-tertiary">{c.preview}</span>
                      <span className="text-xs text-text-secondary">{c.name}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
