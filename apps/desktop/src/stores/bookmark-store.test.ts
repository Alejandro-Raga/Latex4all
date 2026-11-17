import { beforeEach, describe, expect, it } from "vitest";
import { useBookmarkStore } from "./bookmark-store";

describe("pages read", () => {
  beforeEach(() =>
    useBookmarkStore.setState({ places: {}, recent: [], pagesByDay: {} }),
  );

  it("count new pages reached, not going back, nor a jump to the end", () => {
    const { setLast } = useBookmarkStore.getState();
    setLast("P", 3); // where reading starts
    setLast("P", 7);
    setLast("P", 5); // back: nothing
    setLast("P", 9);
    setLast("P", 200); // a jump: 30 at most
    const days = Object.values(useBookmarkStore.getState().pagesByDay);
    expect(days).toEqual([4 + 2 + 30]);
  });
});
