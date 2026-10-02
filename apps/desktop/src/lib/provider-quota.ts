/**
 * Daily request limits of free API tiers (Gemini's above all: a few dozen
 * requests a day on Flash). Google doesn't publish them, and they vary by
 * account, so they're learned from its own 429s ("limit: 20 a day"), with
 * a starting guess until then. A chat message is several requests: one per
 * step (reading a file, editing it, answering).
 */
import type { AiUsageEntry } from "@/lib/ai-usage";

export interface QuotaHit {
  period: "day" | "minute";
  limit: number | null;
  model: string | null;
  retrySecs: number | null;
}

/** The quota the proxy says ran out: "[quota day=20 model=… retry=33]". */
export function parseQuota(text: string | null | undefined): QuotaHit | null {
  const m = text?.match(
    /\[quota (day|minute)=(\d*) model=([^\s\]]+)(?: retry=(\d+))?\]/,
  );
  if (!m) return null;
  return {
    period: m[1] as "day" | "minute",
    limit: m[2] ? Number(m[2]) : null,
    model: bareModel(m[3]),
    retrySecs: m[4] ? Number(m[4]) : null,
  };
}

/** "models/gemini-3.8-flash" → "gemini-3.8-flash". */
export const bareModel = (model: string) => model.replace(/^models\//, "");

export const isGoogleApi = (baseUrl: string | null | undefined) =>
  /generativelanguage\.googleapis\.com/i.test(baseUrl ?? "");

/**
 * A free Gemini model's daily requests: as Google said last, else a guess
 * (Flash-Lite ~500, Flash ~20; Pro and the rest unknown).
 */
export function dailyLimit(
  model: string,
  learned: Record<string, number>,
): { limit: number; known: boolean } | null {
  const bare = bareModel(model);
  if (learned[bare]) return { limit: learned[bare], known: true };
  if (/^gemini-.*flash-lite/i.test(bare)) return { limit: 500, known: false };
  if (/^gemini-.*flash/i.test(bare)) return { limit: 20, known: false };
  return null;
}

/** Google's day starts at midnight Pacific time. */
export function pacificDayStart(now = Date.now()): number {
  const [h, m, s] = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(now)
    .split(":")
    .map(Number);
  return now - ((h * 60 + m) * 60 + s) * 1000 - (now % 1000);
}

export const nextPacificDay = (now = Date.now()) =>
  pacificDayStart(now) + 24 * 3600e3;

/** Requests to a model since Google's day started (each step counts). */
export function requestsToday(
  entries: AiUsageEntry[],
  model: string,
  now = Date.now(),
): number {
  const start = pacificDayStart(now);
  const bare = bareModel(model);
  return entries
    .filter((e) => e.at >= start && bareModel(e.model) === bare)
    .reduce((sum, e) => sum + Math.max(1, e.turns), 0);
}

/** What the chat says when a provider's quota ran out. */
export function quotaMessage(who: string, hit: QuotaHit | null): string {
  if (hit?.period === "day") {
    const model = hit.model ? ` (${hit.model})` : "";
    const lite =
      hit.model && /flash/i.test(hit.model) && !/lite/i.test(hit.model)
        ? " Flash-Lite models allow many more."
        : "";
    const count = hit.limit ? `its ${hit.limit} free requests` : "its requests";
    return `${who}${model} has used ${count} for today (one message can take several). They reset at midnight Pacific time.${lite}`;
  }
  if (hit?.period === "minute") {
    return `${who} got too many requests at once. Wait a minute or switch AI.`;
  }
  return `${who} hit a usage limit. Free tiers allow only a few requests per minute or day. Wait a moment or switch AI.`;
}
