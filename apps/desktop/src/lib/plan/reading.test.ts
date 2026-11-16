import { describe, expect, it } from "vitest";
import { newPlanText, parsePlan, serializePlan } from "./plan-file";
import {
  addReading,
  advanceReading,
  readingItems,
  setReadingStatus,
  workTasks,
} from "./reading";

const start = () =>
  addReading(parsePlan(`${newPlanText("P")}\n- [ ] A task\n`), {
    title: "Absorptive capacity",
    itemKey: "ABCD1234",
  });

describe("reading list", () => {
  it("adds a paper under Reading list, linked to Zotero", () => {
    const text = serializePlan(start());
    expect(text).toContain(
      "## Reading list\n\n- [ ] [Absorptive capacity](zotero://select/library/items/ABCD1234) #reading/to-read\n",
    );
    const [item] = readingItems(start());
    expect(item).toMatchObject({
      title: "Absorptive capacity",
      itemKey: "ABCD1234",
      status: "to-read",
    });
  });

  it("doesn't add the same paper twice, and keeps tasks apart", () => {
    const twice = addReading(start(), { title: "Again", itemKey: "ABCD1234" });
    expect(readingItems(twice)).toHaveLength(1);
    expect(workTasks(twice).map((t) => t.task.title)).toEqual(["A task"]);
  });

  it("moves forward on its own, never back", () => {
    let plan = advanceReading(start(), "ABCD1234", "reading");
    expect(readingItems(plan)[0].status).toBe("reading");
    plan = advanceReading(plan, "ABCD1234", "read", "2026-11-16");
    expect(readingItems(plan)[0]).toMatchObject({ status: "read" });
    expect(serializePlan(plan)).toContain(
      "- [x] [Absorptive capacity](zotero://select/library/items/ABCD1234) #reading/read ✅ 2026-11-16",
    );
    // Opening it again doesn't put it back to Reading.
    expect(advanceReading(plan, "ABCD1234", "reading")).toBe(plan);
    // Another paper: nothing changes.
    expect(advanceReading(plan, "ZZZZ0000", "cited")).toBe(plan);
  });

  it("can be set to any status by hand", () => {
    const plan = setReadingStatus(
      start(),
      readingItems(start())[0].ref,
      "cited",
      "2026-11-16",
    );
    const back = setReadingStatus(plan, readingItems(plan)[0].ref, "to-read");
    expect(readingItems(back)[0]).toMatchObject({ status: "to-read" });
    expect(readingItems(back)[0].task.done).toBe(false);
  });
});
