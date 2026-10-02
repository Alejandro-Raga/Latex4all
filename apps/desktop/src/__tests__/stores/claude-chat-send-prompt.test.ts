import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

const { mockDocumentState, getDocumentState, createSnapshotMock } = vi.hoisted(
  () => ({
    mockDocumentState: {} as any,
    getDocumentState: vi.fn(),
    createSnapshotMock: vi.fn(() => Promise.resolve(null)),
  }),
);

vi.mock("@/stores/document-store", () => ({
  useDocumentStore: {
    getState: getDocumentState,
  },
}));

vi.mock("@/stores/history-store", () => ({
  useHistoryStore: {
    getState: vi.fn(() => ({
      createSnapshot: createSnapshotMock,
    })),
  },
}));

import {
  CLAUDE_CODE_PROVIDER_ID,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";

function resetClaudeChatStore() {
  useClaudeChatStore.setState({
    messages: [],
    sessionId: null,
    isStreaming: false,
    streamingStartedAt: null,
    error: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    tabs: [
      {
        id: "tab-default",
        title: "New Chat",
        projectPath: "/project",
        sessionId: null,
        providerKey: CLAUDE_CODE_PROVIDER_ID,
        sessionProviderKey: null,
        messages: [],
        isStreaming: false,
        streamingStartedAt: null,
        error: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        draft: { input: "", pinnedContexts: [] },
      },
    ],
    activeTabId: "tab-default",
    activeProjectPath: "/project",
    pendingInitialPrompt: null,
    pendingAttachments: [],
    pendingPinnedContextRemovalLabels: [],
    selectedModel: "opus",
    selectedProviderCredentialId: CLAUDE_CODE_PROVIDER_ID,
    selectedProviderModels: {},
    effortLevel: "medium",
    _cancelledByUser: false,
  });
}

function setMockDocumentState(overrides: Partial<any> = {}) {
  const content = ["Line 1", "Line 2", "Line 3", "Line 4"].join("\n");

  const state = {
    projectRoot: "/project",
    files: [
      {
        id: "main.tex",
        name: "main.tex",
        relativePath: "main.tex",
        absolutePath: "/project/main.tex",
        type: "tex",
        content,
        isDirty: false,
      },
    ],
    activeFileId: "main.tex",
    selectionRange: null,
    saveAllFiles: vi.fn(() => Promise.resolve()),
    refreshFiles: vi.fn(() => Promise.resolve()),
    reloadFile: vi.fn(() => Promise.resolve()),
    ...overrides,
  };

  Object.keys(mockDocumentState).forEach(
    (key) => delete mockDocumentState[key],
  );
  Object.assign(mockDocumentState, state);
  getDocumentState.mockImplementation(() => mockDocumentState);
  return state;
}

describe("useClaudeChatStore.sendPrompt context assembly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaudeChatStore();
    setMockDocumentState();
  });

  it("uses a plain file label and full file content for whole-file mentions", async () => {
    const wholeFileText =
      "\\section{Intro}\nThis is the full file.\n\\textbf{Important note}";

    await useClaudeChatStore.getState().sendPrompt("Please revise this", {
      label: "@main.tex",
      filePath: "main.tex",
      selectedText: wholeFileText,
    });

    expect(invoke).toHaveBeenCalledWith(
      "execute_claude_code",
      expect.objectContaining({
        projectPath: "/project",
        tabId: "tab-default",
        prompt: expect.stringContaining("[Selection: @main.tex]"),
      }),
    );

    const prompt = (vi.mocked(invoke).mock.calls[0]?.[1] as any)
      ?.prompt as string;
    expect(prompt).toContain("[Currently open file: main.tex]");
    expect(prompt).toContain("[Selection: @main.tex]");
    expect(prompt).toContain(wholeFileText);

    const userText =
      useClaudeChatStore.getState().messages[0].message?.content?.[0].text;
    expect(userText).toBe("@main.tex\nPlease revise this");
  });

  it("uses a line-range label and only the selected slice for selection context", async () => {
    const state = setMockDocumentState({
      files: [
        {
          id: "main.tex",
          name: "main.tex",
          relativePath: "main.tex",
          absolutePath: "/project/main.tex",
          type: "tex",
          content: "alpha\nbeta\ngamma\ndelta",
          isDirty: false,
        },
      ],
      selectionRange: { start: 6, end: 16 },
    });

    await useClaudeChatStore.getState().sendPrompt("Please revise this");

    expect(invoke).toHaveBeenCalledWith(
      "execute_claude_code",
      expect.objectContaining({
        projectPath: "/project",
        tabId: "tab-default",
        prompt: expect.stringContaining("[Selection: @main.tex:2:1-3:6]"),
      }),
    );

    const prompt = (vi.mocked(invoke).mock.calls[0]?.[1] as any)
      ?.prompt as string;
    expect(prompt).toContain("[Currently open file: main.tex]");
    expect(prompt).toContain("[Selection: @main.tex:2:1-3:6]");
    expect(prompt).toContain("[Selected text:\nbeta\ngamma\n]");
    expect(prompt).not.toContain("alpha\na");
    expect(prompt).not.toContain("\ndelta");

    const userText =
      useClaudeChatStore.getState().messages[0].message?.content?.[0].text;
    expect(userText).toBe("@main.tex:2:1-3:6\nPlease revise this");
    expect(state.saveAllFiles).not.toHaveBeenCalled();
    expect(createSnapshotMock).toHaveBeenCalledWith(
      "/project",
      "[claude] Before Claude edit",
    );
  });

  it("sends Claude Code when the Claude provider option is selected", async () => {
    useClaudeChatStore.setState({
      selectedProviderCredentialId: CLAUDE_CODE_PROVIDER_ID,
    });

    await useClaudeChatStore.getState().sendPrompt("Use Claude");

    expect(invoke).toHaveBeenCalledWith(
      "execute_claude_code",
      expect.objectContaining({
        providerCredentialId: null,
        providerModelOverride: null,
      }),
    );
  });

  it("starts Claude Code with prior context when switching from a direct provider", async () => {
    useClaudeChatStore.setState((state) => ({
      sessionId: "qwen-session",
      selectedProviderCredentialId: CLAUDE_CODE_PROVIDER_ID,
      tabs: state.tabs.map((tab) =>
        tab.id === "tab-default"
          ? {
              ...tab,
              sessionId: "qwen-session",
              providerKey: CLAUDE_CODE_PROVIDER_ID,
              sessionProviderKey: "openai-compatible:qwen-cred",
              messages: [
                {
                  type: "user",
                  message: {
                    content: [{ type: "text", text: "Old DS question" }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    content: [{ type: "text", text: "Old DS answer" }],
                  },
                },
              ],
            }
          : tab,
      ),
    }));

    await useClaudeChatStore.getState().sendPrompt("Use Claude now");

    expect(invoke).toHaveBeenCalledWith(
      "execute_claude_code",
      expect.objectContaining({
        providerCredentialId: null,
        providerModelOverride: null,
        prompt: expect.stringContaining(
          "[Handoff: this chat continues with you",
        ),
      }),
    );
    const prompt = (vi.mocked(invoke).mock.calls[0]?.[1] as any).prompt;
    expect(prompt).toContain("Old DS question");
    expect(prompt).toContain("Old DS answer");
    expect(prompt).toContain("Use Claude now");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "resume_claude_code"),
    ).toBe(false);
  });

  it("keeps the same backend session when switching between OpenAI-compatible providers", async () => {
    useClaudeChatStore.setState((state) => ({
      sessionId: "shared-session",
      selectedProviderCredentialId: "deepseek-cred",
      selectedProviderModels: { "deepseek-cred": "deepseek-chat" },
      tabs: state.tabs.map((tab) =>
        tab.id === "tab-default"
          ? {
              ...tab,
              sessionId: "shared-session",
              providerKey: "openai-compatible:deepseek-cred",
              sessionProviderKey: "openai-compatible:qwen-cred",
            }
          : tab,
      ),
    }));

    await useClaudeChatStore.getState().sendPrompt("Use DeepSeek now");

    expect(invoke).toHaveBeenCalledWith(
      "resume_claude_code",
      expect.objectContaining({
        sessionId: "shared-session",
        providerCredentialId: "deepseek-cred",
        providerModelOverride: "deepseek-chat",
      }),
    );
  });

  it("passes an OpenAI-compatible model override with the provider credential", async () => {
    useClaudeChatStore.getState().setSelectedProviderCredentialId("qwen-cred");
    useClaudeChatStore.setState({
      selectedProviderModels: { "qwen-cred": "qwen3.7-plus" },
    });

    await useClaudeChatStore.getState().sendPrompt("Use Qwen");

    expect(invoke).toHaveBeenCalledWith(
      "execute_claude_code",
      expect.objectContaining({
        providerCredentialId: "qwen-cred",
        providerModelOverride: "qwen3.7-plus",
      }),
    );
  });
});

