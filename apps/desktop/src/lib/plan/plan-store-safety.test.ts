import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  exists: vi.fn(async () => true),
  readTextFile: vi.fn(async (_p: string) => ""),
  writeTextFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/appdata",
  join: async (...p: string[]) => p.join("/"),
}));

import { usePlanStore } from "./plan-store";

const KEY = "project:/p/Thesis";

describe("plans kept safe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlanStore.setState({ entries: {} });
  });

  it("leaves a plan it couldn't read unknown, never empty", async () => {
    fs.exists.mockResolvedValue(true);
    fs.readTextFile.mockRejectedValue(new Error("locked by the sync app"));
    await usePlanStore.getState().load(KEY);
    // Unknown (undefined), not "no plan" (null): nothing starts it afresh.
    expect(usePlanStore.getState().entries[KEY]).toBeUndefined();
  });

  it("takes a missing plan for none", async () => {
    fs.exists.mockResolvedValue(false);
    await usePlanStore.getState().load(KEY);
    expect(usePlanStore.getState().entries[KEY]).toEqual({ text: null });
  });

  it("doesn't let a slow read put back older text over a newer edit", async () => {
    let finishRead!: (text: string) => void;
    fs.exists.mockResolvedValue(true);
    fs.readTextFile.mockImplementationOnce(
      () => new Promise<string>((r) => (finishRead = r)),
    );
    const reading = usePlanStore.getState().load(KEY);
    await Promise.resolve();
    await Promise.resolve();
    await usePlanStore.getState().write(KEY, "- [ ] New task\\n");
    finishRead("- [ ] Old text\\n");
    await reading;
    expect(usePlanStore.getState().entries[KEY]?.text).toBe(
      "- [ ] New task\\n",
    );
  });
});
