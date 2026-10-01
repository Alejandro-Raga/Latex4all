import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_CODE_PROVIDER_ID,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";
import { fallBackIfLimited } from "./ai-fallback";
import { useAiUsage } from "./ai-usage";

describe("falling back when Claude's limit is reached", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useClaudeSetupStore.setState({
      openAiCredentials: [
        {
          id: "ds",
          label: "DeepSeek",
          base_url: "https://api.deepseek.com/anthropic",
          model: "deepseek-chat",
        },
      ],
    });
    useClaudeChatStore
      .getState()
      .setSelectedProviderCredentialId(CLAUDE_CODE_PROVIDER_ID);
    useAiUsage.setState({
      fallbackService: "ds",
      claudeLimits: {
        status: "rejected",
        limitedUntil: Date.now() + 60_000,
        limitType: "five_hour",
        observedAt: Date.now(),
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("moves to the fallback, and back once the limit resets", () => {
    fallBackIfLimited();
    expect(useClaudeChatStore.getState().selectedProviderCredentialId).toBe(
      "ds",
    );
    vi.advanceTimersByTime(60_000 + 31_000);
    expect(useClaudeChatStore.getState().selectedProviderCredentialId).toBe(
      CLAUDE_CODE_PROVIDER_ID,
    );
  });

  it("asks instead when no fallback is set", () => {
    useAiUsage.setState({ fallbackService: null });
    fallBackIfLimited();
    expect(useClaudeChatStore.getState().selectedProviderCredentialId).toBe(
      CLAUDE_CODE_PROVIDER_ID,
    );
  });
});
