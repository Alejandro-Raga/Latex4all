import { describe, expect, it } from "vitest";
import {
  type ChatMessage,
  decodeChat,
  encodeChat,
  withMessage,
} from "@/lib/collab/chat";

const payload = {
  id: "a1",
  author: "Ana",
  color: "#e11d48",
  text: "Figure 3 is ready",
};

function message(id: string, seq: number | null): ChatMessage {
  return { ...payload, id, seq, at: 0 };
}

describe("chat messages", () => {
  it("round-trip, and anything odd from others is cleaned or dropped", () => {
    expect(decodeChat(encodeChat(payload))).toEqual(payload);
    const encode = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value));
    // Only a plain color reaches a style attribute.
    expect(
      decodeChat(encode({ ...payload, color: "red;background:url(x)" }))?.color,
    ).toBe("#888888");
    // Only raster images, as base64.
    const svg = {
      type: "image/svg+xml",
      data: "PHN2Zz4=",
      width: 1,
      height: 1,
    };
    expect(
      decodeChat(encode({ ...payload, image: svg }))?.image,
    ).toBeUndefined();
    expect(decodeChat(encode({ ...payload, text: "", image: svg }))).toBeNull();
    expect(decodeChat(encode({ id: 1 }))).toBeNull();
    expect(decodeChat(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("are kept in the relay's order, with unsent ones last", () => {
    let list: ChatMessage[] = [];
    list = withMessage(list, message("mine", null));
    list = withMessage(list, message("b", 2));
    list = withMessage(list, message("a", 1));
    expect(list.map((m) => m.id)).toEqual(["a", "b", "mine"]);

    // The relay confirms mine: it takes its place, once.
    list = withMessage(list, message("mine", 3));
    expect(list.map((m) => [m.id, m.seq])).toEqual([
      ["a", 1],
      ["b", 2],
      ["mine", 3],
    ]);
    expect(withMessage(list, message("mine", 3))).toBe(list);
    expect(withMessage(list, message("mine", null))).toBe(list);
  });
});
