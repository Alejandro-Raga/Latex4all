import { describe, expect, it } from "vitest";
import { usageWarnings, warningForError } from "@/lib/collab/sync-warnings";

const MB = 1024 * 1024;

describe("sync warnings", () => {
  it("warn as a project fills up, and when it's full", () => {
    const usage = (used: number) =>
      usageWarnings({
        projectBytes: used * MB,
        maxProjectBytes: 100 * MB,
        relayNearlyFull: false,
      }).map((w) => [w.id, w.level]);
    expect(usage(50)).toEqual([]);
    expect(usage(85)).toEqual([["nearly-full", "warning"]]);
    expect(usage(100)).toEqual([["full", "error"]]);
    expect(
      usageWarnings({
        projectBytes: 0,
        maxProjectBytes: 100 * MB,
        relayNearlyFull: true,
      }).map((w) => w.id),
    ).toEqual(["relay-full"]);
  });

  it("word the relay's errors and per-file failures for people", () => {
    expect(warningForError("quota")?.id).toBe("full");
    expect(warningForError("outdated")?.level).toBe("error");
    expect(warningForError("corrupt")).toBeNull();
    expect(warningForError("chat-quota")).toBeNull();

    expect(
      warningForError("Couldn't share figures/big.pdf: too-large"),
    ).toEqual({
      id: "too-large:figures/big.pdf",
      level: "warning",
      text: "figures/big.pdf is over 25 MB, so it isn't shared.",
    });
    expect(warningForError("Couldn't share plot.png: quota")?.id).toBe("full");
    expect(
      warningForError("Couldn't download plot.png: Couldn't reach the relay")
        ?.id,
    ).toBe("get:plot.png");
  });
});
