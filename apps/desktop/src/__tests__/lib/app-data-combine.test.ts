import { describe, expect, it } from "vitest";
import { combine } from "@/lib/collab/app-data-sync";

describe("combine", () => {
  it("keeps every line of two lists", () => {
    const out = combine(
      "planner/Inbox.md",
      "# Inbox\n\n- [ ] a\n",
      "# Inbox\n\n- [ ] b\n- [ ] a\n",
    );
    expect(out).toBe("# Inbox\n\n- [ ] a\n- [ ] b\n");
  });
  it("keeps every highlight of both", () => {
    const out = JSON.parse(
      combine(
        "pdf-notes/x.json",
        JSON.stringify({ notes: [{ id: "1" }, { id: "2" }] }),
        JSON.stringify({ notes: [{ id: "2" }, { id: "3" }], version: "v" }),
      ),
    );
    expect(out.notes.map((n: { id: string }) => n.id)).toEqual(["1", "2", "3"]);
  });
});
