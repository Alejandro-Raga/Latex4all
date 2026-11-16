import { describe, expect, it } from "vitest";
import { linksTo, withRelated } from "./connect-notes";

describe("withRelated", () => {
  it("adds a Related section when there is none", () => {
    expect(withRelated("# Topic\n\nSome text.\n", "Other")).toBe(
      "# Topic\n\nSome text.\n\n## Related\n\n- [[Other]]\n",
    );
  });

  it("starts an empty note with the section", () => {
    expect(withRelated("", "Other")).toBe("## Related\n\n- [[Other]]\n");
  });

  it("adds after the section's last item, before the next heading", () => {
    const text = "## Related\n\n- [[A]]\n- [[B]]\n\n## Notes\n\n- not this\n";
    expect(withRelated(text, "C")).toBe(
      "## Related\n\n- [[A]]\n- [[B]]\n- [[C]]\n\n## Notes\n\n- not this\n",
    );
  });

  it("fills an empty section right under its heading", () => {
    expect(withRelated("## Related\n\n## Notes\n", "C")).toBe(
      "## Related\n\n- [[C]]\n\n## Notes\n",
    );
  });

  it("leaves a note that links already", () => {
    const text = "See [[other|the other one]].\n";
    expect(withRelated(text, "Other")).toBe(text);
  });
});

describe("linksTo", () => {
  it("matches plain, aliased and heading links, ignoring case", () => {
    expect(linksTo("[[Note]]", "note")).toBe(true);
    expect(linksTo("[[Note|x]]", "Note")).toBe(true);
    expect(linksTo("[[Note#Part]]", "Note")).toBe(true);
    expect(linksTo("[[Notebook]]", "Note")).toBe(false);
  });
});
