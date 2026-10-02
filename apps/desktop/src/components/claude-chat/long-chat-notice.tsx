import { useState } from "react";
import { engineOfProvider } from "@/lib/agent-events";
import {
  acceptHandoff,
  availableServices,
  fallbackOrder,
  nextService,
  outUntil,
  serviceLabel,
  serviceOf,
  switchBack,
} from "@/lib/ai-continuity";
import { useCitationCheck } from "@/components/workspace/citation-check";
import { useProposedChangesStore } from "@/stores/proposed-changes-store";
import { LimitBar, resetsLabel } from "@/components/settings/ai-usage-settings";
import {
  type LimitWindow,
  lastCallContext,
  useAiUsage,
  windowName,
} from "@/lib/ai-usage";
import { CLAUDE_CODE_PROVIDER_ID } from "@/stores/claude-chat-store";
import { useSettingsWindow } from "@/stores/settings-window-store";
import { useClaudeChatStore } from "@/stores/claude-chat-store";

/** Past this, each message re-reads a lot: a new chat is much lighter. */
export const LONG_CHAT_TOKENS = 120_000;

/** How much the active chat's last request read, in tokens. */
export function useLastContext(): number {
  return useClaudeChatStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return lastCallContext(tab?.messages ?? []).context;
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
 * The plan window filling up, for Claude or ChatGPT, with the next AI one
 * click away from 95%; and when a service is out, where the chat goes next.
 */
export function ClaudeLimitNotice() {
  const claudeLimits = useAiUsage((s) => s.claudeLimits);
  const codexLimits = useAiUsage((s) => s.codexLimits);
  const blocked = useAiUsage((s) => s.blocked);
  const autoContinue = useAiUsage((s) => s.autoContinue);
  const providerId = useClaudeChatStore((s) => s.selectedProviderCredentialId);
  const handoff = useClaudeChatStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.handoff,
  );
  if (handoff) return null;
  const current = serviceOf(providerId);
  const now = Date.now();
  const out = outUntil(current, { claudeLimits, codexLimits, blocked }, now);
  const next = nextService(
    current,
    fallbackOrder(),
    availableServices(),
    (id) => outUntil(id, { claudeLimits, codexLimits, blocked }, now) !== null,
  );
  const switchNow = () => {
    if (next)
      useClaudeChatStore.getState().setSelectedProviderCredentialId(next);
  };

  if (out !== null) {
    return (
      <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1">
          {serviceLabel(current)} hit its limit. It resets{" "}
          {resetsLabel(out, now)}.
          {next &&
            autoContinue &&
            ` Your next message goes to ${serviceLabel(next)}.`}
        </span>
        {next ? (
          <button
            type="button"
            onClick={switchNow}
            className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 font-medium hover:bg-muted"
          >
            Use {serviceLabel(next)}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => useSettingsWindow.getState().show("provider")}
            className="shrink-0 font-medium text-primary hover:underline"
          >
            Add another AI
          </button>
        )}
      </div>
    );
  }

  // The windows filling up, for the service in use.
  const windows: { label: string; w: LimitWindow }[] = [];
  if (current === CLAUDE_CODE_PROVIDER_ID && claudeLimits) {
    if (claudeLimits.fiveHour)
      windows.push({ label: "5-hour", w: claudeLimits.fiveHour });
    if (claudeLimits.sevenDay)
      windows.push({ label: "Week", w: claudeLimits.sevenDay });
  }
  if (engineOfProvider(current) === "codex" && codexLimits) {
    for (const w of [codexLimits.primary, codexLimits.secondary]) {
      if (w) {
        windows.push({
          label: windowName(w.minutes),
          w: { utilization: w.usedPercent / 100, resetsAt: w.resetsAt },
        });
      }
    }
  }
  const full = windows.filter(
    ({ w }) => w.resetsAt > now && w.utilization >= NEARLY_FULL,
  );
  if (!full.length) return null;
  const almostOut = full.some(({ w }) => w.utilization >= 0.95);
  return (
    <div className="mx-3 mb-1 flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-1.5">
      {full.map(({ label, w }) => (
        <LimitBar key={label} label={label} window={w} compact />
      ))}
      {almostOut && next && (
        <button
          type="button"
          onClick={switchNow}
          className="shrink-0 font-medium text-primary text-xs hover:underline"
          title="Switch before the limit is reached"
        >
          Switch to {serviceLabel(next)}
        </button>
      )}
    </div>
  );
}

/** Carrying on with another AI while the one in use is out. */
export function HandoffNotice() {
  const tab = useClaudeChatStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const h = tab?.handoff;
  if (!tab || !h) return null;
  if (h.mode === "offer") {
    return (
      <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1">
          {h.from} reached its usage limit
          {h.resume ? " in the middle of your request" : ""}.
        </span>
        <button
          type="button"
          onClick={() => acceptHandoff(tab.id)}
          className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 font-medium hover:bg-muted"
        >
          {h.resume ? `Continue with ${h.to}` : `Use ${h.to}`}
        </button>
      </div>
    );
  }
  return (
    <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-muted-foreground text-xs">
      <span className="min-w-0 flex-1">
        {`${h.from} is out${h.backAt ? ` until ${resetsLabel(h.backAt)}` : ""}; continuing with ${h.to}${h.backAt ? ", and back after" : ""}.`}
      </span>
      <button
        type="button"
        onClick={() => switchBack(tab.id)}
        className="shrink-0 hover:text-foreground"
      >
        Back to {h.from} now
      </button>
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
