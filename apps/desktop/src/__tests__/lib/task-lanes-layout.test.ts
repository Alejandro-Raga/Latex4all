import { describe, expect, it } from "vitest";
import { layoutLane } from "@/lib/plan/task-lanes";

const item = (x: number, label: string) => ({ x, label });

describe("layoutLane", () => {
  it("never lets two names in a row overlap", () => {
    const items = [
      item(100, "Chapter 1: Descriptive analysis"),
      item(130, "Chapter 4: Introduction"),
      item(150, "Chapter 3: Returns"),
      item(300, "Chapter 2: CS & innovative output"),
      item(320, "Finish"),
    ];
    const { placed } = layoutLane(items, 1000);
    const byRow = new Map<number, Array<[number, number]>>();
    for (const p of placed.filter((p) => p.kind !== "more")) {
      const span: [number, number] = p.left
        ? [p.x - 10 - p.labelW, p.x + 4]
        : [p.x - 4, p.x + 10 + p.labelW];
      const row = byRow.get(p.row) ?? [];
      for (const [a, b] of row) expect(span[0] >= b || span[1] <= a).toBe(true);
      row.push(span);
      byRow.set(p.row, row);
    }
    const shown = placed.flatMap((p) => p.items).length;
    expect(shown).toBe(items.length);
  });

  it("counts what doesn't fit, and names go left near the end", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      item(500 + i, `Task ${i}`),
    );
    const { placed, rows } = layoutLane(many, 520, 2);
    const more = placed.filter((p) => p.kind === "more");
    expect(more.length).toBeGreaterThan(0);
    expect(rows).toBe(3);
    expect(placed.filter((p) => p.kind === "task").every((p) => p.left)).toBe(
      true,
    );
    expect(placed.flatMap((p) => p.items).length).toBe(12);
  });
});