describe("useClaudeChatStore.sendPrompt with an account-login assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaudeChatStore();
    setMockDocumentState();
  });

  it("sends ChatGPT requests to Codex, with Latex4All's rules first", async () => {
    useClaudeChatStore.setState({ selectedProviderCredentialId: "__codex__" });
    useClaudeChatStore.setState((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        providerKey: "openai-compatible:__codex__",
      })),
    }));
    await useClaudeChatStore.getState().sendPrompt("Shorten the intro");
    expect(invoke).toHaveBeenCalledWith(
      "execute_agent",
      expect.objectContaining({
        engine: "codex",
        projectPath: "/project",
        tabId: "tab-default",
        sessionId: null,
        prompt: expect.stringContaining("Shorten the intro"),
      }),
    );
    const prompt = (vi.mocked(invoke).mock.calls[0]?.[1] as any)?.prompt;
    expect(prompt).toMatch(/^You are an assistant inside Latex4All/);
  });

  it("resumes the same Gemini session without repeating the rules", async () => {
    useClaudeChatStore.setState((s) => ({
      selectedProviderCredentialId: "__gemini__",
      tabs: s.tabs.map((t) => ({
        ...t,
        providerKey: "openai-compatible:__gemini__",
        sessionProviderKey: "openai-compatible:__gemini__",
        sessionId: "S1",
      })),
    }));
    await useClaudeChatStore.getState().sendPrompt("And the conclusion");
    const args = vi.mocked(invoke).mock.calls[0]?.[1] as any;
    expect(vi.mocked(invoke).mock.calls[0]?.[0]).toBe("execute_agent");
    expect(args).toMatchObject({ engine: "gemini", sessionId: "S1" });
    expect(args.prompt).not.toContain("You are an assistant inside Latex4All");
  });
});

