"use client";

import { X } from "lucide-react";
import TokensView from "./views/TokensView";
import ComponentsView from "./views/ComponentsView";
import ChatView from "./views/ChatView";
import type { NavItem } from "./AppNav";

const PANEL_TITLES: Record<NavItem, string> = {
  components: "Components",
  tokens: "Tokens",
  chat: "AI Chat",
};

export default function ActivityPanel({
  activeNav,
  onClose,
}: {
  activeNav: NavItem;
  onClose: () => void;
}) {
  return (
    <div className="w-[300px] flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-surface-border flex-shrink-0">
        <span className="text-sm font-medium text-text-primary flex-1">{PANEL_TITLES[activeNav]}</span>
        <button
          onClick={onClose}
          title="Close panel"
          className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeNav === "components" && <ComponentsView />}
        {activeNav === "tokens" && <TokensView onClose={onClose} />}
        {activeNav === "chat" && <ChatView />}
      </div>
    </div>
  );
}
