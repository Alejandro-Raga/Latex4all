import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { useBack } from "@/stores/back-store";

/** "← Back to Planner", after a link took you elsewhere. */
export function BackPill() {
  const back = useBack((s) => s.back);
  // Not forever: after a few minutes it's no longer "back".
  useEffect(() => {
    if (!back) return;
    const timer = setTimeout(() => useBack.getState().clear(), 5 * 60_000);
    return () => clearTimeout(timer);
  }, [back]);
  if (!back) return null;
  return (
    <div className="glass fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center rounded-full border shadow-lg">
      <button
        type="button"
        onClick={() => {
          useBack.getState().clear();
          back.go();
        }}
        className="flex items-center gap-1.5 rounded-l-full py-1.5 pr-2 pl-3 font-medium text-sm hover:bg-muted/60"
      >
        <ArrowLeftIcon className="size-4" />
        {back.label}
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => useBack.getState().clear()}
        className="rounded-r-full py-1.5 pr-2.5 pl-1 text-muted-foreground hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
