import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AiUsageEntry,
  claudeLimited,
  type LimitWindow,
  startOfToday,
  summarize,
  useAiUsage,
} from "@/lib/ai-usage";
import { cn } from "@/lib/utils";
import { useClaudeChatStore } from "@/stores/claude-chat-store";

const PERIODS = [
  { id: "today", label: "Today", since: () => startOfToday() },
  { id: "week", label: "7 days", since: () => Date.now() - 7 * 864e5 },
  { id: "month", label: "30 days", since: () => Date.now() - 30 * 864e5 },
] as const;

const MODELS = [
  { id: "sonnet", label: "Sonnet", detail: "Recommended" },
  { id: "opusplan", label: "Opus plan", detail: "Opus plans, Sonnet writes" },
  { id: "opus", label: "Opus", detail: "Heaviest" },
  { id: "haiku", label: "Haiku", detail: "Lightest" },
] as const;

const tokens = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${Math.round(n / 1e3)}k`
      : String(n);
const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
const projectName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <span className="text-sm">{label}</span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="font-medium text-lg tabular-nums">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}

/** "in 2 h 10 min", "Thu 14:00": when a window starts over. */
export function resetsLabel(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((at - now) / 60000));
  if (mins < 60) return `in ${mins} min`;
  if (mins < 24 * 60) {
    return `in ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min`;
  }
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A window's bar: how full it is, and its colour once nearly full. */
export function LimitBar({
  label,
  window: w,
  compact,
}: {
  label: string;
  window: LimitWindow;
  compact?: boolean;
}) {
  const pct = Math.min(100, Math.round(w.utilization * 100));
  return (
    <div className={compact ? "min-w-0 flex-1" : undefined}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={compact ? "text-muted-foreground" : "text-sm"}>
          {label}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {pct}% · resets {resetsLabel(w.resetsAt)}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 90
              ? "bg-destructive"
              : pct >= 70
                ? "bg-amber-500"
                : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Claude's own 5-hour and weekly windows, and what this app sent in them. */
function ClaudePlan({ entries }: { entries: AiUsageEntry[] }) {
  const limits = useAiUsage((s) => s.claudeLimits);
  if (!limits || (!limits.fiveHour && !limits.sevenDay)) return null;
  const sentSince = (from: number) =>
    summarize(
      entries.filter((e) => !e.provider || e.provider === "Claude"),
      from,
    ).requests;
  const windows = [
    { label: "5-hour window", w: limits.fiveHour, span: 5 * 3600e3 },
    { label: "Weekly", w: limits.sevenDay, span: 7 * 864e5 },
  ].filter((x): x is { label: string; w: LimitWindow; span: number } =>
    Boolean(x.w),
  );
  return (
    <div className="mx-5 mb-4 space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm">Claude plan</span>
        <span className="text-muted-foreground text-xs">
          {claudeLimited(limits)
            ? "Limit reached"
            : `as of ${new Date(limits.observedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
        </span>
      </div>
      {windows.map(({ label, w, span }) => (
        <div key={label}>
          <LimitBar label={label} window={w} />
          <div className="pt-0.5 text-muted-foreground text-xs">
            {sentSince(w.resetsAt - span)} requests from Latex4All in this
            window
          </div>
        </div>
      ))}
    </div>
  );
}

/** How much the AI has been used, and the settings that use less of it. */
export function AiUsageSettings() {
  const entries = useAiUsage((s) => s.entries);
  const budget = useAiUsage((s) => s.dailyBudgetUsd);
  const setBudget = useAiUsage((s) => s.setDailyBudget);
  const clear = useAiUsage((s) => s.clear);
  const model = useClaudeChatStore((s) => s.selectedModel);
  const setModel = useClaudeChatStore((s) => s.setSelectedModel);
  const effort = useClaudeChatStore((s) => s.effortLevel);
  const setEffort = useClaudeChatStore((s) => s.setEffortLevel);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("week");
  const summary = useMemo(
    () =>
      summarize(
        entries,
        (PERIODS.find((p) => p.id === period) ?? PERIODS[0]).since(),
      ),
    [entries, period],
  );
  const sent = summary.input + summary.cacheRead + summary.cacheWrite;
  const breakdown: {
    title: string;
    rows: { name: string; requests: number; costUsd: number }[];
  }[] = [
    {
      title: "By model",
      rows: summary.byModel.map((m) => ({ ...m, name: m.model })),
    },
    {
      title: "By project",
      rows: summary.byProject
        .slice(0, 5)
        .map((p) => ({ ...p, name: projectName(p.project) })),
    },
  ];

  return (
    <div className="py-2">
      <div className="pt-2">
        <ClaudePlan entries={entries} />
      </div>
      <div className="flex items-center gap-1 px-5 pt-1 pb-3">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              period === p.id
                ? "bg-muted font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 px-5 sm:grid-cols-4">
        <Stat label="Requests" value={String(summary.requests)} />
        <Stat label="At API prices" value={usd(summary.costUsd)} />
        <Stat label="Tokens read" value={tokens(sent)} />
        <Stat label="Tokens written" value={tokens(summary.output)} />
      </div>
      {sent > 0 && (
        <p className="px-5 pt-2 text-muted-foreground text-xs">
          {Math.round((summary.cacheRead / sent) * 100)}% of what was read came
          from the cache.
        </p>
      )}

      {summary.requests > 0 && (
        <div className="grid gap-4 px-5 pt-4 sm:grid-cols-2">
          {breakdown.map(({ title, rows }) => (
            <div key={title}>
              <div className="pb-1 text-muted-foreground text-xs">{title}</div>
              {rows.map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between gap-2 py-0.5 text-xs"
                >
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {row.requests} · {usd(row.costUsd)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-border border-t pt-2">
        <Row label="Model for new requests">
          <Select
            value={model}
            onValueChange={(v) => setModel(v as typeof model)}
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                  <span className="text-muted-foreground text-xs">
                    {m.detail}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Thinking effort">
          <Select
            value={effort}
            onValueChange={(v) => setEffort(v as typeof effort)}
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Effort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Warn me past, per day">
          <span className="text-muted-foreground text-sm">$</span>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={budget ?? ""}
            placeholder="No limit"
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value);
              setBudget(Number.isFinite(n) && n > 0 ? n : null);
            }}
            className="h-8 w-24 text-sm"
            aria-label="Daily budget in dollars"
          />
        </Row>
        <Row label="Usage history">
          <Button
            variant="ghost"
            size="sm"
            disabled={!entries.length}
            onClick={clear}
          >
            Clear
          </Button>
        </Row>
      </div>
    </div>
  );
}
