import { describe, expect, it } from "vitest";
import { newPlanText, parsePlan, serializePlan } from "./plan-file";
import {
  addMark,
  addReading,
  linkReading,
  markOpened,
  markPage,
  nextStatus,
  parsePaperInput,
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
    expect(serializePlan(start())).toContain(
      "## Reading list\n\n- [ ] [Absorptive capacity](zotero://select/library/items/ABCD1234) #reading/to-read\n",
    );
    expect(readingItems(start())[0]).toMatchObject({
      title: "Absorptive capacity",
      itemKey: "ABCD1234",
      status: "to-read",
      marks: [],
    });
  });

  it("doesn't add the same paper twice, and keeps tasks apart", () => {
    const twice = addReading(start(), { title: "Again", itemKey: "ABCD1234" });
    expect(readingItems(twice)).toHaveLength(1);
    expect(workTasks(twice).map((t) => t.task.title)).toEqual(["A task"]);
  });

  it("opening starts it and keeps the last page", () => {
    let plan = markOpened(start(), "ABCD1234");
    expect(readingItems(plan)[0].status).toBe("reading");
    plan = markPage(plan, "ABCD1234", 12, 30);
    expect(readingItems(plan)[0]).toMatchObject({ page: 12, pages: 30 });
    expect(serializePlan(plan)).toContain("#reading/reading [page:: 12/30]");
    // Read papers stay read when opened again.
    const read = setReadingStatus(
      plan,
      readingItems(plan)[0].ref,
      "read",
      "2026-11-17",
    );
    expect(readingItems(markOpened(read, "ABCD1234"))[0].status).toBe("read");
    expect(readingItems(markPage(read, "ABCD1234", 3))[0]).toMatchObject({
      status: "read",
      page: 3,
    });
  });

  it("keeps marks apart from the status", () => {
    let plan = addMark(start(), "ABCD1234", "highlighted");
    expect(readingItems(plan)[0]).toMatchObject({
      status: "reading",
      marks: ["highlighted"],
    });
    plan = addMark(plan, "ABCD1234", "cited");
    plan = addMark(plan, "ABCD1234", "quoted");
    expect(readingItems(plan)[0].marks).toEqual([
      "highlighted",
      "quoted",
      "cited",
    ]);
    expect(readingItems(plan)[0].status).toBe("reading");
    // The same mark again changes nothing.
    expect(addMark(plan, "ABCD1234", "cited")).toBe(plan);
  });

  it("goes round its statuses by hand, read checked off", () => {
    expect(nextStatus("to-read")).toBe("reading");
    expect(nextStatus("reading")).toBe("read");
    expect(nextStatus("read")).toBe("to-read");
    const plan = setReadingStatus(
      start(),
      readingItems(start())[0].ref,
      "read",
      "2026-11-17",
    );
    expect(readingItems(plan)[0].task).toMatchObject({
      done: true,
      doneOn: "2026-11-17",
    });
  });

  it("reads lists from before: old statuses become marks", () => {
    const old = parsePlan(
      "## Reading list\n\n- [x] [A](zotero://select/library/items/AAAA0000) #reading/cited\n- [x] [B](zotero://select/library/items/BBBB0000) #reading/noted\n- [ ] [C](zotero://select/library/items/CCCC0000) #reading/read\n",
    );
    expect(readingItems(old).map((r) => [r.title, r.status, r.marks])).toEqual([
      ["A", "read", ["cited"]],
      ["B", "read", ["quoted"]],
      ["C", "reading", ["highlighted"]],
    ]);
  });
});

describe("papers not in Zotero", () => {
  it("takes a title, a DOI or a link as typed", () => {
    expect(parsePaperInput("10.1016/j.respol.2018.01.005")).toEqual({
      title: "10.1016/j.respol.2018.01.005",
      url: "https://doi.org/10.1016/j.respol.2018.01.005",
      doi: "10.1016/j.respol.2018.01.005",
    });
    expect(
      parsePaperInput("Firms and science — doi:10.1016/j.respol.2018.01.005"),
    ).toMatchObject({
      title: "Firms and science",
      doi: "10.1016/j.respol.2018.01.005",
    });
    expect(parsePaperInput("Some talk https://example.org/x")).toEqual({
      title: "Some talk",
      url: "https://example.org/x",
      doi: undefined,
    });
    expect(parsePaperInput("Just a title")).toEqual({ title: "Just a title" });
  });

  it("keeps the link, then becomes a Zotero entry when added there", () => {
    const plan = addReading(parsePlan(""), {
      title: "Firms and science",
      url: "https://doi.org/10.1016/j.respol.2018.01.005",
    });
    const [item] = readingItems(plan);
    expect(item).toMatchObject({
      title: "Firms and science",
      doi: "10.1016/j.respol.2018.01.005",
      itemKey: undefined,
    });
    const reading = setReadingStatus(plan, item.ref, "reading");
    const linked = linkReading(reading, item.ref, "ZZZZ9999");
    expect(readingItems(linked)[0]).toMatchObject({
      itemKey: "ZZZZ9999",
      url: undefined,
      status: "reading",
      title: "Firms and science",
    });
  });
});

describe("bookmarks", () => {
  const plan = parsePlan(
    "# P\n\n## Reading list\n\n- [ ] [Absorptive capacity](zotero://select/library/items/ABCD1234) #reading/to-read [page:: 3/40]\n",
  );

  it("keep the page, start the paper, and set its progress", async () => {
    const { markBookmark, progress, readingItems } = await import("./reading");
    const marked = markBookmark(plan, "ABCD1234", 20);
    const [item] = readingItems(marked);
    expect(item.bookmark).toBe(20);
    expect(item.status).toBe("reading");
    expect(item.title).toBe("Absorptive capacity");
    expect(progress(item)).toBe(0.5);
    expect(serializePlan(marked)).toContain("[page:: 3/40] [bookmark:: 20]");
    const cleared = markBookmark(marked, "ABCD1234", undefined);
    expect(readingItems(cleared)[0].bookmark).toBeUndefined();
    expect(progress(readingItems(cleared)[0])).toBe(3 / 40);
  });
});

describe("moving the Inbox's reading", () => {
  it("takes its papers, as written, to the general list", async () => {
    const { moveReading, readingItems } = await import("./reading");
    const inbox = parsePlan(
      "# Inbox\n\n- [ ] Call the bank\n\n## Reading list\n\n- [ ] [Absorptive capacity](zotero://select/library/items/ABCD1234) #reading/reading [page:: 3/40]\n- [ ] A paper someone mentioned #reading/to-read\n",
    );
    const general = parsePlan(newPlanText("Reading"));
    const moved = moveReading(inbox, general);
    expect(serializePlan(moved.from)).toBe("# Inbox\n\n- [ ] Call the bank\n");
    expect(
      readingItems(moved.to).map((r) => [r.title, r.status, r.page]),
    ).toEqual([
      ["Absorptive capacity", "reading", 3],
      ["A paper someone mentioned", "to-read", undefined],
    ]);
  });
});
