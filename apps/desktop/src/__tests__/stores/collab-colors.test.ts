import { describe, expect, it } from "vitest";
import { colorOf, useCollabStore } from "@/stores/collab-store";

describe("people's colors", () => {
  it("draws your own notes and messages in the color you use now", () => {
    useCollabStore.setState({ displayName: "Ana", color: "#2563eb" });
    expect(colorOf("Ana", "#e11d48")).toBe("#2563eb");
    useCollabStore.getState().setColor("#16a34a");
    expect(colorOf("Ana", "#e11d48")).toBe("#16a34a");
    // Someone this device knows nothing about keeps what they wrote with.
    expect(colorOf("Ben", "#d97706")).toBe("#d97706");
  });

  it("goes by the name notes are signed with when there isn't one", () => {
    useCollabStore.setState({ displayName: "  ", color: "#7c3aed" });
    expect(colorOf("Me", "#e11d48")).toBe("#7c3aed");
  });
});
