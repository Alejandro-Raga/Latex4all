import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProposedChangesStore } from "@/stores/proposed-changes-store";
import { useDocumentStore } from "@/stores/document-store";

// Mock the document store (used by keepChange/undoChange)
vi.mock("@/stores/document-store", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      files: [],
      reloadFile: vi.fn(),
    })),
  },
}));

// Mock writeTexFileContent
vi.mock("@/lib/tauri/fs", () => ({
  writeTexFileContent: vi.fn(() => Promise.resolve()),
}));

describe("useProposedChangesStore", () => {
  beforeEach(() => {
    useProposedChangesStore.setState({ changes: [] });
  });

  describe("addChange", () => {
    it("adds a new change", () => {
      useProposedChangesStore.getState().addChange({
        id: "tool-1",
        filePath: "main.tex",
        absolutePath: "/project/main.tex",
        oldContent: "old",
        newContent: "new",
        toolName: "Edit",
      });
      const { changes } = useProposedChangesStore.getState();
      expect(changes).toHaveLength(1);
      expect(changes[0].id).toBe("tool-1");
      expect(changes[0].oldContent).toBe("old");
      expect(changes[0].newContent).toBe("new");
      expect(changes[0].timestamp).toBeGreaterThan(0);
    });

    it("merges changes for the same file, preserving original oldContent", () => {
      const store = useProposedChangesStore.getState();
      store.addChange({
        id: "tool-1",
        filePath: "main.tex",
        absolutePath: "/project/main.tex",
        oldContent: "original",
        newContent: "first-edit",
        toolName: "Edit",
      });
      store.addChange({
        id: "tool-2",
        filePath: "main.tex",
        absolutePath: "/project/main.tex",
        oldContent: "first-edit",
        newContent: "second-edit",
        toolName: "Edit",
      });
      const { changes } = useProposedChangesStore.getState();
      expect(changes).toHaveLength(1);
      expect(changes[0].id).toBe("tool-2");
      expect(changes[0].oldContent).toBe("original"); // preserved baseline
      expect(changes[0].newContent).toBe("second-edit");
    });

    it("keeps changes for different files separate", () => {
      const store = useProposedChangesStore.getState();
      store.addChange({
        id: "tool-1",
        filePath: "main.tex",
        absolutePath: "/project/main.tex",
        oldContent: "a",
        newContent: "b",
        toolName: "Edit",
      });
      store.addChange({
        id: "tool-2",
        filePath: "refs.bib",
        absolutePath: "/project/refs.bib",
        oldContent: "c",
        newContent: "d",
        toolName: "Write",
      });
      expect(useProposedChangesStore.getState().changes).toHaveLength(2);
    });
  });

  describe("resolveChange", () => {
    it("removes a change by id", () => {
      useProposedChangesStore.getState().addChange({
        id: "tool-1",
        filePath: "main.tex",
        absolutePath: "/project/main.tex",
        oldContent: "a",
        newContent: "b",
        toolName: "Edit",
      });
      useProposedChangesStore.getState().resolveChange("tool-1");
      expect(useProposedChangesStore.getState().changes).toHaveLength(0);
    });
  });

  describe("undoChange", () => {
    it("takes out only Claude's change, keeping what was written since", async () => {
      const file = {
        id: "main.tex",
        relativePath: "main.tex",
        content: "Intro, by a collaborator.\nClaude's line.\nEnd.",
      };
      const updateFileContent = vi.fn((_: string, content: string) => {
        file.content = content;
      });
      const saveFile = vi.fn(() => Promise.resolve());
      vi.mocked(useDocumentStore.getState).mockReturnValue({
        files: [file],
        updateFileContent,
        saveFile,
        reloadFile: vi.fn(),
      } as never);
      useProposedChangesStore.getState().addChange({
        id: "tool-1",
        filePath: "main.tex",
        absolutePath: "/project/main.tex",
        oldContent: "Intro.\nEnd.",
        newContent: "Intro.\nClaude's line.\nEnd.",
        toolName: "Edit",
      });
      await useProposedChangesStore.getState().undoChange("tool-1");
      expect(file.content).toBe("Intro, by a collaborator.\nEnd.");
      expect(saveFile).toHaveBeenCalledWith("main.tex");
      expect(useProposedChangesStore.getState().changes).toHaveLength(0);
    });
  });

  describe("getChangeForFile", () => {
    it("returns the change for a given file path", () => {
      useProposedChangesStore.getState().addChange({
        id: "tool-1",
        filePath: "main.tex",
        absolutePath: "/project/main.tex",
        oldContent: "a",
        newContent: "b",
        toolName: "Edit",
      });
      const change = useProposedChangesStore
        .getState()
        .getChangeForFile("main.tex");
      expect(change).toBeDefined();
      expect(change!.id).toBe("tool-1");
    });

    it("returns undefined for unknown file", () => {
      const change = useProposedChangesStore
        .getState()
        .getChangeForFile("nonexistent.tex");
      expect(change).toBeUndefined();
    });
  });
});
