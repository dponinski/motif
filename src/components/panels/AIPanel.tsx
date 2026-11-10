"use client";

import { useRef, useEffect, useState } from "react";
import {
  Sparkles,
  Send,
  X,
  Loader2,
  ChevronDown,
  Wand2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAIStore, type AIMessage } from "@/store/ai";
import { useCanvasStore } from "@/store/canvas";
import { useDesignSystemStore } from "@/store/design-system";

const QUICK_PROMPTS = [
  "Generate a login screen",
  "Create a card component",
  "Design a navigation bar",
  "Suggest colors for a fintech app",
  "Create a user profile layout",
  "Generate a dashboard layout",
];

function MessageBubble({ message }: { message: AIMessage }) {
  const isUser = message.role === "user";
  const { structured } = message;
  const { addElement } = useCanvasStore();
  const { loadTokens } = useDesignSystemStore();

  const handleApply = () => {
    if (!structured) return;

    if (structured.action === "generate" && structured.elements) {
      let offsetX = 50;
      let offsetY = 50;

      const applyElements = (
        elements: unknown[],
        parentId?: string
      ) => {
        for (const rawEl of elements) {
          const el = rawEl as {
            type: string;
            name: string;
            x: number;
            y: number;
            width: number;
            height: number;
            fill?: string;
            cornerRadius?: number;
            content?: string;
            fontSize?: number;
            fontWeight?: string;
            children?: unknown[];
          };

          const id = addElement({
            type: (el.type as "rectangle" | "ellipse" | "text" | "frame") ?? "rectangle",
            name: el.name ?? "Element",
            x: (el.x ?? 0) + offsetX,
            y: (el.y ?? 0) + offsetY,
            width: el.width ?? 100,
            height: el.height ?? 50,
            fill: el.fill ?? "#6366f1",
            cornerRadius: el.cornerRadius ?? 0,
            content: el.content,
            fontSize: el.fontSize,
            fontWeight: el.fontWeight,
            fontColor: el.fill,
            opacity: 1,
            rotation: 0,
            parentId,
            children: el.children ? [] : undefined,
          });

          if (el.children) {
            applyElements(el.children, id);
          }
        }
        offsetX += 20;
        offsetY += 20;
      };

      applyElements(structured.elements);
    } else if (structured.action === "tokens" && structured.tokens) {
      loadTokens(structured.tokens as Parameters<typeof loadTokens>[0]);
    }
  };

  return (
    <div className={cn("flex gap-2 py-2", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium",
          isUser ? "bg-surface-subtle text-text-secondary" : "bg-accent/20 text-accent"
        )}
      >
        {isUser ? "U" : <Sparkles size={12} />}
      </div>

      <div className={cn("flex-1 min-w-0", isUser ? "items-end" : "items-start", "flex flex-col gap-1")}>
        {/* Bubble */}
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[90%]",
            isUser
              ? "bg-accent/20 text-text-primary ml-auto"
              : "bg-surface-overlay text-text-primary"
          )}
        >
          {/* Render markdown-ish content */}
          <div className="prose-ai">
            {message.content.split("\n").map((line, i) => {
              if (line.startsWith("**") && line.endsWith("**")) {
                return (
                  <p key={i} className="font-semibold">
                    {line.slice(2, -2)}
                  </p>
                );
              }
              if (line.startsWith("- ")) {
                return (
                  <p key={i} className="pl-3 text-text-secondary">
                    • {line.slice(2)}
                  </p>
                );
              }
              if (line.startsWith("#")) {
                return (
                  <p key={i} className="font-semibold text-text-primary">
                    {line.replace(/^#+\s/, "")}
                  </p>
                );
              }
              return line ? <p key={i}>{line}</p> : <br key={i} />;
            })}
          </div>
        </div>

        {/* Apply button for structured responses */}
        {structured && (
          <button
            onClick={handleApply}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 rounded-md transition-colors"
          >
            <Wand2 size={11} />
            {structured.action === "generate"
              ? "Apply to Canvas"
              : structured.action === "tokens"
              ? "Apply Tokens"
              : "Apply"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AIPanel() {
  const { messages, isLoading, isOpen, setOpen, inputValue, setInputValue, sendMessage, clearMessages } =
    useAIStore();
  const { elements, selectedIds } = useCanvasStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showQuick, setShowQuick] = useState(false);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content || isLoading) return;

    // Build canvas context
    const selectedElements = selectedIds.map((id) => elements[id]).filter(Boolean);
    const context =
      selectedElements.length > 0
        ? {
            selectedElements: selectedElements.slice(0, 5),
            totalElements: Object.keys(elements).length,
          }
        : { totalElements: Object.keys(elements).length };

    await sendMessage(content, context);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) {
    return (
      <div className="border-t border-surface-border bg-surface-raised h-11 flex items-center px-3 gap-2">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 flex-1 h-7 px-3 text-xs text-text-tertiary bg-surface-subtle hover:bg-surface-overlay rounded border border-surface-border hover:border-accent/40 transition-colors"
        >
          <Sparkles size={11} className="text-accent" />
          <span>Ask Motif AI anything... <span className="text-text-tertiary opacity-60">⌘K</span></span>
        </button>

        {/* Quick prompt pills */}
        <div className="flex gap-1 overflow-hidden">
          {QUICK_PROMPTS.slice(0, 2).map((p) => (
            <button
              key={p}
              onClick={() => {
                setOpen(true);
                setInputValue(p);
              }}
              className="text-2xs px-2 py-1 rounded bg-surface-subtle border border-surface-border text-text-tertiary hover:text-accent hover:border-accent/40 transition-colors whitespace-nowrap"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-surface-border bg-surface-raised flex flex-col" style={{ height: 320 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-10 border-b border-surface-border flex-shrink-0">
        <Sparkles size={13} className="text-accent" />
        <span className="text-sm font-medium text-text-primary flex-1">Motif AI</span>

        <button
          onClick={clearMessages}
          title="Clear conversation"
          className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => setOpen(false)}
          className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <div className="flex gap-2 py-2">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">
              <Sparkles size={12} className="text-accent" />
            </div>
            <div className="bg-surface-overlay rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-accent" />
                <span className="text-xs text-text-secondary">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      {messages.length <= 1 && (
        <div className="px-3 py-1.5 flex gap-1.5 flex-wrap border-t border-surface-border">
          {QUICK_PROMPTS.slice(0, 4).map((p) => (
            <button
              key={p}
              onClick={() => setInputValue(p)}
              className="text-2xs px-2 py-1 rounded-full bg-surface-subtle border border-surface-border text-text-tertiary hover:text-accent hover:border-accent/40 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 border-t border-surface-border flex gap-2 items-end flex-shrink-0">
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me to generate UI, suggest tokens, or critique your design..."
          className="flex-1 bg-surface-subtle border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none resize-none focus:border-accent/60 transition-colors leading-relaxed"
          rows={2}
          style={{ minHeight: 60, maxHeight: 120 }}
        />
        <button
          onClick={handleSend}
          disabled={!inputValue.trim() || isLoading}
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0",
            inputValue.trim() && !isLoading
              ? "bg-accent text-white hover:bg-accent/80"
              : "bg-surface-subtle text-text-tertiary cursor-not-allowed"
          )}
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}
