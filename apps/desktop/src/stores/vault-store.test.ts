import { beforeEach, describe, expect, it } from "vitest";
import { useVaultStore } from "./vault-store";

const nav = () => {
  const { current, history, forward } = useVaultStore.getState();
  return { current, history, forward };
};

describe("vault navigation", () => {
  beforeEach(() => {
    useVaultStore.setState({
      current: null,
      history: [],
      forward: [],
      unsavedEdit: null,
    });
  });

  it("goes back to the list of notes, not just the previous note", () => {
    const { open, back } = useVaultStore.getState();
    open("A");
    open("B");
    open("C");
    back();
    back();
    back();
    expect(nav().current).toBeNull();
  });

  it("gets to the list in one step from deep in a trail, and back again", () => {
    const { open, showList, back } = useVaultStore.getState();
    open("A");
    open("B");
    showList();
    expect(nav().current).toBeNull();
    back();
    expect(nav().current).toBe("B");
  });

  it("goes forward again after going back, until something new is opened", () => {
    const { open, back, goForward } = useVaultStore.getState();
    open("A");
    open("B");
    back();
    expect(nav()).toMatchObject({ current: "A", forward: ["B"] });
    goForward();
    expect(nav()).toMatchObject({ current: "B", forward: [] });
    back();
    open("C");
    expect(nav().forward).toEqual([]);
  });
});
