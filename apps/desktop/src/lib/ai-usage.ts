import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * How a request is paid: within a plan (Claude Pro/Max, a ChatGPT or Google
 * account: no price per call), as Claude's extra usage past the plan, or by
 * API key. Only the last two cost money per request.
 */
export type Billing = "plan" | "extra" | "api";

/** One request to the AI, as its final message reports it. */
export interface AiUsageEntry {
  /** Absent in entries from before this was kept: Claude's count as plan. */
  billing?: Billing;
  at: number;
  /** The service: "Claude", or the name given to another provider. */
  provider?: string;
  model: string;
  project: string | null;
  input: number;
  output: number;
  /** Read back from the prompt cache: cheap, but still counted. */
  cacheRead: number;
  cacheWrite: number;
  /** What the request would cost at API prices (on a plan, a measure of
   *  how much of it a request used). Null when the provider doesn't say. */
  costUsd: number | null;
  turns: number;
  durationMs: number;
  /** The chat it came from. */
  tab?: string;
  /** Share of the plan window it used, measured (percentage points). */
  windowDelta?: number;
  /** Which window: "5h", "week", "month"… */
  window?: string;
}

/** What Claude Code's final "result" message carries about a request. */
export interface ResultUsage {
  model?: string;
  total_cost_usd?: number;
  cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
}

const KEEP = 5000;

/** Turns a result message into an entry. */
export function usageEntry(
  msg: ResultUsage,
  project: string | null,
  fallbackModel: string,
  at = Date.now(),
  provider = "Claude",
  billing?: Billing,
): AiUsageEntry {
  const u = msg.usage ?? {};
  // The model that did most of the work, by name, when it's listed.
  const model =
    Object.keys(msg.modelUsage ?? {})[0] ?? msg.model ?? fallbackModel;
  const cost = msg.total_cost_usd ?? msg.cost_usd;
  return {
    at,
    ...(billing ? { billing } : {}),
    provider,
    model,
    project,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    // Priced as Claude; for another service that figure means nothing.
    costUsd: provider === "Claude" && typeof cost === "number" ? cost : null,
    turns: msg.num_turns ?? 1,
    durationMs: msg.duration_ms ?? 0,
  };
}

/** A service's prices, in dollars per million tokens. */
export interface ServicePrice {
  input: number;
  output: number;
}

/** Whether a request was paid for by itself (not within a plan). */
export const isBilled = (e: Pick<AiUsageEntry, "billing" | "provider">) =>
  e.billing
    ? e.billing !== "plan"
    : e.provider !== "Claude" && Boolean(e.provider);

/** What a request cost: nothing within a plan; else as Claude reported, or
 *  from the prices set for the service. */
export function entryCost(
  e: AiUsageEntry,
  prices: Record<string, ServicePrice> = {},
): number {
  if (!isBilled(e)) return 0;
  if (e.costUsd !== null) return e.costUsd;
  const price = prices[e.provider ?? "Claude"];
  if (!price) return 0;
  return (
    ((e.input + e.cacheRead + e.cacheWrite) * price.input +
      e.output * price.output) /
    1e6
  );
}

export interface UsageSummary {
  requests: number;
  /** Requests within a plan: counted, not priced. */
  planRequests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  byModel: { model: string; requests: number; costUsd: number }[];
  byProject: { project: string; requests: number; costUsd: number }[];
  byService: { service: string; requests: number; costUsd: number }[];
}

export function summarize(
  entries: AiUsageEntry[],
  since: number,
  prices: Record<string, ServicePrice> = {},
): UsageSummary {
  const s: UsageSummary = {
    requests: 0,
    planRequests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: 0,
    byModel: [],
    byProject: [],
    byService: [],
  };
  const models = new Map<string, { requests: number; costUsd: number }>();
  const projects = new Map<string, { requests: number; costUsd: number }>();
  const services = new Map<string, { requests: number; costUsd: number }>();
  for (const e of entries) {
    if (e.at < since) continue;
    s.requests++;
    if (!isBilled(e)) s.planRequests++;
    s.input += e.input;
    s.output += e.output;
    s.cacheRead += e.cacheRead;
    s.cacheWrite += e.cacheWrite;
    const cost = entryCost(e, prices);
    s.costUsd += cost;
    for (const [map, key] of [
      [
        models,
        !e.provider || e.provider === "Claude"
          ? e.model
          : `${e.provider} · ${e.model}`,
      ],
      [projects, e.project ?? "No project"],
      [services, e.provider ?? "Claude"],
    ] as const) {
      const row = map.get(key) ?? { requests: 0, costUsd: 0 };
      row.requests++;
      row.costUsd += cost;
      map.set(key, row);
    }
  }
  const sorted = <K extends string>(
    map: Map<string, { requests: number; costUsd: number }>,
    k: K,
  ) =>
    [...map]
      .map(
        ([name, row]) =>
          ({ [k]: name, ...row }) as { [P in K]: string } & {
            requests: number;
            costUsd: number;
          },
      )
      .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);
  s.byModel = sorted(models, "model");
  s.byProject = sorted(projects, "project");
  s.byService = sorted(services, "service");
  return s;
}

