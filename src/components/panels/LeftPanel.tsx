"use client";

import LayersSection from "./LayersSection";
import RepoComponentsSection from "./RepoComponentsSection";

export default function LeftPanel() {
  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised overflow-hidden">
      <RepoComponentsSection />
      <LayersSection />
    </aside>
  );
}
