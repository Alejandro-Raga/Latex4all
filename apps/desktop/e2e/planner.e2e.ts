import { expect, open, test } from "./fixtures";

const disk = (page: import("@playwright/test").Page, path: string) =>
  page.evaluate((p) => (window as any).__disk.get(p) as string, path);
const vault = (page: import("@playwright/test").Page, path: string) =>
  page.evaluate((p) => (window as any).vaultFiles.get(p) as string, path);

const PLAN = "/papers/Paper 2/Plan.md";

/** Drags with the mouse, as a person does: a few steps, then the drop. */
async function drag(
  page: import("@playwright/test").Page,
  from: import("@playwright/test").Locator,
  to: import("@playwright/test").Locator,
  /** Where on the target, from its top (0) to its bottom (1). */
  at = 0.5,
) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("nothing to drag");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * at, { steps: 12 });
  await page.mouse.up();
  // Clicks right after a drop are held back a moment, as by hand.
  await page.waitForTimeout(100);
}

test("Today gathers what's due from every plan; quick add goes to the Inbox", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await open(page, "scenario=planner");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Today" })).toBeVisible();
  // Overdue in Paper 2, with where it's from.
  await expect(main.getByText("Overdue")).toBeVisible();
  await expect(main.getByText("Draft the discussion")).toBeVisible();
  await expect(main.getByText("Paper 2", { exact: true })).toBeVisible();

  // Typed as said: due today in the Today list, high priority.
  const add = main.getByLabel("Add a task");
  await add.fill("Email the editor !high #admin");
  await expect(main.getByText("Enter to add")).toBeVisible();
  await add.press("Enter");
  await expect
    .poll(() => vault(page, "Tasks/Inbox.md"))
    .toMatch(/- \[ \] Email the editor #admin ⏫ 📅 \d{4}-\d{2}-\d{2}/);
  await expect(main.getByText("Email the editor")).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/planner-today.png` });
  }

  // Checked off from Today: written into the project's own plan.
  await main.getByRole("checkbox", { name: "Mark as done" }).first().click();
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/- \[x\] Draft the discussion ⏫ 📅 2020-01-01 #writing ✅/);
  expect(errors).toEqual([]);
});

test("a project's plan as a list and a board; a new plan where there's none", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Paper 2" })).toBeVisible();
  await expect(main.getByText("Reply to reviewers")).toBeVisible();

  // Details: a due date and a subtask.
  // Its details open beside the list.
  await main.getByText("Reply to reviewers").click();
  await expect(main.getByLabel("Task", { exact: true })).toHaveValue(
    "Reply to reviewers",
  );
  await main.getByRole("button", { name: "Due date" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tomorrow" })
    .click();
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/- \[ \] Reply to reviewers 📅 \d{4}-\d{2}-\d{2}/);
  await main.getByLabel("Add subtask").fill("Point 3 of reviewer 2");
  await main.getByLabel("Add subtask").press("Enter");
  await expect
    .poll(() => disk(page, PLAN))
    .toContain("    - [ ] Point 3 of reviewer 2");

  // The board: sections as columns.
  await main.getByRole("radio", { name: "Board" }).click();
  await expect(
    main.getByText("In progress", { exact: true }).first(),
  ).toBeVisible();
  await expect(main.getByText("Comments from María")).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/planner-board.png` });
  }
  await main.getByLabel("Add section").fill("Revisions");
  await main.getByLabel("Add section").press("Enter");
  await expect.poll(() => disk(page, PLAN)).toContain("## Revisions");

  // Thesis has no plan: the first task starts one.
  await page.getByRole("button", { name: /^Thesis/ }).click();
  await main.getByRole("radio", { name: "List" }).click();
  await expect(
    main.getByText("No tasks yet. Add the first one above."),
  ).toBeVisible();
  await main.getByLabel("Add a task").fill("Outline chapter 1 friday");
  await main.getByLabel("Add a task").press("Enter");
  await expect
    .poll(() => disk(page, "/papers/Thesis/Plan.md"))
    .toMatch(/^# Thesis\n\n- \[ \] Outline chapter 1 📅 \d{4}-\d{2}-\d{2}\n$/);
  expect(errors).toEqual([]);
});

