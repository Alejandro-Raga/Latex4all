import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { useUpdaterStore } from "./updater-store";

describe("the update prompt", () => {
  it("comes back when the user checks after closing it", async () => {
    vi.mocked(invoke).mockResolvedValue({
      version: "1.2.110",
      currentVersion: "1.2.100",
      notes: null,
      date: null,
      isDowngrade: false,
    });
    await useUpdaterStore.getState().check("test");
    useUpdaterStore.getState().dismissPrompt();
    expect(useUpdaterStore.getState().promptDismissed).toBe(true);
    // Still known: Settings shows it.
    expect(useUpdaterStore.getState().status.state).toBe("available");
    await useUpdaterStore.getState().checkRequested("test");
    expect(useUpdaterStore.getState().promptDismissed).toBe(false);
    expect(useUpdaterStore.getState().status.state).toBe("available");
  });
});
