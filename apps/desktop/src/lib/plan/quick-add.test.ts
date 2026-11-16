import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add";

// A Monday.
const NOW = new Date(2026, 10, 16, 10, 0);
const q = (text: string) => parseQuickAdd(text, NOW);

describe("parseQuickAdd", () => {
  it("takes the date and priority out, keeping tags and links", () => {
    expect(q("Revise the intro tomorrow !high #paper2")).toEqual({
      title: "Revise the intro #paper2",
      due: "2026-11-17",
      priority: 3,
    });
    expect(q("Read [[Cohen1990]]")).toEqual({
      title: "Read [[Cohen1990]]",
      due: undefined,
      priority: 0,
    });
  });

  it("reads the usual ways of saying when", () => {
    expect(q("a today").due).toBe("2026-11-16");
    expect(q("a by friday").due).toBe("2026-11-20");
    expect(q("a next friday").due).toBe("2026-11-27");
    expect(q("a monday").due).toBe("2026-11-16");
    expect(q("a next week").due).toBe("2026-11-23");
    expect(q("a in 3 days").due).toBe("2026-11-19");
    expect(q("a in 2 weeks").due).toBe("2026-11-30");
    expect(q("a on nov 20").due).toBe("2026-11-20");
    expect(q("a 3 march").due).toBe("2027-03-03");
    expect(q("a due 2026-12-01").due).toBe("2026-12-01");
  });

  it("in Spanish too", () => {
    expect(q("Leer mañana")).toMatchObject({
      title: "Leer",
      due: "2026-11-17",
    });
    expect(q("Enviar el viernes").due).toBe("2026-11-20");
    expect(q("Revisar 20 de noviembre").due).toBe("2026-11-20");
  });

  it("leaves words that only look like dates", () => {
    expect(q("Satisfy the reviewers")).toMatchObject({
      title: "Satisfy the reviewers",
      due: undefined,
    });
    expect(q("Section 3 may need work")).toMatchObject({
      title: "Section 3 may need work",
      due: undefined,
    });
  });

  it("reads priority marks", () => {
    expect(q("a !!!").priority).toBe(3);
    expect(q("a !low").priority).toBe(1);
    expect(q("a !urgent").priority).toBe(4);
    expect(q("Wow! great").title).toBe("Wow! great");
  });
});
