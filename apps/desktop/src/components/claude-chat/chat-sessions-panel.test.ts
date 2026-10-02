import { describe, expect, it } from "vitest";
import { dayGroup } from "./chat-sessions-panel";

describe("chat history groups", () => {
  const now = new Date(2026, 9, 2, 15, 0);
  const at = (d: Date) => d.getTime() / 1000;
  it("sorts chats into days", () => {
    expect(dayGroup(at(new Date(2026, 9, 2, 9, 0)), now)).toBe("Today");
    expect(dayGroup(at(new Date(2026, 9, 1, 23, 0)), now)).toBe("Yesterday");
    expect(dayGroup(at(new Date(2026, 8, 28, 12, 0)), now)).toBe(
      "Previous 7 days",
    );
    expect(dayGroup(at(new Date(2026, 7, 1, 12, 0)), now)).toBe("Older");
  });
});
