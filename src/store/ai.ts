import { create } from "zustand";

export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  structured?: {
    action: "generate" | "tokens";
    elements?: unknown[];
    tokens?: unknown;
  };
}

interface AIStore {
  messages: AIMessage[];
  isLoading: boolean;
  isOpen: boolean;
  inputValue: string;

  setOpen: (open: boolean) => void;
  setInputValue: (val: string) => void;
  addMessage: (msg: Omit<AIMessage, "id" | "timestamp">) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
  sendMessage: (
    content: string,
    designContext?: unknown
  ) => Promise<AIMessage | null>;
}

let msgCounter = 0;

export const useAIStore = create<AIStore>((set, get) => ({
  messages: [
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm Motif AI. I can help you generate UI layouts, suggest design tokens, or critique your designs. Try asking me to:\n\n- **Generate a card component**\n- **Create a navigation bar**\n- **Suggest a color system for a fintech app**\n- **Review this layout for accessibility**",
      timestamp: Date.now(),
    },
  ],
  isLoading: false,
  isOpen: false,
  inputValue: "",

  setOpen: (open) => set({ isOpen: open }),
  setInputValue: (val) => set({ inputValue: val }),

  addMessage: (msg) => {
    const id = `msg-${++msgCounter}`;
    set((s) => ({
      messages: [...s.messages, { ...msg, id, timestamp: Date.now() }],
    }));
  },

  setLoading: (loading) => set({ isLoading: loading }),

  clearMessages: () =>
    set({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          content:
            "Hi! I'm Motif AI. How can I help with your design?",
          timestamp: Date.now(),
        },
      ],
    }),

  sendMessage: async (content, designContext) => {
    const { messages } = get();

    get().addMessage({ role: "user", content });
    set({ isLoading: true, inputValue: "" });

    try {
      const apiMessages = [
        ...messages
          .filter((m) => m.id !== "welcome")
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content },
      ];

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, designContext }),
      });

      const data = await res.json();

      if (data.error) {
        const errMsg: Omit<AIMessage, "id" | "timestamp"> = {
          role: "assistant",
          content: `⚠️ ${data.error}`,
        };
        get().addMessage(errMsg);
        set({ isLoading: false });
        return null;
      }

      const assistantMsg: Omit<AIMessage, "id" | "timestamp"> = {
        role: "assistant",
        content: data.text,
        structured: data.structured,
      };
      get().addMessage(assistantMsg);
      set({ isLoading: false });

      const { messages: updated } = get();
      return updated[updated.length - 1];
    } catch (err) {
      const errMsg: Omit<AIMessage, "id" | "timestamp"> = {
        role: "assistant",
        content: `⚠️ Failed to connect to AI. ${err instanceof Error ? err.message : ""}`,
      };
      get().addMessage(errMsg);
      set({ isLoading: false });
      return null;
    }
  },
}));
