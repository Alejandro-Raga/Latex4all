import { describe, expect, it } from "vitest";
import { useSettingsStore } from "./settings-store";

const rehydrate = async (saved: object) => {
  localStorage.setItem(
    "latex4all-settings",
    JSON.stringify({ state: saved, version: 0 }),
  );
  await useSettingsStore.persist.rehydrate();
  return useSettingsStore.getState();
};

describe("Vim keys", () => {
  it("are off after updating if they were on from before", async () => {
    expect((await rehydrate({ vimMode: true })).vimMode).toBe(false);
  });

  it("stay on once chosen in Settings", async () => {
    useSettingsStore.getState().setVimMode(true);
    const saved = JSON.parse(
      localStorage.getItem("latex4all-settings") ?? "{}",
    );
    expect((await rehydrate(saved.state)).vimMode).toBe(true);
    useSettingsStore.getState().setVimMode(false);
  });
});