describe("two chats on one project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaudeChatStore();
    setMockDocumentState();
  });

  it("waits while another chat edits the project, then goes", async () => {
    const base = useClaudeChatStore.getState().tabs[0];
    useClaudeChatStore.setState({
      tabs: [
        { ...base, id: "busy", title: "Intro rewrite", isStreaming: true },
        { ...base, id: "tab-default" },
      ],
      activeTabId: "tab-default",
    });
    await useClaudeChatStore.getState().sendPrompt("Fix the abstract");
    expect(invoke).not.toHaveBeenCalled();
    expect(
      useClaudeChatStore.getState().tabs.find((t) => t.id === "tab-default")
        ?.waitingFor,
    ).toBe("Intro rewrite");

    useClaudeChatStore.getState()._setStreaming("busy", false);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "execute_claude_code",
        expect.objectContaining({
          tabId: "tab-default",
          prompt: expect.stringContaining("Fix the abstract"),
        }),
      ),
    );
  });

  it("gives a cancelled waiting request back to the message box", async () => {
    const base = useClaudeChatStore.getState().tabs[0];
    useClaudeChatStore.setState({
      tabs: [
        { ...base, id: "busy", isStreaming: true },
        { ...base, id: "tab-default" },
      ],
    });
    await useClaudeChatStore.getState().sendPrompt("Fix the abstract");
    useClaudeChatStore.getState().cancelWaiting("tab-default");
    expect(useClaudeChatStore.getState().restoreInput).toEqual({
      tabId: "tab-default",
      text: "Fix the abstract",
    });
    useClaudeChatStore.getState()._setStreaming("busy", false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("answer-only requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaudeChatStore();
    setMockDocumentState();
  });

  it("neither wait for an editing chat nor make others wait", async () => {
    const base = useClaudeChatStore.getState().tabs[0];
    useClaudeChatStore.setState({
      tabs: [
        { ...base, id: "editing", isStreaming: true },
        { ...base, id: "tab-default" },
        { ...base, id: "explainer", isStreaming: true, answerOnly: true },
      ],
    });
    await useClaudeChatStore
      .getState()
      .sendPrompt("Explain this", undefined, { answerOnly: true });
    expect(invoke).toHaveBeenCalledTimes(1);

    // With only an answer-only chat running, an editing request goes at once.
    vi.clearAllMocks();
    useClaudeChatStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === "editing" || t.id === "tab-default"
          ? { ...t, isStreaming: false }
          : t,
      ),
    }));
    await useClaudeChatStore.getState().sendPrompt("Fix the intro");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("an automatic switch isn't remembered as the choice", () => {
    useClaudeChatStore.getState().setSelectedProviderCredentialId("chosen");
    expect(
      sessionStorage.getItem("latex4all:selected-provider-credential-id"),
    ).toBe("chosen");
    useClaudeChatStore.getState().setSelectedProviderCredentialId("ds", true);
    expect(useClaudeChatStore.getState().selectedProviderCredentialId).toBe(
      "ds",
    );
    expect(
      sessionStorage.getItem("latex4all:selected-provider-credential-id"),
    ).toBe("chosen");
  });
});

