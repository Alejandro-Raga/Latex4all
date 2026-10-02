/**
 * Keeping on working when an AI service runs out: the chat moves to the next
 * one in the user's order, picks up the request that was cut short, and
 * goes back when the first one's limit resets.
 *
 * - A service is out when it says so: Claude's limit events, ChatGPT's
 *   limits as Codex records them, or a 429 / quota / balance error.
 * - "Continue automatically" switches and carries on by itself; otherwise
 *   the chat offers it, one click away.
 */
import { toast } from "sonner";
import { readyEngines, useAgentAccounts } from "@/lib/agent-accounts";
import {
  type AgentEngine,
  ENGINE_LABELS,
  engineOfProvider,
  providerOfEngine,
} from "@/lib/agent-events";
import {
  type ClaudeLimits,
  type CodexLimits,
  type CopilotQuota,
  claudeLimited,
  copilotUsedPercent,
  useAiUsage,
} from "@/lib/ai-usage";
import {
  CLAUDE_CODE_PROVIDER_ID,
  providerKeyForSelectedCredential,
  providerLabel,
  type TabState,
  useClaudeChatStore,
} from "@/stores/claude-chat-store";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";
import {
  bareModel,
  dailyLimit,
  isGoogleApi,
  nextPacificDay,
  parseQuota,
  type QuotaHit,
  requestsToday,
} from "./provider-quota";

/** How long a service that said "out" without saying until when is skipped. */
const SOFT_BLOCK = 30 * 60e3;

/** Errors that mean "out of usage", whatever the service. */
export function isLimitText(text: string | null | undefined): boolean {
  return Boolean(
    text &&
      /usage limit|rate.?limit|limit (?:reached|exceeded)|quota|429|too many requests|insufficient (?:balance|quota|credit)|credit balance|out of credits|resource.?exhausted/i.test(
        text,
      ),
  );
}

/** The chat's service id: a provider credential, an engine, or Claude. */
export const serviceOf = (providerId: string | null | undefined) =>
  providerId || CLAUDE_CODE_PROVIDER_ID;

/** When a service is back, if it's out now (null: it isn't). */
export function outUntil(
  id: string,
  state: {
    claudeLimits: ClaudeLimits | null;
    codexLimits: CodexLimits | null;
    copilotQuota?: CopilotQuota | null;
    blocked: Record<string, number>;
  },
  now = Date.now(),
  /** The model in use, for a limit on that model alone. */
  model?: string | null,
): number | null {
  if (
    id === CLAUDE_CODE_PROVIDER_ID &&
    claudeLimited(state.claudeLimits, now)
  ) {
    return state.claudeLimits?.limitedUntil ?? null;
  }
  if (engineOfProvider(id) === "codex") {
    const w = state.codexLimits?.primary;
    if (w && w.resetsAt > now && w.usedPercent >= 100) return w.resetsAt;
  }
  if (engineOfProvider(id) === "copilot") {
    const q = state.copilotQuota;
    if (q?.resetsAt && q.resetsAt > now && copilotUsedPercent(q) === 100) {
      return q.resetsAt;
    }
  }
  const until = Math.max(
    state.blocked[id] ?? 0,
    model ? (state.blocked[`${id}#${bareModel(model)}`] ?? 0) : 0,
  );
  return until > now ? until : null;
}

/** The first service in the order, other than this one, that isn't out. */
export function nextService(
  current: string,
  order: string[],
  available: string[],
  isOut: (id: string) => boolean,
): string | null {
  return (
    order.find(
      (id) => id !== current && available.includes(id) && !isOut(id),
    ) ?? null
  );
}

/** What a new service is asked to carry on with. */
export function resumePrompt(input: {
  from: string;
  request: string;
  files: string[];
}): string {
  return [
    `[Continuing] ${input.from} reached its usage limit while working on this request:`,
    `"${input.request}"`,
    input.files.length
      ? `It had already changed: ${input.files.join(", ")}. Check their current state first.`
      : "Check the files' current state first.",
    "Then finish the task, without redoing what's done.",
  ].join("\n");
}

