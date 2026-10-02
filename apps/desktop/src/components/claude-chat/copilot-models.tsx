import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import type { AgentModel } from "@/lib/agent-accounts";
import { copilotQuotaFrom, useAiUsage } from "@/lib/ai-usage";
import { cn } from "@/lib/utils";

const CATEGORY: Record<
  string,
  { label: string; hint: string; className: string }
> = {
  light: {
    label: "Light",
    hint: "Fast; uses the least of your month",
    className: "text-green-700 dark:text-green-400",
  },
  versatile: {
    label: "Versatile",
    hint: "Good at most tasks",
    className: "text-sky-700 dark:text-sky-400",
  },
  powerful: {
    label: "Powerful",
    hint: "Most capable; uses the most of your month",
    className: "text-violet-700 dark:text-violet-400",
  },
};

const hintOf = (m: AgentModel) =>
  m.category && CATEGORY[m.category]
    ? `${m.description} · ${CATEGORY[m.category].hint}`
    : m.description;

const SETTINGS_URL = "https://github.com/settings/copilot/features";
const PLANS_URL = "https://github.com/features/copilot/plans";

/** "free_educational_quota" → "Education"; the plan's name otherwise. */
function planName(sku: string | null, plan: string | null): string {
  if (sku?.includes("educational")) return "Education";
  if (sku?.includes("free")) return "Free";
  if (plan === "individual") return "Pro";
  return plan ? plan[0].toUpperCase() + plan.slice(1) : "Copilot";
}

const resetDay = (at: number) =>
  new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

/**
 * Copilot's models as its own pickers show them: the plan and what's left
 * of its month on top, the models it can use, then the ones it can't (and
 * how to get them).
 */
export function CopilotModels({
  models,
  selected,
  onSelect,
}: {
  models: AgentModel[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const quota = useAiUsage((s) => s.copilotQuota);
  const [showOthers, setShowOthers] = useState(false);
  useEffect(() => {
    void invoke("copilot_quota")
      .then((raw) => {
        const q = copilotQuotaFrom(raw);
        if (q) useAiUsage.getState().setCopilotQuota(q);
      })
      .catch(() => {});
  }, []);

  const current = selected || "auto";
  const usable = models.filter((m) => !m.status || m.status === "available");
  const others = models.filter((m) => m.status && m.status !== "available");

  return (
    <>
      {quota && (
        <div className="px-3 pb-1.5 text-muted-foreground text-xs">
          {planName(quota.sku, quota.plan)} plan
          {quota.unlimited
            ? " · unlimited"
            : ` · ${quota.remaining} of ${quota.entitlement} premium requests left`}
          {quota.resetsAt ? ` · resets ${resetDay(quota.resetsAt)}` : ""}
        </div>
      )}
      {usable.map((m) => (
        <button
          key={m.id}
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
            current === m.id
              ? "bg-accent text-accent-foreground"
              : "hover:bg-muted",
          )}
          onClick={() => onSelect(m.id === "auto" ? "" : m.id)}
          title={hintOf(m)}
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium text-xs">{m.name}</div>
            <div className="truncate text-muted-foreground text-xs">
              {m.description}
            </div>
          </div>
          {m.category && CATEGORY[m.category] && (
            <span className={cn("text-[10px]", CATEGORY[m.category].className)}>
              {CATEGORY[m.category].label}
            </span>
          )}
          {current === m.id && <CheckIcon className="size-3 shrink-0" />}
        </button>
      ))}
      {models.length === 0 && (
        <div className="px-3 py-1.5 text-muted-foreground text-xs">
          Loading models…
        </div>
      )}
      {others.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="flex w-full items-center gap-1 px-3 pt-2 pb-1 text-muted-foreground text-xs hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                "size-3 transition-transform",
                showOthers && "rotate-90",
              )}
            />
            Not in your plan ({others.length})
          </button>
          {showOthers &&
            others.map((m) => (
              <div
                key={m.id}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs"
                title={hintOf(m)}
              >
                <div className="min-w-0 flex-1 text-muted-foreground">
                  <span>{m.name}</span>
                  {m.category && CATEGORY[m.category] && (
                    <span className="ml-1.5 text-[10px] opacity-70">
                      {CATEGORY[m.category].label}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void shellOpen(
                      m.status === "enable" ? SETTINGS_URL : PLANS_URL,
                    )
                  }
                  className="shrink-0 text-primary hover:underline"
                >
                  {m.status === "enable" ? "Turn on" : "Upgrade"}
                </button>
              </div>
            ))}
        </>
      )}
      <div className="px-3 pt-1.5 pb-1 text-[11px] text-muted-foreground/80">
        Lighter models use less of your month.
      </div>
    </>
  );
}