test("the writing view has the project's plan in its own panel", async ({
  page,
}) => {
  await open(page, "scenario=workspace");
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: /^Show Plan|^Plan$/ })
    .first()
    .click();
  await expect(page.getByText("Plan", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Add a task")).toBeVisible();
  await expect(
    page.getByText("No tasks yet. Add the first one above."),
  ).toBeVisible();
});

test("the Inbox works with no vault: the app keeps it", async ({
  page,
  errors,
}) => {
  await open(page, "scenario=planner&novault=1");
  await page.getByRole("button", { name: /^Inbox/ }).click();
  const main = page.getByRole("main");
  await expect(
    main.getByText("For tasks that don't belong to a project."),
  ).toBeVisible();
  await main.getByLabel("Add a task").fill("Book the flight tomorrow");
  await main.getByLabel("Add a task").press("Enter");
  await expect
    .poll(() => disk(page, "/appdata/planner/Inbox.md"))
    .toMatch(/^# Inbox\n\n- \[ \] Book the flight 📅 \d{4}-\d{2}-\d{2}\n/);
  await expect(main.getByText("Book the flight")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a reading list apart from tasks, and tasks dragged to another project", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "List" }).click();
  await main.getByRole("radio", { name: "Reading" }).click();
  await expect(main.getByText("Nothing to read yet.")).toBeVisible();
  await main.getByLabel("Add a paper").fill("Absorptive capacity");
  await main.getByLabel("Add a paper").press("Enter");
  await expect
    .poll(() => disk(page, PLAN))
    .toContain(
      "## Reading list\n\n- [ ] Absorptive capacity #reading/to-read\n",
    );
  // Typed in by hand: not in Zotero, up next.
  await expect(main.getByText("Not in Zotero")).toBeVisible();
  await expect(main.getByRole("button", { name: /^Up next/ })).toBeVisible();
  // A link too, kept with it.
  await main.getByLabel("Add a paper").fill("A talk https://example.org/talk");
  await main.getByLabel("Add a paper").press("Enter");
  await expect
    .poll(() => disk(page, PLAN))
    .toContain("- [ ] [A talk](https://example.org/talk) #reading/to-read");
  // The marker: a click starts it, another finishes it.
  await main
    .getByRole("button", { name: "To read: mark as reading", exact: true })
    .first()
    .click();
  await expect
    .poll(() => disk(page, PLAN))
    .toContain("- [ ] Absorptive capacity #reading/reading");
  await expect(
    main.getByRole("button", { name: /^Reading now/ }),
  ).toBeVisible();
  // Up next, the talk is now first: dragged into Reading now, it's started.
  await drag(
    page,
    main.getByText("A talk"),
    main.getByRole("button", { name: /^Reading now/ }),
  );
  await expect
    .poll(() => disk(page, PLAN))
    .toContain("[A talk](https://example.org/talk) #reading/reading");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/reading-groups.png` });
  }
  // Not among the tasks.
  await main.getByRole("radio", { name: "Tasks" }).click();
  await expect(main.getByText("Absorptive capacity")).toHaveCount(0);
  // The Reading list gathers it.
  await page.getByRole("button", { name: /^Reading list/ }).click();
  await expect(main.getByText("Absorptive capacity")).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/planner-reading.png` });
  }

  // A task dragged onto Thesis in the sidebar moves there.
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  await main.getByRole("radio", { name: "Tasks" }).click();
  await drag(
    page,
    main.getByText("Reply to reviewers"),
    page.getByRole("button", { name: /^Thesis/ }),
  );
  await expect
    .poll(() => disk(page, "/papers/Thesis/Plan.md"))
    .toContain("- [ ] Reply to reviewers");
  await expect.poll(() => disk(page, PLAN)).not.toContain("Reply to reviewers");

  // Completed: what's been checked off.
  const cb = main.getByRole("checkbox", { name: "Mark as done" }).first();
  await cb.click();
  await page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("button", { name: /^Completed/ })
    .click();
  await expect(main.getByText("Draft the discussion")).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({
      path: `${process.env.SHOTS}/planner-completed.png`,
    });
  }
  expect(errors).toEqual([]);
});

