import { describe, expect, it } from "vitest";
import { outOfMatrix, withMatrix, withoutMatrixField } from "./matrix-opt";

describe("a task left out of the matrix", () => {
  it("is marked on its line, once, and put back cleanly", () => {
    const out = withMatrix("Finish chapter 1 #thesis", true);
    expect(out).toBe("Finish chapter 1 #thesis [matrix:: no]");
    expect(outOfMatrix({ title: out })).toBe(true);
    expect(withMatrix(out, true)).toBe(out);
    expect(withMatrix(out, false)).toBe("Finish chapter 1 #thesis");
    expect(withoutMatrixField(out)).toBe("Finish chapter 1 #thesis");
    expect(outOfMatrix({ title: "Finish chapter 1" })).toBe(false);
  });
});