/** Services the chat can use now: Claude, signed-in accounts, API keys. */
export function availableServices(): string[] {
  const setup = useClaudeSetupStore.getState();
  return [
    ...(setup.claudeProviderConfigured || setup.status === "ready"
      ? [CLAUDE_CODE_PROVIDER_ID]
      : []),
    ...readyEngines(useAgentAccounts.getState().status).map(providerOfEngine),
    ...setup.openAiCredentials.map((c) => c.id),
  ];
}

export const serviceLabel = (id: string) =>
  engineOfProvider(id)
    ? ENGINE_LABELS[engineOfProvider(id) as AgentEngine]
    : providerLabel(providerKeyForSelectedCredential(id));

/** The order to use: as set, else the one fallback chosen earlier. */
export function fallbackOrder(): string[] {
  const { fallbackOrder: order, fallbackService } = useAiUsage.getState();
  if (order.length) return order;
  return fallbackService ? [CLAUDE_CODE_PROVIDER_ID, fallbackService] : [];
}

/** The model a service with a key is on in the chat (null: not one). */
export function currentModelOf(id: string): string | null {
  const credential = useClaudeSetupStore
    .getState()
    .openAiCredentials.find((c) => c.id === id);
  if (!credential) return null;
  return (
    useClaudeChatStore.getState().selectedProviderModels[id] || credential.model
  );
}

/** When a service is back, if it's out now: as it said, or because its
 *  model has used the daily requests Google told us it has. */
export function outNow(id: string): number | null {
  const usage = useAiUsage.getState();
  const model = currentModelOf(id);
  const said = outUntil(id, usage, Date.now(), model);
  if (said !== null || !model) return said;
  const credential = useClaudeSetupStore
    .getState()
    .openAiCredentials.find((c) => c.id === id);
  if (!isGoogleApi(credential?.base_url)) return null;
  const limit = dailyLimit(model, usage.dailyLimits);
  return limit?.known && requestsToday(usage.entries, model) >= limit.limit
    ? nextPacificDay()
    : null;
}

const isOutNow = (id: string) => outNow(id) !== null;

/**
 * A provider's quota error: learn the model's daily limit and skip that
 * model until it's back (the next Pacific day, or after the wait it asks).
 */
export function noteQuota(id: string, text: string): QuotaHit | null {
  const hit = parseQuota(text);
  if (!hit) return null;
  const model = hit.model ?? currentModelOf(id);
  if (!model) return hit;
  const usage = useAiUsage.getState();
  if (hit.period === "day") {
    if (hit.limit) usage.learnDailyLimit(bareModel(model), hit.limit);
    usage.block(`${id}#${bareModel(model)}`, nextPacificDay());
  } else {
    usage.block(
      `${id}#${bareModel(model)}`,
      Date.now() + Math.max(60, hit.retrySecs ?? 60) * 1000,
    );
  }
  return hit;
}

const backTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Moves a chat to another service (not a choice to remember). */
function switchTab(tabId: string, toId: string) {
  const chat = useClaudeChatStore.getState();
  chat._patchTab(tabId, {
    providerKey: providerKeyForSelectedCredential(toId),
  });
  if (chat.activeTabId === tabId)
    chat.setSelectedProviderCredentialId(toId, true);
}

/** Back to the first service once its limit has reset. */
function scheduleBack(tabId: string, fromId: string, at: number | null) {
  const old = backTimers.get(tabId);
  if (old) clearTimeout(old);
  if (!at) return;
  backTimers.set(
    tabId,
    setTimeout(
      () => {
        backTimers.delete(tabId);
        const tab = useClaudeChatStore
          .getState()
          .tabs.find((t) => t.id === tabId);
        if (!tab?.handoff || tab.handoff.fromId !== fromId) return;
        if (tab.isStreaming) {
          scheduleBack(tabId, fromId, Date.now() + 60e3);
          return;
        }
        switchBack(tabId);
        toast.info(`Back to ${tab.handoff.from}: its limit has reset`);
      },
      Math.max(0, at - Date.now()) + 30e3,
    ),
  );
}

