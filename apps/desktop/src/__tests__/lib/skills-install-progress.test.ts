import { describe, expect, it } from "vitest";
import { pctFromLog } from "@/components/scientific-skills/install-progress";

describe("pctFromLog", () => {
  it("tracks the download share the installer reports", () => {
    // Format emitted by download_progress_message in src-tauri/src/skills.rs.
    expect(pctFromLog("Downloaded 0.0 MB of 230.1 MB (0%) — 0.0 MB/s")).toBe(
      20,
    );
    expect(pctFromLog("Downloaded 115.0 MB of 230.1 MB (50%) — 1.4 MB/s")).toBe(
      40,
    );
    expect(
      pctFromLog("Downloaded 230.1 MB of 230.1 MB (100%) — 1.4 MB/s"),
    ).toBe(60);
  });

  it("still advances when the server sends no Content-Length", () => {
    const early = pctFromLog("Downloaded 8.0 MB — 1.1 MB/s");
    const later = pctFromLog("Downloaded 96.0 MB — 1.1 MB/s");
    expect(early).toBeGreaterThanOrEqual(20);
    expect(later).toBeGreaterThan(early ?? 0);
    // Never claims the download finished on megabytes alone.
    expect(pctFromLog("Downloaded 4000.0 MB — 1.1 MB/s")).toBeLessThan(60);
  });

  it("understands the wording older builds emit", () => {
    expect(pctFromLog("Download progress 50%")).toBe(40);
    expect(pctFromLog("Downloaded 16 MiB")).toBeGreaterThan(20);
  });

  it("recognises the phases either side of the download", () => {
    expect(pctFromLog("Downloading skills...")).toBe(20);
    expect(pctFromLog("Download complete")).toBe(60);
    expect(pctFromLog("Extracting skills...")).toBe(62);
    expect(pctFromLog("Copying skills...")).toBe(70);
    expect(pctFromLog("Copied 214 skills")).toBe(90);
    expect(pctFromLog("Cleanup complete")).toBe(95);
  });

  it("ignores lines that say nothing about progress", () => {
    expect(pctFromLog("Using system proxy settings when available")).toBeNull();
    expect(pctFromLog("Retrying in 2 seconds...")).toBeNull();
  });

  it("never goes backwards across a real install's log", () => {
    const log = [
      "Checking directory permissions...",
      "Directory permissions OK",
      "Downloading skills...",
      "Download attempt 1/3 (GitHub codeload)",
      "Downloaded 23.0 MB of 230.1 MB (10%) — 1.2 MB/s",
      "Downloaded 138.1 MB of 230.1 MB (60%) — 1.2 MB/s",
      "Downloaded 230.1 MB in 3m 12s",
      "Extracting skills...",
      "Download complete",
      "Copying skills...",
      "Copied 214 skills",
      "Cleanup complete",
    ];
    const seen = log
      .map(pctFromLog)
      .filter((pct): pct is number => pct !== null);
    const monotonic = seen.map((pct, i) => Math.max(pct, ...seen.slice(0, i)));
    expect(monotonic).toEqual([...monotonic].sort((a, b) => a - b));
    expect(monotonic[monotonic.length - 1]).toBe(95);
  });
});
