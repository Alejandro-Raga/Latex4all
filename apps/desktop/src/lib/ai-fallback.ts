import { toast } from "sonner";
import { claudeLimited, useAiUsage } from "@/lib/ai-usage";
import {
  CLAUDE_CODE_PROVIDER_ID,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";

let backTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * When Claude's limit is reached and a fallback service is set, moves the
 * chat there, and back to Claude once the limit resets (if it's still on
 * the fallback by then).
 */
export function fallBackIfLimited() {
  const { claudeLimits, fallbackService } = useAiUsage.getState();
  if (!fallbackService || !claudeLimited(claudeLimits)) return;
  const chat = useClaudeChatStore.getState();
  const current = chat.selectedProviderCredentialId;
  if (current && current !== CLAUDE_CODE_PROVIDER_ID) return;
  const service = useClaudeSetupStore
    .getState()
    .openAiCredentials.find((c) => c.id === fallbackService);
  if (!service) return;

  chat.setSelectedProviderCredentialId(service.id);
  const until = claudeLimits?.limitedUntil as number;
  toast.info(`Switched to ${service.label} while Claude's limit lasts`, {
    description: `Back to Claude at ${new Date(until).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`,
  });
  if (backTimer) clearTimeout(backTimer);
  backTimer = setTimeout(
    () => {
      backTimer = null;
      const now = useClaudeChatStore.getState();
      if (now.selectedProviderCredentialId !== service.id) return;
      now.setSelectedProviderCredentialId(CLAUDE_CODE_PROVIDER_ID);
      toast.info("Back to Claude: its limit has reset");
    },
    Math.max(0, until - Date.now()) + 30_000,
  );
}
