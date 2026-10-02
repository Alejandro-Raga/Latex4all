import { useState } from "react";
import { useCitationCheck } from "@/components/workspace/citation-check";
import { useProposedChangesStore } from "@/stores/proposed-changes-store";
import { LimitBar, resetsLabel } from "@/components/settings/ai-usage-settings";
import {
  claudeLimited,
  contextTokens,
  type LimitWindow,
  type ResultUsage,
  useAiUsage,
} from "@/lib/ai-usage";
import { CLAUDE_CODE_PROVIDER_ID } from "@/stores/claude-chat-store";
import { useFallbackChoices } from "@/lib/fallback-choices";
import { useSettingsWindow } from "@/stores/settings-window-store";
import { useClaudeChatStore } from "@/stores/claude-chat-store";

/** Past this, each message re-reads a lot: a new chat is much lighter. */
export const LONG_CHAT_TOKENS = 120_000;

/** How much the active chat's last request read, in tokens. */
export function useLastContext(): number {
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

/** Shown from this full on: below it, the meter would be noise. */
const NEARLY_FULL = 0.75;

/**
 * Claude's plan windows when they're filling up, and when a limit is
 * reached, the other AI services you've set up, one click away.
 */
export function ClaudeLimitNotice() {
  const limits = useAiUsage((s) => s.claudeLimits);
  const providerId = useClaudeChatStore((s) => s.selectedProviderCredentialId);
  const setProvider = useClaudeChatStore(
    (s) => s.setSelectedProviderCredentialId,
  );
  const others = useFallbackChoices();
  const onClaude = !providerId || providerId === CLAUDE_CODE_PROVIDER_ID;
  if (!onClaude || !limits) return null;

  const now = Date.now();
  if (claudeLimited(limits, now)) {
    return (
      <div className="mx-3 mb-1 space-y-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
        <div>
          Claude's limit is reached; it resets{" "}
          {resetsLabel(limits.limitedUntil as number, now)}.
        </div>
        <div className="flex flex-wrap gap-1.5">
          {others.length > 0 ? (
            others.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setProvider(c.id)}
                className="rounded-md border border-border bg-background px-2 py-0.5 font-medium hover:bg-muted"
              >
                Use {c.label}
              </button>
            ))
          ) : (
            <button
              type="button"
              onClick={() => useSettingsWindow.getState().show("provider")}
              className="font-medium text-primary hover:underline"
            >
              Add another AI service
            </button>
          )}
        </div>
      </div>
    );
  }

  const full = [
    { label: "5-hour", w: limits.fiveHour },
    { label: "Week", w: limits.sevenDay },
  ].filter((x): x is { label: string; w: LimitWindow } =>
    Boolean(x.w && x.w.resetsAt > now && x.w.utilization >= NEARLY_FULL),
  );
  if (!full.length) return null;
  return (
    <div className="mx-3 mb-1 flex gap-3 rounded-lg border border-border bg-muted/50 px-3 py-1.5">
      {full.map(({ label, w }) => (
        <LimitBar key={label} label={label} window={w} compact />
      ))}
    </div>
  );
}

/** A request waiting for another chat to stop editing the project. */
export function WaitingNotice() {
  const tab = useClaudeChatStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  if (!tab?.waitingFor) return null;
  const { sendWaitingNow, cancelWaiting } = useClaudeChatStore.getState();
  return (
    <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs">
      <span className="min-w-0 flex-1 text-muted-foreground">
        Waiting for “{tab.waitingFor}” to finish with this project; “
        {(tab.waitingText ?? "").slice(0, 60)}
        {(tab.waitingText ?? "").length > 60 ? "…" : ""}” goes next.
      </span>
      <button
        type="button"
        onClick={() => sendWaitingNow(tab.id)}
        className="shrink-0 font-medium text-primary hover:underline"
      >
        Send now
      </button>
      <button
        type="button"
        onClick={() => cancelWaiting(tab.id)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

/** What the last reply changed, with one click to take it all back. */
export function TurnNotice() {
  const tab = useClaudeChatStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const pending = useProposedChangesStore((s) => s.changes);
  const [undoing, setUndoing] = useState(false);
  const turn = tab?.lastTurn;
  if (!tab || tab.isStreaming || !turn) return null;
  const ids = turn.changeIds.filter((id) => pending.some((c) => c.id === id));
  if (!ids.length) return null;
  const undo = async () => {
    setUndoing(true);
    try {
      for (const id of ids) {
        await useProposedChangesStore.getState().undoChange(id);
      }
      useClaudeChatStore.getState()._patchTab(tab.id, { lastTurn: null });
    } finally {
      setUndoing(false);
    }
  };
  return (
    <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        This reply changed {turn.files.join(", ")}
      </span>
      <button
        type="button"
        disabled={undoing}
        onClick={undo}
        className="shrink-0 font-medium text-primary hover:underline disabled:opacity-50"
      >
        {undoing ? "Undoing…" : "Undo"}
      </button>
    </div>
  );
}

/** Keys the last reply cites that aren't in the bibliography. */
export function CitationNotice() {
  const tab = useClaudeChatStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const keys = tab?.citationWarning;
  if (!tab || tab.isStreaming || !keys?.length) return null;
  return (
    <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate">
        This reply cites {keys.length === 1 ? "a key" : `${keys.length} keys`}{" "}
        not in your bibliography: {keys.join(", ")}
      </span>
      <button
        type="button"
        onClick={() => useCitationCheck.getState().show()}
        className="shrink-0 font-medium text-primary hover:underline"
      >
        Check citations
      </button>
      <button
        type="button"
        onClick={() =>
          useClaudeChatStore
            .getState()
            ._patchTab(tab.id, { citationWarning: null })
        }
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
