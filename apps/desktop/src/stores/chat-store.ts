import { create } from "zustand";
import { toast } from "sonner";
import {
  type ChatMessage,
  decodeChat,
  encodeChat,
  newMessageId,
  prepareImage,
  withMessage,
} from "@/lib/collab/chat";
import { sendChat } from "@/lib/tauri/collab";
import { currentAuthor, useAnnotationsStore } from "@/stores/annotations-store";

interface ChatState {
  /** How long the relay keeps chat; 0 when there's no chat to show. */
  days: number;
  messages: ChatMessage[];
  /** Others' messages that came in while the chat wasn't showing. */
  unread: number;

  /** A new project: nothing yet. */
  reset: () => void;
  setDays: (days: number) => void;
  /** What this device already had, from disk. */
  loadHistory: (list: Array<{ seq: number; at: number; data: string }>) => void;
  /** A message the relay has, anyone's. */
  receive: (event: { seq: number; at: number; data: string }) => void;
  send: (text: string, image?: Blob | null) => Promise<void>;
  /** The relay refused the oldest message not yet sent. */
  markFailed: () => void;
  markRead: () => void;
}

/** Ids of messages sent from here, so they never count as unread. */
const sentHere = new Set<string>();

function chatShowing() {
  const panel = useAnnotationsStore.getState();
  return panel.panelOpen && panel.panelTab === "chat";
}

export const useChatStore = create<ChatState>((set, get) => ({
  days: 0,
  messages: [],
  unread: 0,

  reset: () => set({ days: 0, messages: [], unread: 0 }),

  setDays: (days) => set({ days }),

  loadHistory: (list) => {
    let messages = get().messages;
    for (const { seq, at, data } of list) {
      const payload = decodeChat(data);
      if (payload) messages = withMessage(messages, { ...payload, seq, at });
    }
    set({ messages });
  },

  receive: ({ seq, at, data }) => {
    const payload = decodeChat(data);
    if (!payload) return;
    const before = get().messages;
    const messages = withMessage(before, { ...payload, seq, at });
    if (messages === before) return;
    const fromElsewhere = !sentHere.has(payload.id);
    set((s) => ({
      messages,
      unread: fromElsewhere && !chatShowing() ? s.unread + 1 : s.unread,
    }));
  },

  send: async (text, image) => {
    const trimmed = text.trim();
    if (!trimmed && !image) return;
    const author = currentAuthor();
    const payload = {
      id: newMessageId(),
      author: author.name,
      color: author.color,
      text: trimmed,
      ...(image ? { image: await prepareImage(image) } : {}),
    };
    sentHere.add(payload.id);
    set((s) => ({
      messages: withMessage(s.messages, {
        ...payload,
        seq: null,
        at: Date.now(),
      }),
    }));
    try {
      await sendChat(encodeChat(payload));
    } catch (err) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === payload.id ? { ...m, failed: true } : m,
        ),
      }));
      toast.error(
        String(err) === "too-large"
          ? "That message is too large to send."
          : `Couldn't send: ${String(err)}`,
      );
    }
  },

  markFailed: () =>
    set((s) => {
      const index = s.messages.findIndex((m) => m.seq === null && !m.failed);
      if (index < 0) return {};
      const messages = [...s.messages];
      messages[index] = { ...messages[index], failed: true };
      return { messages };
    }),

  markRead: () => set({ unread: 0 }),
}));
