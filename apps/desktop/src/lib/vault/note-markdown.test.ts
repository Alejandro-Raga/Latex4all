import { describe, expect, it } from "vitest";
import { withoutBlockIds } from "@/components/workspace/vault-panel";

describe("block ids in a note", () => {
  it("aren't shown, alone on a line or ending one", () => {
    expect(
      withoutBlockIds(
        "> quote\n> — p. 2\n\n^ivkzhggg\n\ntext ^ab12cd34\nx^2 stays",
      ),
    ).toBe("> quote\n> — p. 2\n\n\n\ntext\nx^2 stays");
  });
});

describe("a highlight's zotero:// link", () => {
  it("opens that PDF here, at its page", async () => {
    const { zoteroPdfTarget } = await import("@/components/zotero-pdf-dialog");
    expect(
      zoteroPdfTarget(
        "zotero://open-pdf/library/items/APDRGR25?page=2&annotation=2BIHEYEW",
        "Rotolo 2022",
      ),
    ).toEqual({ attachmentKey: "APDRGR25", page: 2, label: "Rotolo 2022" });
    expect(
      zoteroPdfTarget("zotero://open-pdf/groups/123/items/APDRGR25")?.page,
    ).toBeNull();
    expect(
      zoteroPdfTarget("zotero://select/library/items/APDRGR25"),
    ).toBeNull();
  });
});
