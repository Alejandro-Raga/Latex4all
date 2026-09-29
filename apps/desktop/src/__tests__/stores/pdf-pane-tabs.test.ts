import { beforeEach, describe, expect, it } from "vitest";
import { useDockStore } from "@/stores/dock-store";
import { useReadingStore } from "@/stores/reading-store";

const paper = (id: string) => ({ id, label: id, data: new Uint8Array() });

describe("PDF pane tabs", () => {
  beforeEach(() => {
    useReadingStore.setState({ papers: [], active: "preview" });
    useDockStore.setState({ wide: null });
  });

  it("gives each paper one tab and brings it forward", () => {
    const r = useReadingStore.getState();
    r.open(paper("a"));
    r.open(paper("b"));
    r.open(paper("a"));
    const s = useReadingStore.getState();
    expect(s.papers.map((p) => p.id)).toEqual(["a", "b"]);
    expect(s.active).toBe("a");
  });

  it("shows the neighbour when the tab in front closes, then the preview", () => {
    const r = useReadingStore.getState();
    r.open(paper("a"));
    r.open(paper("b"));
    r.open(paper("c"));
    r.activate("b");
    r.close("b");
    expect(useReadingStore.getState().active).toBe("c");
    r.close("c");
    expect(useReadingStore.getState().active).toBe("a");
    r.close("a");
    expect(useReadingStore.getState().active).toBe("preview");
  });

  it("leaves the front tab alone when another closes", () => {
    const r = useReadingStore.getState();
    r.open(paper("a"));
    r.open(paper("b"));
    r.close("a");
    expect(useReadingStore.getState().active).toBe("b");
  });

  it("opens a widened panel as a tab, and returns to the preview when it goes back", () => {
    useReadingStore.getState().open(paper("a"));
    useDockStore.getState().setWide("vault");
    expect(useReadingStore.getState().active).toBe("wide");
    expect(useReadingStore.getState().papers).toHaveLength(1);
    useDockStore.getState().setWide(null);
    expect(useReadingStore.getState().active).toBe("preview");
  });
});