/** Midnight today, local time. */
export function startOfToday(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Tokens a request sent in all: new, cached and cache-written. */
export const contextTokens = (
  e: Pick<AiUsageEntry, "input" | "cacheRead" | "cacheWrite">,
) => e.input + e.cacheRead + e.cacheWrite;

/** One of Claude's plan windows: how much is used and when it resets. */
export interface LimitWindow {
  /** Fraction used, usually 0–1. */
  utilization: number;
  resetsAt: number;
}

/** Claude's plan limits as last reported (only for a Claude plan login). */
export interface ClaudeLimits {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  /** "rejected" when a limit is reached, until `limitedUntil`. */
  status: "allowed" | "allowed_warning" | "rejected";
  limitedUntil: number | null;
  /** Which window is the one that counts now ("five_hour", "seven_day"…). */
  limitType: string | null;
  /** Past the plan, on extra usage (billed per request). */
  usingOverage?: boolean;
  observedAt: number;
}

/** What Claude Code's rate_limit_event carries (times in seconds). */
export interface RateLimitInfo {
  status?: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  isUsingOverage?: boolean;
  unifiedWindows?: {
    five_hour?: { utilization: number; resetsAt: number };
    seven_day?: { utilization: number; resetsAt: number };
  };
}

/** The limits after an event, keeping windows it doesn't mention. */
export function nextLimits(
  prev: ClaudeLimits | null,
  info: RateLimitInfo,
  now = Date.now(),
): ClaudeLimits {
  const win = (w?: { utilization: number; resetsAt: number }) =>
    w ? { utilization: w.utilization, resetsAt: w.resetsAt * 1000 } : undefined;
  const fresh = (w?: LimitWindow) => (w && w.resetsAt > now ? w : undefined);
  const out: ClaudeLimits = {
    fiveHour: win(info.unifiedWindows?.five_hour) ?? fresh(prev?.fiveHour),
    sevenDay: win(info.unifiedWindows?.seven_day) ?? fresh(prev?.sevenDay),
    status: info.status ?? prev?.status ?? "allowed",
    limitType: info.rateLimitType ?? prev?.limitType ?? null,
    usingOverage:
      info.isUsingOverage ??
      (info.rateLimitType === "overage" ? true : prev?.usingOverage),
    limitedUntil:
      info.status === "rejected" && info.resetsAt ? info.resetsAt * 1000 : null,
    observedAt: now,
  };
  // The window that counts, from the top-level figures, when it isn't listed.
  if (info.utilization !== undefined && info.resetsAt) {
    const w = { utilization: info.utilization, resetsAt: info.resetsAt * 1000 };
    if (info.rateLimitType === "five_hour" && !out.fiveHour) out.fiveHour = w;
    if (info.rateLimitType === "seven_day" && !out.sevenDay) out.sevenDay = w;
  }
  return out;
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/** "Oct 3 at 2am (Europe/Madrid)", "7:30pm": when, in local time. */
export function parseResetTime(text: string, now = new Date()): number | null {
  const m = text.match(
    /(?:([A-Za-z]{3})[a-z]* (\d{1,2})(?:,? \d{4})? at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  );
  if (!m) return null;
  let hour = Number(m[3]) % 12;
  if (m[5].toLowerCase() === "pm") hour += 12;
  const at = new Date(now);
  at.setHours(hour, Number(m[4] ?? 0), 0, 0);
  if (m[1]) {
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) return null;
    at.setMonth(month, Number(m[2]));
    // "Jan 2", seen in late December, is next year's.
    if (at.getTime() < now.getTime() - 24 * 3600e3) {
      at.setFullYear(at.getFullYear() + 1);
    }
  } else if (at.getTime() < now.getTime()) {
    at.setDate(at.getDate() + 1);
  }
  return at.getTime();
}

/**
 * Claude Code's /usage text: "Current session: 3% used · resets Oct 3 at
 * 2am", and the same for the week. Null when it shows no plan limits (an
 * API key).
 */
export function parseClaudeUsage(
  text: string,
  now = new Date(),
): { fiveHour?: LimitWindow; sevenDay?: LimitWindow } | null {
  const window = (label: RegExp, length: number): LimitWindow | undefined => {
    const m = text.match(label);
    if (!m) return undefined;
    return {
      utilization: Number(m[1]) / 100,
      resetsAt:
        (m[2] ? parseResetTime(m[2], now) : null) ?? now.getTime() + length,
    };
  };
  const fiveHour = window(
    /Current session:\s*([\d.]+)% used(?:\s*·\s*resets ([^\n]+))?/i,
    5 * 3600e3,
  );
  const sevenDay = window(
    /Current week \(all models\):\s*([\d.]+)% used(?:\s*·\s*resets ([^\n]+))?/i,
    7 * 24 * 3600e3,
  );
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

/** Whether Claude is refusing requests right now. */
export const claudeLimited = (l: ClaudeLimits | null, now = Date.now()) =>
  Boolean(
    l && l.status === "rejected" && l.limitedUntil && l.limitedUntil > now,
  );

/** One of ChatGPT's plan windows, as Codex records it. */
export interface PlanWindow {
  usedPercent: number;
  /** Its length, in minutes (300: 5 hours; 10080: a week). */
  minutes: number;
  resetsAt: number;
}

/** ChatGPT's plan limits as Codex last recorded them. */
export interface CodexLimits {
  primary?: PlanWindow;
  secondary?: PlanWindow;
  plan: string | null;
  observedAt: number;
}

/** "5h", "week", "month": a window's name from its length. */
export function windowName(minutes: number): string {
  if (minutes === 300) return "5h";
  if (minutes === 10080) return "week";
  if (minutes >= 40000 && minutes <= 45000) return "month";
  return minutes % 1440 === 0
    ? `${minutes / 1440}d`
    : `${Math.round(minutes / 60)}h`;
}

/** Codex's rate_limits record, as the app keeps it. */
export function codexLimitsFrom(
  raw: unknown,
  now = Date.now(),
): CodexLimits | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const win = (w: unknown): PlanWindow | undefined => {
    if (!w || typeof w !== "object") return undefined;
    const x = w as Record<string, number>;
    if (typeof x.used_percent !== "number") return undefined;
    return {
      usedPercent: x.used_percent,
      minutes: x.window_minutes ?? 0,
      resetsAt: (x.resets_at ?? 0) * 1000,
    };
  };
  return {
    primary: win(r.primary),
    secondary: win(r.secondary),
    plan: typeof r.plan_type === "string" ? r.plan_type : null,
    observedAt: now,
  };
}

/** Copilot's monthly premium requests, as GitHub counts them. */
export interface CopilotQuota {
  plan: string | null;
  /** The kind of access: "free_educational_quota"… */
  sku: string | null;
  entitlement: number;
  remaining: number;
  unlimited: boolean;
  resetsAt: number | null;
  observedAt: number;
}

export function copilotQuotaFrom(
  raw: unknown,
  now = Date.now(),
): CopilotQuota | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    plan: typeof r.plan === "string" ? r.plan : null,
    sku: typeof r.sku === "string" ? r.sku : null,
    entitlement: num(r.entitlement),
    remaining: num(r.remaining),
    unlimited: r.unlimited === true,
    resetsAt: typeof r.resets_at === "number" ? r.resets_at * 1000 : null,
    observedAt: now,
  };
}

