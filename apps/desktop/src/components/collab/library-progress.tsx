import { useLibraryStore } from "@/stores/library-store";

/** A thin bar while your devices sync: how many projects are done. */
export function LibraryProgress() {
  const progress = useLibraryStore((s) => s.progress);
  if (!progress || progress.total === 0) return null;
  const share = Math.max(0.04, progress.done / progress.total);
  return (
    <div
      className="space-y-1"
      role="progressbar"
      aria-label="Syncing with your devices"
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.done}
    >
      <div className="flex justify-between gap-2 text-muted-foreground text-xs">
        <span className="truncate">Syncing {progress.name}</span>
        <span className="shrink-0 tabular-nums">
          {progress.done + 1} of {progress.total}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}
