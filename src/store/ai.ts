import { create } from "zustand";
import type { ComponentBasis } from "../lib/ai/context";
import { useAuth } from "./auth";

export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  // The JSON block of a reply, as it came: nothing in it is trusted until it has been read (lib/ai).
  structured?: { action?: string; [key: string]: unknown };
  // The component the reply is about, as it was when it was asked, so a suggestion of changes is only made to
  // the same elements.
  basis?: ComponentBasis | null;
  // What came of applying the suggestion, once it has been.
  outcome?: string;
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
  setOutcome: (id: string, outcome: string) => void;
  sendMessage: (
    content: string,
    context?: unknown,
    basis?: ComponentBasis | null
  ) => Promise<AIMessage | null>;
}

let msgCounter = 0;

const WELCOME =
  "Hi! I'm Motif AI. I can review the component you have open, suggest changes to it made of your repository's own tokens, and suggest new tokens. You choose what to apply, and everything still goes out as a pull request. Try asking me to:\n\n- **Make the heading larger and the text muted**\n- **Replace the raw values with tokens**\n- **Is this component accessible?**\n- **Suggest a success color scale**";

export const useAIStore = create<AIStore>((set, get) => ({
  messages: [
    {
      id: "welcome",
      role: "assistant",
      content: WELCOME,
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

  setOutcome: (id, outcome) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, outcome } : m)) })),

  clearMessages: () =>
    set({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          content: WELCOME,
          timestamp: Date.now(),
        },
      ],
    }),

  sendMessage: async (content, context, basis = null) => {
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
        headers: { "Content-Type": "application/json", "x-requested-with": "motif" },
        body: JSON.stringify({ messages: apiMessages, context }),
      });

      const data = await res.json().catch(() => ({ error: `The assistant didn't answer (${res.status}).` }));

      // The sign-in ended, or never was: the server says so, and the person can sign in again from here.
      if (res.status === 401 && data.signInRequired) {
        get().addMessage({ role: "assistant", content: "⚠️ Sign in to use the assistant." });
        set({ isLoading: false });
        void useAuth.getState().load().then(() => useAuth.getState().openDialog());
        return null;
      }

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
        basis,
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