/** Share of Copilot's month used (null: unlimited or not known). */
export function copilotUsedPercent(q: CopilotQuota | null): number | null {
  if (!q || q.unlimited || q.entitlement <= 0) return null;
  return Math.min(100, ((q.entitlement - q.remaining) / q.entitlement) * 100);
}

interface AiUsageState {
  entries: AiUsageEntry[];
  /** A daily amount (at API prices) to be warned at; null: none. */
  dailyBudgetUsd: number | null;
  /** The day the budget warning was last given, so it's given once. */
  warnedDay: number | null;
  claudeLimits: ClaudeLimits | null;
  codexLimits: CodexLimits | null;
  setCodexLimits: (limits: CodexLimits | null) => void;
  copilotQuota: CopilotQuota | null;
  setCopilotQuota: (quota: CopilotQuota | null) => void;
  /** A chat's last request, completed after the fact (Copilot's tokens). */
  patchLastEntry: (tab: string, patch: Partial<AiUsageEntry>) => void;
  /** A chat's last request: the share of the plan it used, measured. */
  setWindowDelta: (tab: string, delta: number, window: string) => void;
  /** Prices for services that don't report a cost, by service name. */
  prices: Record<string, ServicePrice>;
  /** A daily amount per service to be warned at. */
  serviceBudgets: Record<string, number>;
  /** Service → the day its budget warning was given. */
  serviceWarned: Record<string, number>;
  /** The service (its credential id) to move to when Claude's limit is
   *  reached; null: ask. */
  fallbackService: string | null;
  setFallbackService: (id: string | null) => void;
  /** Services to carry on with, in order, when the one in use runs out. */
  fallbackOrder: string[];
  setFallbackOrder: (ids: string[]) => void;
  /** Carry on by itself (else: offer it in the chat). */
  autoContinue: boolean;
  setAutoContinue: (on: boolean) => void;
  /** Services that said they're out (429, quota…): id → until when; a
   *  single model of a service: "id#model". */
  blocked: Record<string, number>;
  /** Free models' daily requests, as the provider said: model → limit. */
  dailyLimits: Record<string, number>;
  learnDailyLimit: (model: string, limit: number) => void;
  block: (id: string, until: number) => void;
  setPrice: (service: string, price: ServicePrice | null) => void;
  setServiceBudget: (service: string, usd: number | null) => void;
  record: (entry: AiUsageEntry, tab?: string) => void;
  recordLimits: (info: RateLimitInfo) => void;
  /** Asks Claude Code for its plan limits now (free: no model involved). */
  refreshClaudeUsage: () => Promise<boolean>;
  setDailyBudget: (usd: number | null) => void;
  clear: () => void;
}

