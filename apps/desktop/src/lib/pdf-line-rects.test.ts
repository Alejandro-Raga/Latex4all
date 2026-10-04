import { describe, expect, it } from "vitest";
import { mergeLineRects } from "./pdf-line-rects";

describe("highlight bands", () => {
  it("joins the words of a line into one band", () => {
    expect(
      mergeLineRects([
        [72, 700, 110, 712],
        [114, 700.5, 160, 711.5],
        [165, 700, 240, 712],
      ]),
    ).toEqual([[72, 700, 240, 712]]);
  });

  it("keeps lines apart, and another column apart", () => {
    const bands = mergeLineRects([
      [72, 700, 280, 712],
      [72, 686, 200, 698],
      [320, 700, 520, 712], // the next column, same height
    ]);
    expect(bands).toHaveLength(3);
  });
});
