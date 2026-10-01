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
import { startOfToday, summarize, useAiUsage } from "@/lib/ai-usage";
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
