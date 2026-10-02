import { readyEngines, useAgentAccounts } from "@/lib/agent-accounts";
import { ENGINE_LABELS, providerOfEngine } from "@/lib/agent-events";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";

/** Services the chat can move to: signed-in accounts, then API keys. */
export function fallbackChoices(): { id: string; label: string }[] {
  return [
    ...readyEngines(useAgentAccounts.getState().status).map((e) => ({
      id: providerOfEngine(e),
      label: ENGINE_LABELS[e],
    })),
    ...useClaudeSetupStore
      .getState()
      .openAiCredentials.map((c) => ({ id: c.id, label: c.label })),
  ];
}

/** The same, kept up to date in a component. */
export function useFallbackChoices(): { id: string; label: string }[] {
  useAgentAccounts((s) => s.status);
  useClaudeSetupStore((s) => s.openAiCredentials);
  return fallbackChoices();
}