test("drag a task into another to nest it; right-click to move; headings", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Tasks" }).click();
  await main.getByRole("radio", { name: "List" }).click();

  // Onto the middle of another: its subtask, shown under it.
  await drag(
    page,
    main.getByText("Reply to reviewers"),
    main.getByText("Draft the discussion"),
  );
  await expect
    .poll(() => disk(page, PLAN))
    .toContain("    - [ ] Compare with Cohen\n    - [ ] Reply to reviewers\n");
  await expect(main.getByText("Reply to reviewers")).toBeVisible();

  // Right-click: back to a task, then to the Inbox.
  await main.getByText("Reply to reviewers").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Make it a task" }).click();
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/\n- \[ \] Reply to reviewers\n/);
  await main.getByText("Reply to reviewers").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("menuitem", { name: "Inbox" }).click();
  await expect
    .poll(() => vault(page, "Tasks/Inbox.md"))
    .toContain("- [ ] Reply to reviewers");

  // A heading of one's own, then deleted: its tasks stay.
  await main.getByRole("button", { name: "Add heading" }).click();
  await main.getByLabel("New heading").fill("Revisions");
  await main.getByLabel("New heading").press("Enter");
  await expect.poll(() => disk(page, PLAN)).toContain("## Revisions");
  await drag(
    page,
    main.getByText("Comments from María"),
    main.getByText("Revisions", { exact: true }),
  );
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/## Revisions\n\n- \[ \] Comments from María/);
  if (process.env.SHOTS) {
    await page.screenshot({
      path: `${process.env.SHOTS}/planner-headings.png`,
    });
  }
  const heading = main.locator(".group\\/heading", { hasText: "Revisions" });
  await heading.hover();
  await heading.getByRole("button", { name: "Heading options" }).click();
  await page.getByRole("menuitem", { name: "Delete heading" }).click();
  await expect.poll(() => disk(page, PLAN)).not.toContain("## Revisions");
  await expect(main.getByText("Comments from María")).toBeVisible();
  expect(errors).toEqual([]);
});

test("projects grouped by the chosen order; list or board apart for tasks and reading", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner&types=1");
  const projects = page.getByRole("navigation", { name: "Projects" });
  await page.getByRole("button", { name: "Sort projects" }).click();
  await page.getByRole("menuitem", { name: "Type" }).click();
  const articles = projects.getByRole("button", { name: /^Article/ });
  await expect(articles).toBeVisible();
  await expect(
    projects.getByRole("button", { name: /^Paper 3/ }),
  ).toBeVisible();
  // A group folds away, and back.
  await articles.click();
  await expect(projects.getByRole("button", { name: /^Paper 3/ })).toHaveCount(
    0,
  );
  await articles.click();
  await expect(
    projects.getByRole("button", { name: /^Paper 3/ }),
  ).toBeVisible();

  await projects.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Tasks" }).click();
  await main.getByRole("radio", { name: "Board" }).click();
  await main.getByRole("radio", { name: "Reading" }).click();
  await expect(main.getByRole("radio", { name: "List" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await main.getByRole("radio", { name: "Tasks" }).click();
  await expect(main.getByRole("radio", { name: "Board" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(errors).toEqual([]);
});

test("a project's deadline: set in its header, shown in the sidebar and in Today", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Deadline", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Today" }).click();
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/^---\ndue: \d{4}-\d{2}-\d{2}\n---\n# Paper 2\n/);
  await expect(
    page.getByRole("navigation", { name: "Projects" }).getByText("Today"),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("button", { name: /\bToday\b/ })
    .click();
  await expect(main.getByRole("button", { name: /^Deadlines/ })).toBeVisible();
  await main.getByRole("button", { name: /Paper 2 is due/ }).click();
  await expect(main.getByRole("heading", { name: "Paper 2" })).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/deadline.png` });
  }
  expect(errors).toEqual([]);
});

test("papers added from the Zotero library; projects found by name", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner&types=1");
  const sidebar = page.getByRole("navigation", { name: "Projects" });
  await page.getByLabel("Find a project").fill("talk");
  await expect(
    sidebar.getByRole("button", { name: /Conference talk/ }),
  ).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Paper 2/ })).toHaveCount(
    0,
  );
  await page.getByLabel("Find a project").fill("article");
  await expect(sidebar.getByRole("button", { name: /^Paper 3/ })).toBeVisible();
  await page.getByLabel("Find a project").fill("");

  await sidebar.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Reading" }).click();
  await main.getByRole("radio", { name: "List" }).click();
  await main.getByRole("button", { name: "Add from Zotero" }).click();
  await page.getByLabel("Search your Zotero library").fill("decline");
  await page.getByRole("button", { name: /The decline of science/ }).click();
  await expect
    .poll(() => disk(page, PLAN))
    .toContain(
      "- [ ] [The decline of science in corporate R&D](zotero://select/library/items/ARORA001) #reading/to-read",
    );
  // Once added, ticked in the picker.
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /The decline of science/ }),
  ).toBeDisabled();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/zotero-picker.png` });
  }
  expect(errors).toEqual([]);
});

