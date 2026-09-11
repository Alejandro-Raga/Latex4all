import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUpdaterStore } from "@/stores/updater-store";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

function reset() {
  useUpdaterStore.setState({
    status: { state: "idle" },
    launchCheckDone: false,
  });
}

describe("updater store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
    // Default: event listeners register and unregister cleanly.
    mockListen.mockResolvedValue(vi.fn());
  });

  describe("check", () => {
    it("reports up-to-date when the backend returns no update", async () => {
      mockInvoke.mockResolvedValue(null);

      await useUpdaterStore.getState().check("release");

      expect(useUpdaterStore.getState().status).toEqual({
        state: "up-to-date",
      });
    });

    it("passes the selected channel through to the backend", async () => {
      mockInvoke.mockResolvedValue(null);

      await useUpdaterStore.getState().check("test");

      expect(mockInvoke).toHaveBeenCalledWith("updater_check", {
        channel: "test",
        allowDowngrade: false,
      });
    });

    it("surfaces an available update with its version and notes", async () => {
      mockInvoke.mockResolvedValue({
        version: "1.3.57",
        currentVersion: "1.3.0",
        notes: "Fixes the thing",
        date: null,
        isDowngrade: false,
      });

      await useUpdaterStore.getState().check("test");

      expect(useUpdaterStore.getState().status).toEqual({
        state: "available",
        version: "1.3.57",
        notes: "Fixes the thing",
        isDowngrade: false,
      });
    });

    it("normalises a null note to undefined rather than rendering 'null'", async () => {
      mockInvoke.mockResolvedValue({
        version: "1.4.0",
        currentVersion: "1.3.0",
        notes: null,
        date: null,
        isDowngrade: false,
      });

      await useUpdaterStore.getState().check("release");

      expect(useUpdaterStore.getState().status).toEqual({
        state: "available",
        version: "1.4.0",
        notes: undefined,
        isDowngrade: false,
      });
    });

    it("does not allow a downgrade unless asked", async () => {
      // The launch check goes through this path. A rollback must never be
      // something the app decides to do on its own.
      mockInvoke.mockResolvedValue(null);

      await useUpdaterStore.getState().check("release");

      expect(mockInvoke).toHaveBeenCalledWith("updater_check", {
        channel: "release",
        allowDowngrade: false,
      });
    });

    it("asks for a downgrade when one is requested", async () => {
      mockInvoke.mockResolvedValue(null);

      await useUpdaterStore.getState().check("release", true);

      expect(mockInvoke).toHaveBeenCalledWith("updater_check", {
        channel: "release",
        allowDowngrade: true,
      });
    });

    it("surfaces an older build as a downgrade", async () => {
      // Leaving the test channel: the release is numbered below the test build
      // the user is running, and the UI has to say so rather than call it an
      // update.
      mockInvoke.mockResolvedValue({
        version: "1.1.0",
        currentVersion: "1.0.20",
        notes: "Stable release",
        date: null,
        isDowngrade: true,
      });

      await useUpdaterStore.getState().check("release", true);

      expect(useUpdaterStore.getState().status).toEqual({
        state: "available",
        version: "1.1.0",
        notes: "Stable release",
        isDowngrade: true,
      });
    });

    it("records a failed check as an error instead of leaving it checking", async () => {
      mockInvoke.mockRejectedValue(new Error("network down"));

      await useUpdaterStore.getState().check("release");

      const status = useUpdaterStore.getState().status;
      expect(status.state).toBe("error");
      expect(status).toHaveProperty(
        "message",
        expect.stringContaining("network down"),
      );
    });

    it("ignores a second check while one is already in flight", async () => {
      useUpdaterStore.setState({ status: { state: "checking" } });

      await useUpdaterStore.getState().check("release");

      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("checkRequested", () => {
    it("reports the release as a rollback when the machine is ahead of it", async () => {
      // The situation this exists for: running test build 1.1.22, switched to
      // the release channel, where 1.1.1 is the newest. The first check finds
      // nothing because 1.1.1 is the lower number.
      mockInvoke.mockResolvedValueOnce(null).mockResolvedValueOnce({
        version: "1.1.1",
        currentVersion: "1.1.22",
        notes: "Stable release",
        date: null,
        isDowngrade: true,
      });

      await useUpdaterStore.getState().checkRequested("release");

      expect(useUpdaterStore.getState().status).toEqual({
        state: "available",
        version: "1.1.1",
        notes: "Stable release",
        isDowngrade: true,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "updater_check", {
        channel: "release",
        allowDowngrade: false,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "updater_check", {
        channel: "release",
        allowDowngrade: true,
      });
    });

    it("stays up-to-date when the machine really is current", async () => {
      mockInvoke.mockResolvedValue(null);

      await useUpdaterStore.getState().checkRequested("release");

      expect(useUpdaterStore.getState().status).toEqual({
        state: "up-to-date",
      });
    });

    it("does not second-guess a normal update into a rollback offer", async () => {
      mockInvoke.mockResolvedValue({
        version: "1.2.0",
        currentVersion: "1.1.1",
        notes: null,
        date: null,
        isDowngrade: false,
      });

      await useUpdaterStore.getState().checkRequested("release");

      // One call only: the follow-up is for an empty result, not any result.
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(useUpdaterStore.getState().status).toMatchObject({
        state: "available",
        version: "1.2.0",
      });
    });

    it("leaves the test channel alone", async () => {
      // A test build below the tip is an ordinary update there, and nothing
      // about that channel can strand a machine above it.
      mockInvoke.mockResolvedValue(null);

      await useUpdaterStore.getState().checkRequested("test");

      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  describe("install", () => {
    it("ends in the ready state so the UI can offer a restart", async () => {
      mockInvoke.mockResolvedValue(undefined);

      await useUpdaterStore.getState().install("release");

      expect(mockInvoke).toHaveBeenCalledWith("updater_install", {
        channel: "release",
      });
    });

    it("does not decide for itself what may be installed", async () => {
      // The check decides what to offer; install takes whatever the channel is
      // serving, because the user has already been shown it and asked for it.
      // Deciding twice is what made an accepted rollback fail at the last step.
      mockInvoke.mockResolvedValue(undefined);

      await useUpdaterStore.getState().install("release");

      expect(mockInvoke).toHaveBeenCalledWith("updater_install", {
        channel: "release",
      });
      expect(useUpdaterStore.getState().status).toEqual({ state: "ready" });
    });

    it("reports install failure rather than claiming the update succeeded", async () => {
      mockInvoke.mockRejectedValue(new Error("signature mismatch"));

      await useUpdaterStore.getState().install("release");

      const status = useUpdaterStore.getState().status;
      expect(status.state).toBe("error");
      expect(status).toHaveProperty(
        "message",
        expect.stringContaining("signature mismatch"),
      );
    });

    it("detaches both event listeners even when the install fails", async () => {
      const unlistenProgress = vi.fn();
      const unlistenFinished = vi.fn();
      mockListen
        .mockResolvedValueOnce(unlistenProgress)
        .mockResolvedValueOnce(unlistenFinished);
      mockInvoke.mockRejectedValue(new Error("boom"));

      await useUpdaterStore.getState().install("test");

      // Leaking these would stack a new pair of listeners on every retry.
      expect(unlistenProgress).toHaveBeenCalled();
      expect(unlistenFinished).toHaveBeenCalled();
    });

    it("converts download progress events into a percentage", async () => {
      let onProgress: ((e: { payload: unknown }) => void) | undefined;
      mockListen.mockImplementation(async (event, handler) => {
        if (event === "updater://progress") {
          onProgress = handler as (e: { payload: unknown }) => void;
        }
        return () => {};
      });
      // Hold the install open so progress can be observed mid-flight. The
      // gate is built before the call so `release` is never undefined at the
      // point the test tries to use it.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mockInvoke.mockImplementation(() => gate);

      const pending = useUpdaterStore.getState().install("test");
      await vi.waitFor(() => expect(onProgress).toBeDefined());

      onProgress?.({ payload: { downloaded: 25, total: 100 } });
      expect(useUpdaterStore.getState().status).toEqual({
        state: "downloading",
        percent: 25,
      });

      release();
      await pending;
    });

    it("does not divide by a missing content length", async () => {
      let onProgress: ((e: { payload: unknown }) => void) | undefined;
      mockListen.mockImplementation(async (event, handler) => {
        if (event === "updater://progress") {
          onProgress = handler as (e: { payload: unknown }) => void;
        }
        return () => {};
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mockInvoke.mockImplementation(() => gate);

      const pending = useUpdaterStore.getState().install("test");
      await vi.waitFor(() => expect(onProgress).toBeDefined());

      // A server that sends no Content-Length must not produce NaN%.
      onProgress?.({ payload: { downloaded: 25, total: null } });
      expect(useUpdaterStore.getState().status).toEqual({
        state: "downloading",
        percent: 0,
      });

      release();
      await pending;
    });
  });
});
