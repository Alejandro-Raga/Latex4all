import { type ReactNode, useMemo, useState } from "react";
import { useFallbackChoices } from "@/lib/fallback-choices";
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

/** Which service takes over when Claude's limit is reached. */
function Fallback() {
  const services = useFallbackChoices();
  const fallback = useAiUsage((s) => s.fallbackService);
  const setFallback = useAiUsage((s) => s.setFallbackService);
  if (!services.length) return null;
  const ASK = "\0ask";
  return (
    <Row label="When Claude's limit is reached">
      <Select
        value={
          fallback && services.some((c) => c.id === fallback) ? fallback : ASK
        }
        onValueChange={(v) => setFallback(v === ASK ? null : v)}
      >
        <SelectTrigger size="sm" className="w-44" aria-label="Fallback service">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ASK}>Ask me</SelectItem>
          {services.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              Switch to {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

/** A number box that keeps what's typed ("0.", "1.2") and saves a number. */
function NumberField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value ? String(value) : "");
  return (
    <Input
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const next = e.target.value.replace(",", ".");
        setText(next);
        const n = Number.parseFloat(next);
        onChange(Number.isFinite(n) && n > 0 ? n : null);
      }}
      className="h-8 w-20 text-sm"
      aria-label={label}
    />
  );
}

/**
 * Each AI service: its prices (Claude reports its own; the rest say
 * nothing, so you give them, per million tokens) and a daily warning.
 */
function Services() {
  const entries = useAiUsage((s) => s.entries);
  const prices = useAiUsage((s) => s.prices);
  const budgets = useAiUsage((s) => s.serviceBudgets);
  const setPrice = useAiUsage((s) => s.setPrice);
  const setServiceBudget = useAiUsage((s) => s.setServiceBudget);
  const configured = useFallbackChoices();
  const services = useMemo(() => {
    const names = new Set<string>(["Claude"]);
    for (const c of configured) names.add(c.label);
    for (const e of entries) if (e.provider) names.add(e.provider);
    return [...names];
  }, [configured, entries]);
  if (services.length < 2) return null;
  return (
    <div className="border-border border-t px-5 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_5.5rem] items-center gap-x-2 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Service</span>
        <span className="text-muted-foreground">$ / M in</span>
        <span className="text-muted-foreground">$ / M out</span>
        <span className="text-muted-foreground">Warn past $/day</span>
        {services.map((name) => {
          const price = prices[name];
          const set = (part: "input" | "output", n: number | null) => {
            const next = {
              input: price?.input ?? 0,
              output: price?.output ?? 0,
              [part]: n ?? 0,
            };
            setPrice(name, next.input || next.output ? next : null);
          };
          return (
            <div key={name} className="contents">
              <span className="truncate text-sm">{name}</span>
              {name === "Claude" ? (
                <span className="col-span-2 text-muted-foreground">
                  Reported by Claude
                </span>
              ) : (
                <>
                  <NumberField
                    value={price?.input}
                    onChange={(n) => set("input", n)}
                    placeholder="—"
                    label={`${name} input price per million tokens`}
                  />
                  <NumberField
                    value={price?.output}
                    onChange={(n) => set("output", n)}
                    placeholder="—"
                    label={`${name} output price per million tokens`}
                  />
                </>
              )}
              <NumberField
                value={budgets[name]}
                onChange={(n) => setServiceBudget(name, n)}
                placeholder="No limit"
                label={`${name} daily budget in dollars`}
              />
            </div>
          );
        })}
      </div>
      <p className="pt-2 text-muted-foreground text-xs">
        Prices are on each provider's pricing page.
      </p>
    </div>
  );
}

/** How much the AI has been used, and the settings that use less of it. */
export function AiUsageSettings() {
  const entries = useAiUsage((s) => s.entries);
  const budget = useAiUsage((s) => s.dailyBudgetUsd);
  const setBudget = useAiUsage((s) => s.setDailyBudget);
  const clear = useAiUsage((s) => s.clear);
  const prices = useAiUsage((s) => s.prices);
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
        prices,
      ),
    [entries, period, prices],
  );
  const sent = summary.input + summary.cacheRead + summary.cacheWrite;
  const breakdown: {
    title: string;
    rows: { name: string; requests: number; costUsd: number }[];
  }[] = [
    {
      title: "By service",
      rows: summary.byService.map((m) => ({ ...m, name: m.service })),
    },
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
        <Stat label="Cost (estimate)" value={usd(summary.costUsd)} />
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
        <Fallback />
        <Row label="Warn me past, per day">
          <span className="text-muted-foreground text-sm">$</span>
          <NumberField
            value={budget}
            onChange={setBudget}
            placeholder="No limit"
            label="Daily budget in dollars"
          />
        </Row>
        <Services />
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
