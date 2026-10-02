import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_CODE_PROVIDER_ID,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";
import { useAgentAccounts } from "./agent-accounts";
import {
  isLimitText,
  nextService,
  onLimitHit,
  outUntil,
  resumePrompt,
} from "./ai-continuity";
import { useAiUsage } from "./ai-usage";

vi.mock("@/stores/document-store", () => ({
  useDocumentStore: {
    getState: () => ({
      projectRoot: "/project",
      files: [],
      activeFileId: null,
      selectionRange: null,
    }),
  },
}));

describe("telling a service is out", () => {
  it("reads usage-limit errors, whatever the service", () => {
    expect(isLimitText("You've hit your usage limit. Try again at 6pm.")).toBe(
      true,
    );
    expect(isLimitText("API Error: 429 Too Many Requests")).toBe(true);
    expect(isLimitText("Insufficient Balance")).toBe(true);
    expect(isLimitText("RESOURCE_EXHAUSTED: quota")).toBe(true);
    expect(isLimitText("File not found: main.tex")).toBe(false);
  });

  it("knows when each is back", () => {
    const now = 1000;
    const state = {
      claudeLimits: {
        status: "rejected" as const,
        limitedUntil: 5000,
        limitType: "five_hour",
        observedAt: now,
      },
      codexLimits: {
        primary: { usedPercent: 100, minutes: 300, resetsAt: 7000 },
        plan: "plus",
        observedAt: now,
      },
      blocked: { "deepseek-1": 9000 },
    };
    expect(outUntil(CLAUDE_CODE_PROVIDER_ID, state, now)).toBe(5000);
    expect(outUntil("__codex__", state, now)).toBe(7000);
    expect(outUntil("deepseek-1", state, now)).toBe(9000);
    expect(outUntil("deepseek-1", state, 9500)).toBeNull();
  });

  it("goes to the first in the order that's there and not out", () => {
    const order = [CLAUDE_CODE_PROVIDER_ID, "__codex__", "deepseek-1"];
    const out = (id: string) => id === "__codex__";
    expect(nextService(CLAUDE_CODE_PROVIDER_ID, order, order, out)).toBe(
      "deepseek-1",
    );
    expect(nextService("deepseek-1", order, ["deepseek-1"], out)).toBeNull();
  });

  it("asks the next one to finish the interrupted request", () => {
    const text = resumePrompt({
      from: "Claude",
      request: "Add a results table",
      files: ["results.tex"],
    });
    expect(text).toContain("Claude reached its usage limit");
    expect(text).toContain("Add a results table");
    expect(text).toContain("results.tex");
  });
});

describe("carrying on when the AI runs out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useClaudeSetupStore.setState({
      status: "ready",
      claudeProviderConfigured: true,
      openAiCredentials: [],
    });
    useAgentAccounts.setState({
      status: {
        codex: {
          installed: true,
          signed_in: true,
          account: "Logged in using ChatGPT",
          can_install: true,
        },
      },
    });
    useAiUsage.setState({
      fallbackOrder: [CLAUDE_CODE_PROVIDER_ID, "__codex__"],
      autoContinue: true,
      blocked: {},
      claudeLimits: null,
      codexLimits: null,
    });
    const base = useClaudeChatStore.getState().tabs[0];
    useClaudeChatStore.setState({
      tabs: [
        {
          ...base,
          id: "t1",
          projectPath: "/project",
          providerKey: CLAUDE_CODE_PROVIDER_ID,
          sessionProviderKey: CLAUDE_CODE_PROVIDER_ID,
          isStreaming: false,
          messages: [],
          handoff: null,
          error: null,
        },
      ],
      activeTabId: "t1",
      selectedProviderCredentialId: CLAUDE_CODE_PROVIDER_ID,
    });
  });

  it("switches to the next AI and picks up the request", async () => {
    onLimitHit("t1", "Add a results table");
    const tab = useClaudeChatStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.providerKey).toBe("openai-compatible:__codex__");
    expect(tab?.handoff).toMatchObject({
      from: "Claude",
      to: "ChatGPT",
      mode: "auto",
    });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "execute_agent",
        expect.objectContaining({
          engine: "codex",
          prompt: expect.stringContaining("Add a results table"),
        }),
      ),
    );
    // Claude is skipped for a while, though it didn't say until when.
    expect(
      useAiUsage.getState().blocked[CLAUDE_CODE_PROVIDER_ID],
    ).toBeGreaterThan(Date.now());
  });

  it("only offers it when set to ask first", () => {
    useAiUsage.setState({ autoContinue: false });
    onLimitHit("t1", "Add a results table");
    const tab = useClaudeChatStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.handoff?.mode).toBe("offer");
    expect(tab?.providerKey).toBe(CLAUDE_CODE_PROVIDER_ID);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("says so when no other AI can carry on", () => {
    useAiUsage.setState({ fallbackOrder: [CLAUDE_CODE_PROVIDER_ID] });
    onLimitHit("t1", "Add a results table");
    const tab = useClaudeChatStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.handoff ?? null).toBeNull();
    expect(tab?.error).toMatch(/no other AI is set to carry on/);
  });
});