export const useAiUsage = create<AiUsageState>()(
  persist(
    (set, get) => ({
      entries: [],
      dailyBudgetUsd: null,
      warnedDay: null,
      claudeLimits: null,
      codexLimits: null,
      setCodexLimits: (limits) => set({ codexLimits: limits }),
      copilotQuota: null,
      setCopilotQuota: (quota) => set({ copilotQuota: quota }),
      patchLastEntry: (tab, patch) =>
        set((s) => {
          const i = s.entries.map((e) => e.tab).lastIndexOf(tab);
          if (i < 0) return {};
          const entries = [...s.entries];
          entries[i] = { ...entries[i], ...patch };
          return { entries };
        }),
      setWindowDelta: (tab, delta, window) =>
        set((s) => {
          const i = s.entries.map((e) => e.tab).lastIndexOf(tab);
          if (i < 0) return {};
          const entries = [...s.entries];
          entries[i] = { ...entries[i], windowDelta: delta, window };
          return { entries };
        }),
      prices: {},
      fallbackService: null,
      setFallbackService: (id) => set({ fallbackService: id }),
      fallbackOrder: [],
      setFallbackOrder: (ids) => set({ fallbackOrder: ids }),
      autoContinue: true,
      setAutoContinue: (on) => set({ autoContinue: on }),
      dailyLimits: {},
      learnDailyLimit: (model, limit) =>
        set((s) => ({ dailyLimits: { ...s.dailyLimits, [model]: limit } })),
      blocked: {},
      block: (id, until) =>
        set((s) => ({ blocked: { ...s.blocked, [id]: until } })),
      serviceBudgets: {},
      serviceWarned: {},
      setPrice: (service, price) =>
        set((s) => {
          const prices = { ...s.prices };
          if (price) prices[service] = price;
          else delete prices[service];
          return { prices };
        }),
      setServiceBudget: (service, usd) =>
        set((s) => {
          const serviceBudgets = { ...s.serviceBudgets };
          if (usd) serviceBudgets[service] = usd;
          else delete serviceBudgets[service];
          const serviceWarned = { ...s.serviceWarned };
          delete serviceWarned[service];
          return { serviceBudgets, serviceWarned };
        }),
      recordLimits: (info) => {
        const before = get().claudeLimits;
        const after = nextLimits(before, info);
        set({ claudeLimits: after });
        if (claudeLimited(after) && !claudeLimited(before)) {
          const until = new Date(after.limitedUntil as number);
          toast.warning("Claude's usage limit is reached", {
            description: `Until ${until.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}. You can switch to another AI service in the chat.`,
          });
        }
      },
      record: (entry, tab) => {
        const kept = tab ? { ...entry, tab } : entry;
        set((s) => ({ entries: [...s.entries, kept].slice(-KEEP) }));
        const { dailyBudgetUsd, warnedDay, entries, prices } = get();
        const today = startOfToday();
        // This service's own budget.
        const service = entry.provider ?? "Claude";
        const own = get().serviceBudgets[service];
        if (own && get().serviceWarned[service] !== today) {
          const spent = summarize(
            entries.filter((e) => (e.provider ?? "Claude") === service),
            today,
            prices,
          ).costUsd;
          if (spent >= own) {
            set((s) => ({
              serviceWarned: { ...s.serviceWarned, [service]: today },
            }));
            toast.warning(`${service} today is past your $${own} budget`, {
              description: `About $${spent.toFixed(2)}. Settings → AI usage has the details.`,
            });
          }
        }
        if (!dailyBudgetUsd || warnedDay === today) return;
        const spent = summarize(entries, today, prices).costUsd;
        if (spent >= dailyBudgetUsd) {
          set({ warnedDay: today });
          toast.warning(`AI use today is past your $${dailyBudgetUsd} budget`, {
            description: `About $${spent.toFixed(2)}. Settings → AI usage has the details.`,
          });
        }
      },
      refreshClaudeUsage: async () => {
        const text = await invoke<string>("claude_usage").catch(() => "");
        const windows = parseClaudeUsage(text);
        if (!windows) return false;
        const prev = get().claudeLimits;
        set({
          claudeLimits: {
            status: prev?.status ?? "allowed",
            limitedUntil: prev?.limitedUntil ?? null,
            limitType: prev?.limitType ?? null,
            usingOverage: prev?.usingOverage,
            ...prev,
            ...(windows.fiveHour ? { fiveHour: windows.fiveHour } : {}),
            ...(windows.sevenDay ? { sevenDay: windows.sevenDay } : {}),
            observedAt: Date.now(),
          },
        });
        return true;
      },
      setDailyBudget: (usd) => set({ dailyBudgetUsd: usd, warnedDay: null }),
      clear: () => set({ entries: [], warnedDay: null }),
    }),
    { name: "latex4all-ai-usage" },
  ),
);

