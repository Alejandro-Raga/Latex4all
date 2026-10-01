import { contextTokens, type ResultUsage } from "@/lib/ai-usage";
import { useClaudeChatStore } from "@/stores/claude-chat-store";

/** Past this, each message re-reads a lot: a new chat is much lighter. */
export const LONG_CHAT_TOKENS = 120_000;

/** How much the active chat's last request read, in tokens. */
function useLastContext(): number {
  return useClaudeChatStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    const results = (tab?.messages ?? []).filter((m) => m.type === "result");
    const last = results[results.length - 1] as ResultUsage | undefined;
    const u = last?.usage;
    if (!u) return 0;
    return contextTokens({
      input: u.input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    });
  });
}

/** Says when a chat has grown long, with a new one a click away. */
export function LongChatNotice() {
  const context = useLastContext();
  const streaming = useClaudeChatStore((s) => s.isStreaming);
  const newSession = useClaudeChatStore((s) => s.newSession);
  if (context < LONG_CHAT_TOKENS || streaming) return null;
  return (
    <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-muted-foreground text-xs">
      <span className="min-w-0 flex-1">
        Long chat: each message re-reads {Math.round(context / 1000)}k tokens.
      </span>
      <button
        type="button"
        onClick={newSession}
        className="shrink-0 font-medium text-primary hover:underline"
      >
        New chat
      </button>
    </div>
  );
}
