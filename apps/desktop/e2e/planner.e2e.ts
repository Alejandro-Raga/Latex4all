import { expect, open, test } from "./fixtures";

const disk = (page: import("@playwright/test").Page, path: string) =>
  page.evaluate((p) => (window as any).__disk.get(p) as string, path);
const vault = (page: import("@playwright/test").Page, path: string) =>
  page.evaluate((p) => (window as any).vaultFiles.get(p) as string, path);

const PLAN = "/papers/Paper 2/Plan.md";

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
  await main.getByText("Reply to reviewers").click();
  await main.getByRole("button", { name: "Tomorrow" }).click();
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
  await expect(main.getByText(/^In progress/)).toBeVisible();
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
  await expect(main.getByText(/No plan yet/)).toBeVisible();
  await main.getByLabel("Add a task").fill("Outline chapter 1 friday");
  await main.getByLabel("Add a task").press("Enter");
  await expect
    .poll(() => disk(page, "/papers/Thesis/Plan.md"))
    .toMatch(
      /^# Thesis\n\n## To do\n\n- \[ \] Outline chapter 1 📅 \d{4}-\d{2}-\d{2}\n\n## In progress/,
    );
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
  await expect(page.getByText(/No plan yet/)).toBeVisible();
});
