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

describe("the same person on another computer", () => {
  it("takes the color the project has for their name, unless they pick one", async () => {
    const { settleColor } = await import("@/stores/collab-store");
    // Opening a project where this name already has a color: take it.
    expect(settleColor("#2563eb", "#e11d48", false)).toEqual({
      use: "#2563eb",
      record: false,
    });
    // Picking a color: it's the name's from now on, everywhere.
    expect(settleColor("#2563eb", "#e11d48", true)).toEqual({
      use: "#e11d48",
      record: true,
    });
    // A name the project doesn't know yet gets this computer's color.
    expect(settleColor(undefined, "#e11d48", false)).toEqual({
      use: "#e11d48",
      record: true,
    });
    // Nothing odd from the document ends up as your color.
    expect(settleColor("url(x)", "#e11d48", false).use).toBe("#e11d48");
  });
});