test("the calendar: a task added on a day, dragged to the next", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page, "scenario=planner");
  await page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("button", { name: /^Calendar/ })
    .click();
  const main = page.getByRole("main");
  await main.getByLabel("Add a task").fill("Write the abstract");
  await main.getByLabel("Add a task").press("Enter");
  await expect
    .poll(() => vault(page, "Tasks/Inbox.md"))
    .toMatch(/- \[ \] Write the abstract 📅 (\d{4}-\d{2}-\d{2})/);
  const before = /📅 (\d{4}-\d{2}-\d{2})/.exec(
    await vault(page, "Tasks/Inbox.md"),
  )?.[1];
  // In today's cell, and in the day's list on the right.
  await expect(main.getByText("Write the abstract").first()).toBeVisible();
  await main.getByRole("radio", { name: "Week" }).click();
  const chip = main.getByText("Write the abstract").first();
  const next = new Date(`${before}T00:00`);
  next.setDate(next.getDate() + 1);
  const nextDay = String(next.getDate());
  // The next day's cell, by its number (wrapping into the next week if
  // today is Sunday is fine: the week view then lacks it, so use the month).
  if (next.getDay() === 1)
    await main.getByRole("radio", { name: "Month" }).click();
  const cell = main
    .locator('[role="button"]')
    .filter({ has: page.getByText(nextDay, { exact: true }) })
    .first();
  await drag(page, chip, cell);
  await expect
    .poll(() => vault(page, "Tasks/Inbox.md"))
    .not.toContain(`📅 ${before}`);
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/calendar.png` });
  }
  expect(errors).toEqual([]);
});

test("a project's timeline: milestones on the way to its deadline", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Timeline" }).click();
  await expect(main.getByText("No milestones yet.")).toBeVisible();
  await main.getByLabel("Add a milestone").fill("First draft in 10 days");
  await main.getByLabel("Add a milestone").press("Enter");
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/## Milestones\n\n- \[ \] First draft 📅 \d{4}-\d{2}-\d{2}\n/);
  await expect(main.getByText("Next:")).toBeVisible();
  // Not among the tasks.
  await main.getByRole("radio", { name: "Tasks" }).click();
  await expect(main.getByText("First draft")).toHaveCount(0);
  await main.getByRole("radio", { name: "Timeline" }).click();
  await main.getByRole("button", { name: "Mark as reached" }).click();
  await expect.poll(() => disk(page, PLAN)).toMatch(/- \[x\] First draft/);
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/timeline.png` });
  }
  expect(errors).toEqual([]);
});

test("a date picked from the month", async ({ page, errors }) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  await page.getByText("Reply to reviewers").click();
  const detail = page.getByRole("complementary").last();
  await detail.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  if (process.env.SHOTS) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env.SHOTS}/datepicker.png` });
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /\b15\b/ })
    .first()
    .click();
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/- \[ \] Reply to reviewers 📅 \d{4}-\d{2}-15/);
  expect(errors).toEqual([]);
});

test("a list of one's own, with its tasks and its reading", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByLabel("List name").fill("Teaching");
  await page.getByLabel("List name").press("Enter");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Teaching" })).toBeVisible();
  await main.getByLabel("Add a task").fill("Grade the essays");
  await main.getByLabel("Add a task").press("Enter");
  await expect
    .poll(() => vault(page, "Tasks/Teaching.md"))
    .toContain("- [ ] Grade the essays");
  await main.getByRole("radio", { name: "Reading" }).click();
  await main.getByLabel("Add a paper").fill("The economics of science");
  await main.getByLabel("Add a paper").press("Enter");
  await expect
    .poll(() => vault(page, "Tasks/Teaching.md"))
    .toContain("The economics of science #reading/to-read");
  // No deadline or timeline: those are a project's.
  await expect(main.getByRole("radio", { name: "Timeline" })).toHaveCount(0);
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/own-list.png` });
  }
  expect(errors).toEqual([]);
});