describe("Auto model", () => {
  it("gives quick actions and small selection edits to Haiku", async () => {
    const { resolveClaudeModel } = await import("@/stores/claude-chat-store");
    const sel = {
      label: "@main.tex:1-2",
      filePath: "main.tex",
      selectedText: "A short paragraph.",
    };
    expect(resolveClaudeModel("auto", "Shorten this", sel, true)).toBe("haiku");
    expect(resolveClaudeModel("auto", "Fix the typo here", sel)).toBe("haiku");
    expect(
      resolveClaudeModel("auto", "Restructure the whole chapter", sel),
    ).toBe("sonnet");
    expect(resolveClaudeModel("auto", "Fix the typo here")).toBe("sonnet");
    expect(resolveClaudeModel("opus", "Shorten this", sel, true)).toBe("opus");
  });
});

describe("asking two AIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaudeChatStore();
    setMockDocumentState();
  });

  it("sends the question to both, each in its own chat", async () => {
    const { useCompare } = await import(
      "@/components/claude-chat/compare-view"
    );
    useCompare.getState().start("Is section 2 convincing?", "__codex__");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(calls).toContain("execute_claude_code");
    expect(calls).toContain("execute_agent");
    for (const [, args] of vi.mocked(invoke).mock.calls) {
      expect((args as any).prompt).toContain("do not change any files");
    }
    expect(useCompare.getState().tabs).toHaveLength(2);
  });
});

