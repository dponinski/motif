"use client";

import { useRef, useEffect } from "react";
import { Sparkles, Send, Loader2, Wand2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAIStore, type AIMessage } from "@/store/ai";
import { useLibraryStore, activeComponent } from "@/store/library";
import { useDesignSystemStore } from "@/store/design-system";

const QUICK_PROMPTS = [
  "Suggest a color scale for a fintech brand",
  "Suggest a spacing and type scale",
  "What would you improve in this component?",
  "Is this component accessible?",
];

function MessageBubble({ message }: { message: AIMessage }) {
  const isUser = message.role === "user";
  const { structured } = message;
  const { loadTokens } = useDesignSystemStore();

  const handleApply = () => {
    if (!structured) return;

    if (structured.action === "tokens" && structured.tokens) {
      loadTokens(structured.tokens as Parameters<typeof loadTokens>[0]);
    }
  };

  return (
    <div className={cn("flex gap-2 py-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium",
          isUser ? "bg-surface-subtle text-text-secondary" : "bg-accent/20 text-accent"
        )}
      >
        {isUser ? "U" : <Sparkles size={12} />}
      </div>

      <div className={cn("flex-1 min-w-0 flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[90%]",
            isUser ? "bg-accent/20 text-text-primary ml-auto" : "bg-surface-overlay text-text-primary"
          )}
        >
          <div className="prose-ai">
            {message.content.split("\n").map((line, i) => {
              if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="font-semibold">{line.slice(2, -2)}</p>;
              if (line.startsWith("- ")) return <p key={i} className="pl-3 text-text-secondary">• {line.slice(2)}</p>;
              if (line.startsWith("#")) return <p key={i} className="font-semibold text-text-primary">{line.replace(/^#+\s/, "")}</p>;
              return line ? <p key={i}>{line}</p> : <br key={i} />;
            })}
          </div>
        </div>

        {structured && (
          <button
            onClick={handleApply}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 rounded-md transition-colors"
          >
            <Wand2 size={11} />
            {structured.action === "tokens" ? "Apply Tokens" : "Apply"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ChatView() {
  const { messages, isLoading, inputValue, setInputValue, sendMessage, clearMessages } = useAIStore();
  const component = useLibraryStore(activeComponent);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content || isLoading) return;

    // What is open, so a question about "this component" has something to be about.
    const context = component
      ? { component: { name: component.name, file: component.file, props: component.props.map((p) => p.name), variants: component.variants.map((v) => ({ name: v.name, options: v.options })) } }
      : {};

    await sendMessage(content, context);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header actions */}
      <div className="flex items-center justify-end px-3 py-1.5 border-b border-surface-border">
        <button
          onClick={clearMessages}
          title="Clear conversation"
          className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Sparkles size={20} className="text-accent/40" />
            <span className="text-xs text-text-tertiary text-center">Ask me to suggest tokens<br />or review a component</span>
          </div>
        )}
        {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}

        {isLoading && (
          <div className="flex gap-2 py-2">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">
              <Sparkles size={12} className="text-accent" />
            </div>
            <div className="bg-surface-overlay rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-accent" />
                <span className="text-xs text-text-secondary">Thinking…</span>
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
          placeholder="Ask me anything…"
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
