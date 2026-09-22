import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyFileToProject: vi.fn(),
  writeBytesToProject: vi.fn(),
  exists: vi.fn(),
  findPdfAttachment: vi.fn(),
  downloadAttachmentFile: vi.fn(),
  refreshFiles: vi.fn(),
  addPendingAttachment: vi.fn(),
  projectRoot: "/project" as string | null,
  zotero: { apiKey: "key", userID: "1" } as {
    apiKey: string | null;
    userID: string | null;
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@/lib/tauri/fs", () => ({
  copyFileToProject: mocks.copyFileToProject,
  writeBytesToProject: mocks.writeBytesToProject,
  exists: mocks.exists,
}));

vi.mock("@/lib/zotero-api", () => ({
  findPdfAttachment: mocks.findPdfAttachment,
  downloadAttachmentFile: mocks.downloadAttachmentFile,
}));

vi.mock("@/stores/document-store", () => ({
  useDocumentStore: {
    getState: () => ({
      projectRoot: mocks.projectRoot,
      refreshFiles: mocks.refreshFiles,
    }),
  },
}));

vi.mock("@/stores/claude-chat-store", () => ({
  useClaudeChatStore: {
    getState: () => ({ addPendingAttachment: mocks.addPendingAttachment }),
  },
}));

vi.mock("@/stores/zotero-store", () => ({
  useZoteroStore: { getState: () => mocks.zotero },
}));

import {
  addReferencePdfToChat,
  importReferencePdf,
} from "@/lib/reference-import";

describe("importReferencePdf", () => {
  beforeEach(() => {
    for (const fn of [
      mocks.copyFileToProject,
      mocks.writeBytesToProject,
      mocks.exists,
      mocks.findPdfAttachment,
      mocks.downloadAttachmentFile,
      mocks.refreshFiles,
      mocks.addPendingAttachment,
    ]) {
      fn.mockReset();
    }
    mocks.projectRoot = "/project";
    mocks.zotero = { apiKey: "key", userID: "1" };
    mocks.exists.mockResolvedValue(false);
  });

  it("copies a PDF from another project into the reference files folder", async () => {
    mocks.copyFileToProject.mockResolvedValue("attachments/paper.pdf");

    const path = await importReferencePdf({
      kind: "file",
      absolutePath: "/other/refs/paper.pdf",
      fileName: "paper.pdf",
    });

    expect(path).toBe("attachments/paper.pdf");
    expect(mocks.copyFileToProject).toHaveBeenCalledWith(
      "/project",
      "/other/refs/paper.pdf",
      "attachments/paper.pdf",
    );
    expect(mocks.refreshFiles).toHaveBeenCalled();
  });

  it("reuses a paper already in the folder rather than copying it twice", async () => {
    mocks.exists.mockResolvedValue(true);

    const path = await importReferencePdf({
      kind: "file",
      absolutePath: "/other/refs/paper.pdf",
      fileName: "paper.pdf",
    });

    expect(path).toBe("attachments/paper.pdf");
    expect(mocks.copyFileToProject).not.toHaveBeenCalled();
  });

  it("downloads a Zotero item's PDF under its Zotero filename", async () => {
    mocks.findPdfAttachment.mockResolvedValue({
      key: "ABC",
      filename: "Smith - 2020 - Title.pdf",
      downloadable: true,
    });
    mocks.downloadAttachmentFile.mockResolvedValue(new Uint8Array([1, 2]));
    mocks.writeBytesToProject.mockResolvedValue(
      "attachments/Smith - 2020 - Title.pdf",
    );

    const path = await importReferencePdf({
      kind: "zotero",
      itemKey: "ITEM",
      title: "Title",
    });

    expect(path).toBe("attachments/Smith - 2020 - Title.pdf");
    expect(mocks.writeBytesToProject).toHaveBeenCalledWith(
      "/project",
      "attachments/Smith - 2020 - Title.pdf",
      new Uint8Array([1, 2]),
    );
  });

  it("explains a Zotero item that has no PDF stored in the cloud", async () => {
    mocks.findPdfAttachment.mockResolvedValue({
      key: "ABC",
      filename: "paper.pdf",
      downloadable: false,
    });

    await expect(
      importReferencePdf({ kind: "zotero", itemKey: "ITEM", title: "Title" }),
    ).rejects.toThrow(/Zotero cloud storage/);
    expect(mocks.writeBytesToProject).not.toHaveBeenCalled();
  });

  it("refuses when no project is open", async () => {
    mocks.projectRoot = null;

    await expect(
      importReferencePdf({
        kind: "file",
        absolutePath: "/other/refs/paper.pdf",
        fileName: "paper.pdf",
      }),
    ).rejects.toThrow(/No project is open/);
  });
});

describe("addReferencePdfToChat", () => {
  beforeEach(() => {
    mocks.copyFileToProject.mockReset();
    mocks.addPendingAttachment.mockReset();
    mocks.exists.mockResolvedValue(false);
    mocks.projectRoot = "/project";
  });

  it("imports the PDF first, then pins the project path to the composer", async () => {
    mocks.copyFileToProject.mockResolvedValue("attachments/paper.pdf");

    await addReferencePdfToChat({
      kind: "file",
      absolutePath: "/other/refs/paper.pdf",
      fileName: "paper.pdf",
    });

    expect(mocks.addPendingAttachment).toHaveBeenCalledWith({
      label: "@attachments/paper.pdf",
      filePath: "attachments/paper.pdf",
      selectedText: "[Attached file: attachments/paper.pdf (PDF)]",
    });
  });
});
