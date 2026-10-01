import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** One request to the AI, as its final message reports it. */
export interface AiUsageEntry {
  at: number;
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
): AiUsageEntry {
  const u = msg.usage ?? {};
  // The model that did most of the work, by name, when it's listed.
  const model =
    Object.keys(msg.modelUsage ?? {})[0] ?? msg.model ?? fallbackModel;
  const cost = msg.total_cost_usd ?? msg.cost_usd;
  return {
    at,
    model,
    project,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    costUsd: typeof cost === "number" ? cost : null,
    turns: msg.num_turns ?? 1,
    durationMs: msg.duration_ms ?? 0,
  };
}

export interface UsageSummary {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  byModel: { model: string; requests: number; costUsd: number }[];
  byProject: { project: string; requests: number; costUsd: number }[];
}

export function summarize(
  entries: AiUsageEntry[],
  since: number,
): UsageSummary {
  const s: UsageSummary = {
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: 0,
    byModel: [],
    byProject: [],
  };
  const models = new Map<string, { requests: number; costUsd: number }>();
  const projects = new Map<string, { requests: number; costUsd: number }>();
  for (const e of entries) {
    if (e.at < since) continue;
    s.requests++;
    s.input += e.input;
    s.output += e.output;
    s.cacheRead += e.cacheRead;
    s.cacheWrite += e.cacheWrite;
    s.costUsd += e.costUsd ?? 0;
    for (const [map, key] of [
      [models, e.model],
      [projects, e.project ?? "No project"],
    ] as const) {
      const row = map.get(key) ?? { requests: 0, costUsd: 0 };
      row.requests++;
      row.costUsd += e.costUsd ?? 0;
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

interface AiUsageState {
  entries: AiUsageEntry[];
  /** A daily amount (at API prices) to be warned at; null: none. */
  dailyBudgetUsd: number | null;
  /** The day the budget warning was last given, so it's given once. */
  warnedDay: number | null;
  record: (entry: AiUsageEntry) => void;
  setDailyBudget: (usd: number | null) => void;
  clear: () => void;
}

export const useAiUsage = create<AiUsageState>()(
  persist(
    (set, get) => ({
      entries: [],
      dailyBudgetUsd: null,
      warnedDay: null,
      record: (entry) => {
        set((s) => ({ entries: [...s.entries, entry].slice(-KEEP) }));
        const { dailyBudgetUsd, warnedDay, entries } = get();
        const today = startOfToday();
        if (!dailyBudgetUsd || warnedDay === today) return;
        const spent = summarize(entries, today).costUsd;
        if (spent >= dailyBudgetUsd) {
          set({ warnedDay: today });
          toast.warning(`AI use today is past your $${dailyBudgetUsd} budget`, {
            description: `About $${spent.toFixed(2)} at API prices. Settings → AI usage has the details.`,
          });
        }
      },
      setDailyBudget: (usd) => set({ dailyBudgetUsd: usd, warnedDay: null }),
      clear: () => set({ entries: [], warnedDay: null }),
    }),
    { name: "latex4all-ai-usage" },
  ),
);
