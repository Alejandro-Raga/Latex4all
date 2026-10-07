import { describe, expect, it } from "vitest";
import { isLockedFileError, whileLocked } from "@/lib/tauri/fs";

describe("a file another program has open", () => {
  it("is recognised as Windows reports it", () => {
    expect(
      isLockedFileError(
        new Error(
          "The process cannot access the file because it is being used by another process. (os error 32)",
        ),
      ),
    ).toBe(true);
    expect(isLockedFileError("Access is denied. (os error 5)")).toBe(true);
    expect(isLockedFileError("No such file or directory (os error 2)")).toBe(
      false,
    );
  });

  it("is tried again until it's free, and other errors aren't", async () => {
    let tries = 0;
    const result = await whileLocked(async () => {
      tries++;
      if (tries < 3) throw new Error("(os error 32)");
      return "written";
    }, [1, 1, 1]);
    expect([result, tries]).toEqual(["written", 3]);

    let other = 0;
    await expect(
      whileLocked(async () => {
        other++;
        throw new Error("disk full");
      }, [1, 1]),
    ).rejects.toThrow("disk full");
    expect(other).toBe(1);
  });
});
