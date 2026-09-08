import { useMemo } from "react";
import { Progress } from "@/components/ui/progress";

const PHASE_MAP: Record<string, number> = {
  "Preparing installer": 0,
  "Checking directory permissions...": 5,
  "Directory permissions OK": 10,
  "Git available": 15,
  "cloning repository": 20,
  "Downloading skills": 20,
  "downloading tarball": 20,
  "Download complete": 60,
  "Extracting skills": 62,
  "Copying skills": 70,
  Copied: 90,
  "Cleanup complete": 95,
};

/** The archive is ~230 MB, so the download owns most of the wall clock; give
 * it the widest band of the bar. */
const DOWNLOAD_START_PCT = 20;
const DOWNLOAD_END_PCT = 60;

/** Matches "Downloaded 45.2 MB of 230.1 MB (19%) — 1.4 MB/s" — the shape
 * `download_progress_message` in skills.rs emits while bytes are arriving. */
const DOWNLOAD_SHARE_RE =
  /^Downloaded\s+[\d.]+\s*MB\s+of\s+[\d.]+\s*MB\s+\((\d+)%\)/i;
/** Matches "Downloaded 45.2 MB — 1.4 MB/s", used when the server sends no
 * Content-Length and there is no share to report. */
const DOWNLOAD_BYTES_RE = /^Downloaded\s+([\d.]+)\s*MB/i;
/** The pre-existing "Downloaded 45 MiB" wording, still emitted by older
 * builds a user may be upgrading from. */
const DOWNLOAD_LEGACY_RE = /^Downloaded\s+(\d+)\s+MiB/i;

export function pctFromLog(log: string): number | null {
  const legacyPercent = log.match(/^Download progress\s+(\d+)%/i);
  if (legacyPercent?.[1]) {
    return scaleDownload(Number(legacyPercent[1]));
  }

  const share = log.match(DOWNLOAD_SHARE_RE);
  if (share?.[1]) {
    return scaleDownload(Number(share[1]));
  }

  // No total to divide by: creep toward the middle of the download band on
  // megabytes seen, so the bar still moves without ever claiming to be done.
  const bytes = log.match(DOWNLOAD_BYTES_RE) ?? log.match(DOWNLOAD_LEGACY_RE);
  if (bytes?.[1]) {
    const megabytes = Math.max(0, Number(bytes[1]));
    if (Number.isFinite(megabytes)) {
      return Math.min(
        DOWNLOAD_END_PCT - 5,
        DOWNLOAD_START_PCT + Math.round(megabytes / 8),
      );
    }
  }

  for (const [key, pct] of Object.entries(PHASE_MAP)) {
    if (log.toLowerCase().includes(key.toLowerCase())) return pct;
  }
  return null;
}

function scaleDownload(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return Math.round(
    DOWNLOAD_START_PCT +
      (clamped * (DOWNLOAD_END_PCT - DOWNLOAD_START_PCT)) / 100,
  );
}

interface InstallProgressProps {
  isInstalling: boolean;
  isComplete: boolean;
  error: string | null;
  logs: string[];
}

export function InstallProgress({
  isComplete,
  error,
  logs,
}: InstallProgressProps) {
  const pct = useMemo(() => {
    if (isComplete) return 100;
    return logs.reduce((current, line) => {
      const next = pctFromLog(line);
      return next === null ? current : Math.max(current, next);
    }, 0);
  }, [isComplete, logs]);

  const label = isComplete
    ? "Done"
    : error
      ? "Error"
      : logs.length > 0
        ? logs[logs.length - 1]
        : "Starting...";

  return (
    <div className="space-y-2 py-1">
      <Progress value={pct} />
      <div className="flex items-center justify-between">
        <p className="max-w-[80%] truncate text-muted-foreground text-xs">
          {label}
        </p>
        <p className="font-mono text-muted-foreground text-xs tabular-nums">
          {pct}%
        </p>
      </div>
    </div>
  );
}
