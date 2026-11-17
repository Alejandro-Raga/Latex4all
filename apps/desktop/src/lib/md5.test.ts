import { describe, expect, it } from "vitest";
import { md5 } from "./md5";

const text = (s: string) => new TextEncoder().encode(s);

describe("md5", () => {
  it("matches RFC 1321's examples", () => {
    expect(md5(text(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5(text("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5(text("message digest"))).toBe(
      "f96b697d7cb7938d525a2f31aaf161d0",
    );
    expect(
      md5(
        text(
          "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
        ),
      ),
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
});
