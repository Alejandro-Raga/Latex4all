import { describe, expect, it } from "vitest";
import { dayFromToday } from "@/lib/plan/dates";
import type { Task } from "@/lib/plan/plan-file";
import { moveToQuadrant, quadrantOf } from "./matrix-view";

const task = (fields: Partial<Task>): Task => ({
  done: false,
  title: "T",
  priority: 0,
  subtasks: [],
  notes: [],
  ...fields,
});

describe("the Eisenhower matrix", () => {
  it("sorts by priority (important) and date (urgent)", () => {
    expect(quadrantOf(task({ priority: 3, due: dayFromToday(1) }))).toBe("do");
    expect(quadrantOf(task({ priority: 4, due: dayFromToday(-3) }))).toBe("do");
    expect(quadrantOf(task({ priority: 3, due: dayFromToday(10) }))).toBe(
      "schedule",
    );
    expect(quadrantOf(task({ priority: 3 }))).toBe("schedule");
    expect(quadrantOf(task({ priority: 2, due: dayFromToday(0) }))).toBe(
      "squeeze",
    );
    expect(quadrantOf(task({}))).toBe("later");
  });

  it("changes a task dropped in a box to belong there", () => {
    expect(moveToQuadrant(task({}), "do")).toEqual({
      priority: 3,
      due: dayFromToday(0),
    });
    expect(moveToQuadrant(task({ due: dayFromToday(0) }), "schedule")).toEqual({
      priority: 3,
      due: dayFromToday(7),
    });
    expect(moveToQuadrant(task({ priority: 4 }), "schedule")).toEqual({});
    expect(moveToQuadrant(task({ priority: 3 }), "later")).toEqual({
      priority: 0,
    });
  });
});