describe("handing a chat to another AI", () => {
  it("leads with the files changed and what's left to do", async () => {
    const { handoffBrief } = await import("@/stores/claude-chat-store");
    const brief = handoffBrief([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "1",
              name: "Edit",
              input: { file_path: "/p/chapters/intro.tex" },
            },
            {
              type: "tool_use",
              id: "2",
              name: "TodoWrite",
              input: {
                todos: [
                  { content: "Rewrite the intro", status: "completed" },
                  { content: "Add the results table", status: "pending" },
                ],
              },
            },
          ],
        },
      },
    ]);
    expect(brief).toEqual([
      "Files changed in this chat: intro.tex.",
      "Still to do: Add the results table.",
    ]);
  });
});

describe("useClaudeChatStore.resumeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaudeChatStore();
    setMockDocumentState();
  });

  it("restores token totals from loaded session history", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        type: "user",
        message: { content: [{ type: "text", text: "hello" }] },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 11, output_tokens: 7 },
        },
      },
      {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 13, output_tokens: 5 },
      },
    ]);

    await useClaudeChatStore.getState().resumeSession("session-123");

    expect(invoke).toHaveBeenCalledWith("load_session_history", {
      projectPath: "/project",
      sessionId: "session-123",
    });

    const state = useClaudeChatStore.getState();
    expect(state.sessionId).toBe("session-123");
    expect(state.messages).toHaveLength(3);
    expect(state.totalInputTokens).toBe(24);
    expect(state.totalOutputTokens).toBe(12);
  });

  it("does not reuse a tab from another project with the same session id", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        type: "user",
        message: { content: [{ type: "text", text: "from current project" }] },
      },
    ]);

    useClaudeChatStore.setState((state) => {
      const baseTab = state.tabs[0];
      return {
        tabs: [
          {
            ...baseTab,
            id: "tab-current",
            projectPath: "/project",
            sessionId: null,
            messages: [],
          },
          {
            ...baseTab,
            id: "tab-other",
            title: "Other project",
            projectPath: "/other-project",
            sessionId: "shared-session-id",
            messages: [
              {
                type: "user",
                message: {
                  content: [{ type: "text", text: "from another project" }],
                },
              },
            ],
          },
        ],
        activeTabId: "tab-current",
        activeProjectPath: "/project",
        messages: [],
        sessionId: null,
      };
    });

    await useClaudeChatStore.getState().resumeSession("shared-session-id");

    expect(invoke).toHaveBeenCalledWith("load_session_history", {
      projectPath: "/project",
      sessionId: "shared-session-id",
    });

    const state = useClaudeChatStore.getState();
    const otherProjectTab = state.tabs.find((tab) => tab.id === "tab-other");
    expect(state.activeTabId).toBe("tab-current");
    expect(state.activeProjectPath).toBe("/project");
    expect(state.messages[0].message?.content?.[0].text).toBe(
      "from current project",
    );
    expect(otherProjectTab?.messages[0].message?.content?.[0].text).toBe(
      "from another project",
    );
  });

  it("hides internal file and pasted-image context when restoring history", async () => {
    const tempImagePath = [
      "C:\\Temp",
      "Latex4All",
      "chat-pastes",
      "1781110224092-1-paste-1781110223586-1.png",
    ].join("\\");
    const restoredPrompt = [
      "[Currently open file: main.tex]",
      "[Selection: Pasted image]",
      "[Selected text:",
      `[Temporary pasted image: ${tempImagePath}]`,
      "Use this image file as visual context for the user's message.",
      "]",
      "",
      "Please inspect this image",
    ].join("\n");

    vi.mocked(invoke).mockResolvedValueOnce([
      {
        type: "user",
        message: {
          content: restoredPrompt,
        },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "OK" }],
        },
      },
    ]);

    await useClaudeChatStore.getState().resumeSession("session-with-image");

    const state = useClaudeChatStore.getState();
    const userContent = state.messages[0].message?.content as any;
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

    expect(userContent).toBe("Pasted image\nPlease inspect this image");
    expect(userContent).not.toContain("[Currently open file:");
    expect(userContent).not.toContain("[Temporary pasted image:");
    expect(activeTab?.title).toBe("Please inspect this image");
  });
});
