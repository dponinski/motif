"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";

const ChatView = dynamic(() => import("./views/ChatView"), { loading: () => null });
const SourceControl = dynamic(() => import("./views/SourceControl"), { loading: () => null });

export default function ActivityPanel({
  activeNav,
  onClose,
  onOpenReport,
}: {
  activeNav: "chat" | "git";
  onClose: () => void;
  onOpenReport: () => void;
}) {
  return (
    <div className="w-[300px] flex-shrink-0 flex flex-col border-r border-surface-border bg-surface-raised overflow-hidden">
      <div data-bar className="flex items-center gap-2 px-3 h-bar border-b border-surface-border flex-shrink-0">
        <span className="text-sm font-medium text-text-primary flex-1">{activeNav === "chat" ? "AI Chat" : "Source control"}</span>
        <button
          onClick={onClose}
          title="Close panel"
          className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-subtle transition-colors"
        >
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeNav === "chat" ? <ChatView /> : <SourceControl onOpenReport={onOpenReport} />}
      </div>
    </div>
  );
}
