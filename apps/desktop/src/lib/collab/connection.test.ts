import { afterEach, describe, expect, it, vi } from "vitest";

const { health, toast } = vi.hoisted(() => ({
  health: vi.fn(),
  toast: { warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => (cmd === "collab_health" ? health() : null),
}));
vi.mock("sonner", () => ({ toast }));

import { diagnostics, useConnection } from "./connection";

const LINK =
  "https://collab.example.com/p/0123456789abcdef0123456789abcdef#SECRETKEY";
const up = { ok: true, status: 200, ms: 40, error: null };
const down = { ok: false, status: null, ms: 8000, error: "timed out" };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the shared project's connection", () => {
  it("keeps track of its state, reconnects and what's unsent", () => {
    const c = useConnection.getState();
    c.reset(LINK);
    c.record({ type: "status", state: "online" });
    c.record({ type: "ack", seq: 4, pending: 2 });
    c.record({
      type: "status",
      state: "offline",
      reason: "the connection broke",
    });
    c.record({ type: "status", state: "connecting" });
    c.record({ type: "status", state: "online" });
    const s = useConnection.getState();
    expect(s).toMatchObject({
      state: "online",
      reconnects: 1,
      pending: 2,
      lastReason: "the connection broke",
    });
    expect(s.log.map((l) => l.text)).toEqual([
      "opened",
      "online",
      "offline: the connection broke",
      "connecting",
      "online",
    ]);
  });

  it("says once when the service is down, not the internet, and when it's back", async () => {
    vi.useFakeTimers();
    health.mockResolvedValue({ relay: down, internet: up });
    const c = useConnection.getState();
    c.reset(LINK);
    c.record({ type: "status", state: "offline", reason: "couldn't connect" });
    c.record({ type: "status", state: "connecting" });
    c.record({ type: "status", state: "offline", reason: "couldn't connect" });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe(
      "The sync service isn't answering",
    );
    expect(useConnection.getState().outage).toBe("service");

    c.record({ type: "status", state: "online" });
    expect(toast.success).toHaveBeenCalledWith(
      "Back online",
      expect.anything(),
    );
  });

  it("tells a dead internet connection apart", async () => {
    vi.useFakeTimers();
    health.mockResolvedValue({ relay: down, internet: down });
    const c = useConnection.getState();
    c.reset(LINK);
    c.record({ type: "status", state: "offline" });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(toast.warning.mock.calls[0][0]).toBe("You're offline");
  });

  it("reports without the project's key", () => {
    useConnection.getState().reset(LINK);
    const report = diagnostics("1.2.83");
    expect(report).toContain("Latex4All 1.2.83");
    expect(report).toContain("Relay collab.example.com · project 01234567…");
    expect(report).not.toContain("SECRETKEY");
    expect(report).not.toContain("0123456789abcdef0123456789abcdef");
  });
});