/** Returns a chat to the service it was on before running out. */
export function switchBack(tabId: string) {
  const chat = useClaudeChatStore.getState();
  const tab = chat.tabs.find((t) => t.id === tabId);
  if (!tab?.handoff) return;
  switchTab(tabId, tab.handoff.fromId);
  chat._patchTab(tabId, { handoff: null });
}

/** Takes up an offered handoff: switch, and carry on with the request. */
export function acceptHandoff(tabId: string) {
  const chat = useClaudeChatStore.getState();
  const tab = chat.tabs.find((t) => t.id === tabId);
  const h = tab?.handoff;
  if (!h) return;
  switchTab(tabId, h.toId);
  chat._patchTab(tabId, { handoff: { ...h, mode: "auto", resume: undefined } });
  scheduleBack(tabId, h.fromId, h.backAt);
  if (h.resume) {
    void chat.sendPrompt(h.resume, undefined, { tabId, evenIfBusy: true });
  }
}

/** The files a chat's requests have changed, as its tool calls show. */
function filesChanged(tab: TabState): string[] {
  const root = tab.projectPath ?? "";
  const files = new Set<string>();
  for (const m of tab.messages) {
    for (const b of m.message?.content ?? []) {
      if (
        b.type !== "tool_use" ||
        !/^(Write|Edit|MultiEdit)$/i.test(b.name ?? "")
      ) {
        continue;
      }
      const path = b.input?.file_path;
      if (typeof path === "string") {
        files.add(
          path.startsWith(root)
            ? path.slice(root.length).replace(/^[\\/]/, "")
            : path,
        );
      }
    }
  }
  return [...files];
}

/**
 * A chat's request ran into its service's limit: mark the service out, and
 * carry on with the next one (or offer to).
 */
export function onLimitHit(tabId: string, request: string | null) {
  const chat = useClaudeChatStore.getState();
  const tab = chat.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const fromId = serviceOf(
    providerIdOf(tab.sessionProviderKey ?? tab.providerKey),
  );
  if (outNow(fromId) === null)
    useAiUsage.getState().block(fromId, Date.now() + SOFT_BLOCK);
  const backAt = outNow(fromId);
  const toId = nextService(
    fromId,
    fallbackOrder(),
    availableServices(),
    isOutNow,
  );
  if (!toId) {
    chat._setError(
      tabId,
      `${serviceLabel(fromId)} reached its usage limit and no other AI is set up to continue. Add one from the model menu → Add an AI, or set the order in Settings → AI usage.`,
    );
    return;
  }
  const resume = request
    ? resumePrompt({
        from: serviceLabel(fromId),
        request,
        files: filesChanged(tab),
      })
    : undefined;
  const handoff = {
    fromId,
    from: serviceLabel(fromId),
    toId,
    to: serviceLabel(toId),
    backAt,
    mode: "offer" as const,
    resume,
  };
  chat._patchTab(tabId, { handoff, error: null });
  if (useAiUsage.getState().autoContinue) acceptHandoff(tabId);
}

/**
 * Before sending: if the chat's service is known to be out, move to the next
 * one first rather than fail. Returns whether it switched.
 */
export function switchIfOut(tabId: string): boolean {
  if (!useAiUsage.getState().autoContinue) return false;
  const tab = useClaudeChatStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return false;
  const fromId = serviceOf(providerIdOf(tab.providerKey));
  const backAt = outNow(fromId);
  if (backAt === null) return false;
  const toId = nextService(
    fromId,
    fallbackOrder(),
    availableServices(),
    isOutNow,
  );
  if (!toId) return false;
  switchTab(tabId, toId);
  useClaudeChatStore.getState()._patchTab(tabId, {
    handoff: {
      fromId,
      from: serviceLabel(fromId),
      toId,
      to: serviceLabel(toId),
      backAt,
      mode: "auto",
    },
  });
  scheduleBack(tabId, fromId, backAt);
  return true;
}

/** "openai-compatible:<id>" → "<id>"; Claude Code's key → its id. */
function providerIdOf(key: string | null | undefined): string | null {
  if (!key) return null;
  return key.replace(/^openai-compatible:/, "");
}