test("a section with a date, kept in its heading", async ({ page, errors }) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  const heading = main.locator("section").filter({ hasText: "In progress" });
  await heading.hover();
  await heading.getByRole("button", { name: "Section date" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Next week" })
    .click();
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/## In progress 📅 \d{4}-\d{2}-\d{2}\n/);
  // Shown by its name, the date apart.
  await expect(main.getByText("In progress", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("subtasks are tasks too: opened, dated, with their own subtasks", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await main.getByText("Compare with Cohen").click();
  const detail = page.getByRole("complementary").last();
  await expect(detail.getByLabel("Task", { exact: true })).toHaveValue(
    "Compare with Cohen",
  );
  await detail.getByLabel("Add subtask").fill("Read section 3");
  await detail.getByLabel("Add subtask").press("Enter");
  await detail.getByRole("button", { name: "Due date" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tomorrow" })
    .click();
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(
      / {4}- \[ \] Compare with Cohen 📅 \d{4}-\d{2}-\d{2}\n {8}- \[ \] Read section 3\n/,
    );
  // Shown nested in the list, and back up to its parent.
  await expect(main.getByText("Read section 3")).toHaveCount(2);
  await detail.getByRole("button", { name: "Draft the discussion" }).click();
  await expect(detail.getByLabel("Task", { exact: true })).toHaveValue(
    "Draft the discussion #writing",
  );
  expect(errors).toEqual([]);
});

test("the matrix: by importance and urgency, changed by dragging", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page, "scenario=planner");
  await page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("button", { name: /^Matrix/ })
    .click();
  const main = page.getByRole("main");
  const box = (name: string) =>
    main.locator("div.group\\/heading").filter({ hasText: name });
  // High priority and overdue: do it first.
  await expect(box("Do first").getByText("Draft the discussion")).toBeVisible();
  await expect(box("Later").getByText("Reply to reviewers")).toBeVisible();
  await drag(
    page,
    box("Later").getByText("Reply to reviewers"),
    box("Schedule"),
  );
  await expect
    .poll(() => disk(page, PLAN))
    .toContain("- [ ] Reply to reviewers ⏫");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/matrix.png` });
  }
  expect(errors).toEqual([]);
});

test("a project's priority, in its plan and beside its name", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Priority" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "High priority" })
    .click();
  await expect
    .poll(() => disk(page, PLAN))
    .toMatch(/^---\npriority: high\n---\n/);
  await expect(
    page.getByRole("button", { name: /^Paper 2/ }).getByLabel("High priority"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a task made a project, its subtasks the project's tasks", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await open(page, "scenario=planner");
  await page.getByRole("button", { name: /^Paper 2/ }).click();
  const main = page.getByRole("main");
  await main.getByText("Draft the discussion").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Make it a project" }).click();
  await expect
    .poll(() => disk(page, "/papers/Draft the discussion/Plan.md"))
    .toBe(
      "---\ndue: 2020-01-01\npriority: high\n---\n# Draft the discussion\n\n- [ ] Compare with Cohen\n",
    );
  await expect
    .poll(() => disk(page, PLAN))
    .not.toContain("Draft the discussion");
  await expect(
    page.getByRole("button", { name: /^Draft the discussion/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("the overview: every list's sections at a glance", async ({
  page,
  errors,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page, "scenario=planner");
  await page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("button", { name: /^Overview/ })
    .click();
  const main = page.getByRole("main");
  const card = main.locator("section").filter({ hasText: "Paper 2" });
  await expect(card.getByText("Waiting", { exact: false })).toBeVisible();
  await expect(card.getByText("Comments from María")).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/overview.png` });
  }
  await card.getByRole("button", { name: /Paper 2/ }).click();
  await expect(main.getByRole("heading", { name: "Paper 2" })).toBeVisible();
  expect(errors).toEqual([]);
});
