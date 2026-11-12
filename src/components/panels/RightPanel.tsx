"use client";

import { SlidersHorizontal } from "lucide-react";
import { activeComponent, useLibraryStore } from "@/store/library";
import RepoComponentPanel from "./RepoComponentPanel";

// What can be changed about the open component: its props and variants, and in Edit mode the picked element.
export default function RightPanel() {
  const active = useLibraryStore(activeComponent);
  if (!active) return null;
  return (
    <aside className="w-[260px] flex-shrink-0 flex flex-col border-l border-surface-border bg-surface-raised overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 h-9 border-b border-surface-border flex-shrink-0">
        <SlidersHorizontal size={12} className="text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">Component</span>
      </div>
      <RepoComponentPanel component={active} />
    </aside>
  );
}
