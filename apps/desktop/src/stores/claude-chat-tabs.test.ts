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

describe("renaming chats", () => {
  it("keeps the user's name over a generated title, and saves it", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(undefined);
    const base = useClaudeChatStore.getState().tabs[0];
    useClaudeChatStore.setState({
      tabs: [
        {
          ...base,
          id: "t1",
          title: "New Chat",
          sessionId: "S1",
          projectPath: "/project",
        },
      ],
      activeTabId: "t1",
      activeProjectPath: "/project",
    });
    useClaudeChatStore.getState().renameTab("t1", "  Results   section ");
    let tab = useClaudeChatStore.getState().tabs[0];
    expect(tab.title).toBe("Results section");
    expect(tab.titleLocked).toBe(true);
    expect(invoke).toHaveBeenCalledWith("rename_claude_session", {
      projectPath: "/project",
      sessionId: "S1",
      title: "Results section",
    });
    useClaudeChatStore.getState()._setSessionTitle("S1", "Generated title");
    tab = useClaudeChatStore.getState().tabs[0];
    expect(tab.title).toBe("Results section");
  });
});
