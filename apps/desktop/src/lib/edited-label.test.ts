import { describe, expect, it } from "vitest";
import { editedLabel } from "./edited-label";

const now = new Date(2026, 10, 4, 15, 0).getTime();
const ago = (ms: number) => editedLabel(now - ms, now);

describe("when a project was last edited", () => {
  it("in minutes and hours today", () => {
    expect(ago(20_000)).toBe("Edited just now");
    expect(ago(5 * 60_000)).toBe("Edited 5 min ago");
    expect(ago(2 * 3_600_000)).toBe("Edited 2 h ago");
  });

  it("in days, then as a date", () => {
    expect(editedLabel(new Date(2026, 10, 3, 9, 0).getTime(), now)).toBe(
      "Edited yesterday",
    );
    expect(editedLabel(new Date(2026, 10, 1, 9, 0).getTime(), now)).toBe(
      "Edited 3 days ago",
    );
    expect(editedLabel(new Date(2026, 2, 12).getTime(), now)).toMatch(
      /^Edited .*12/,
    );
    expect(editedLabel(new Date(2025, 2, 12).getTime(), now)).toMatch(/2025/);
  });

  it("says nothing when it isn't known", () => {
    expect(editedLabel(null, now)).toBe("");
  });
});
