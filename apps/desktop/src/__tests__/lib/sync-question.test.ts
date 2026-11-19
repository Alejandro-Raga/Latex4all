import { beforeEach, describe, expect, it } from "vitest";
import {
  needsStorageQuestion,
  storageQuestionAnswered,
  type SyncSettings,
} from "@/lib/tauri/sync-settings";

const base: SyncSettings = {
  enabled: true,
  storage: "",
  folder: null,
  hubCode: null,
  hubbed: [],
  chosen: false,
};

describe("the storage question", () => {
  beforeEach(() => localStorage.clear());
  it("is asked once, and not again even if the settings lose the answer", () => {
    expect(needsStorageQuestion(base)).toBe(true);
    storageQuestionAnswered();
    expect(needsStorageQuestion(base)).toBe(false);
  });
  it("counts a storage already chosen as an answer", () => {
    expect(needsStorageQuestion({ ...base, storage: "server" })).toBe(false);
    expect(needsStorageQuestion({ ...base, chosen: true })).toBe(false);
    expect(needsStorageQuestion({ ...base, enabled: false })).toBe(false);
  });
});