interface CallUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * What one model call in this chat reads now: the conversation's size.
 * From the last call's own usage when the stream gives it (Claude Code);
 * else the last request's total over its steps (a request's total adds up
 * every step, so it isn't the size).
 */
export function lastCallContext(
  messages: {
    type: string;
    message?: { usage?: CallUsage; content?: { type: string }[] };
    usage?: CallUsage;
  }[],
): { context: number; output: number } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.type === "user" &&
      !m.message?.content?.some((b) => b.type === "tool_result")
    ) {
      break;
    }
    const u = m.type === "assistant" ? m.message?.usage : undefined;
    if (u && (u.input_tokens || u.cache_read_input_tokens)) {
      return {
        context:
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0),
        output: u.output_tokens ?? 0,
      };
    }
  }
  // No per-call usage: the last request's total, over its steps.
  let steps = 1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === "result" && m.usage) {
      for (let j = i - 1; j >= 0; j--) {
        const b = messages[j];
        if (
          b.type === "user" &&
          !b.message?.content?.some((c) => c.type === "tool_result")
        ) {
          break;
        }
        if (b.message?.content?.some((c) => c.type === "tool_use")) steps++;
      }
      const u = m.usage;
      const total =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      return {
        context: Math.round(total / steps),
        output: u.output_tokens ?? 0,
      };
    }
  }
  return { context: 0, output: 0 };
}
