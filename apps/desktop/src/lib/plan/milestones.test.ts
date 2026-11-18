import { describe, expect, it } from "vitest";
import { atRisk, linkedSection, sectionProgress, withLink } from "./milestones";
import { parsePlan } from "./plan-file";

const plan = parsePlan(
  [
    "# Thesis",
    "",
    "## Chapter 2 📅 2027-03-01",
    "",
    "- [x] Outline",
    "- [ ] Draft",
    "    - [x] Section 2.1",
    "    - [ ] Section 2.2",
    "",
    "## Milestones",
    "",
    "- [ ] Chapter 2 done 🛫 2027-01-10 📅 2027-03-01 [for:: Chapter 2]",
    "",
  ].join("\n"),
);

describe("a milestone following a section", () => {
  it("is linked on its line and unlinked cleanly", () => {
    const title = withLink("Chapter 2 done", "Chapter 2");
    expect(title).toBe("Chapter 2 done [for:: Chapter 2]");
    expect(linkedSection({ title })).toBe("Chapter 2");
    expect(withLink(title, "Chapter 3")).toBe(
      "Chapter 2 done [for:: Chapter 3]",
    );
    expect(withLink(title, null)).toBe("Chapter 2 done");
  });

  it("counts the section's tasks and subtasks, its date aside", () => {
    expect(sectionProgress(plan, "Chapter 2")).toEqual({ done: 2, total: 4 });
    expect(sectionProgress(plan, "Nowhere")).toBeNull();
  });

  it("is at risk when close and far from done", () => {
    const days = (n: number) => () => n;
    const half = { done: 2, total: 4 };
    expect(atRisk(half, "x", days(3))).toBe(true);
    expect(atRisk(half, "x", days(30))).toBe(false);
    expect(atRisk({ done: 4, total: 5 }, "x", days(3))).toBe(false);
    expect(atRisk({ done: 4, total: 4 }, "x", days(-2))).toBe(false);
    expect(atRisk(null, "x", days(1))).toBe(false);
  });
});
