import { describe, expect, it, vi } from "vitest";
import { useClaudeChatStore } from "./claude-chat-store";

vi.mock("@/stores/document-store", () => ({
  useDocumentStore: {
    getState: () => ({ projectRoot: "/project", files: [] }),
  },
}));

describe("closing chats", () => {
  it("closes the last chat too, leaving an empty one", () => {
    const base = useClaudeChatStore.getState().tabs[0];
    useClaudeChatStore.setState({
      tabs: [
        {
          ...base,
          id: "only",
          sessionId: "S1",
          messages: [{ type: "user", message: { content: [] } }],
          isStreaming: false,
        },
      ],
      activeTabId: "only",
    });
    useClaudeChatStore.getState().closeTab("only");
    const { tabs, activeTabId } = useClaudeChatStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).not.toBe("only");
    expect(tabs[0].messages).toEqual([]);
    expect(activeTabId).toBe(tabs[0].id);
    // An empty one alone stays: there's nothing to close.
    useClaudeChatStore.getState().closeTab(tabs[0].id);
    expect(useClaudeChatStore.getState().tabs[0].id).toBe(tabs[0].id);
  });
});
