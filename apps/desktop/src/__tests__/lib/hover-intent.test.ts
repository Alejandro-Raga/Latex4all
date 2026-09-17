import { afterEach, describe, expect, it, vi } from "vitest";
import { HoverIntent } from "@/lib/annotations/hover-intent";

afterEach(() => {
  vi.useRealTimers();
});

function setup(pinned = { value: false }) {
  vi.useFakeTimers();
  const events: string[] = [];
  const intent = new HoverIntent({
    openDelay: 350,
    closeDelay: 200,
    onOpen: (id) => events.push(`open ${id}`),
    onClose: () => events.push("close"),
    isPinned: () => pinned.value,
  });
  return { intent, events };
}

describe("hovering highlights", () => {
  it("opens while the pointer keeps moving across the same highlight", () => {
    const { intent, events } = setup();
    for (let t = 0; t < 400; t += 50) {
      intent.over("a"); // a mouse move every 50 ms
      vi.advanceTimersByTime(50);
    }
    expect(events).toEqual(["open a"]);
  });

  it("starts over when moving to another highlight, and closes after leaving", () => {
    const { intent, events } = setup();
    intent.over("a");
    vi.advanceTimersByTime(300);
    intent.over("b");
    vi.advanceTimersByTime(300);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(events).toEqual(["open b"]);

    intent.over(null);
    vi.advanceTimersByTime(199);
    expect(events).toEqual(["open b"]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["open b", "close"]);
  });

  it("stays open over the card, and while it's being typed in", () => {
    const pinned = { value: false };
    const { intent, events } = setup(pinned);
    intent.over("a");
    vi.advanceTimersByTime(350);
    intent.over(null);
    intent.enterCard();
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(["open a"]);

    pinned.value = true;
    intent.leaveCard();
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(["open a"]);
  });
});
