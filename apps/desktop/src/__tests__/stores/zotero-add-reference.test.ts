import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real `extractCitekey` (the parsing under test) and stub only the
// network call.
vi.mock("@/lib/zotero-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/zotero-api")>();
  return { ...actual, fetchItemBibtex: vi.fn() };
});

vi.mock("@/lib/tauri/fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri/fs")>();
  return {
    ...actual,
    createFileOnDisk: vi.fn(),
    readTexFileContent: vi.fn(),
  };
});

vi.mock("@/stores/document-store", () => ({
  useDocumentStore: { getState: vi.fn() },
}));

import { fetchItemBibtex } from "@/lib/zotero-api";
import { createFileOnDisk, readTexFileContent } from "@/lib/tauri/fs";
import { useDocumentStore } from "@/stores/document-store";
import { useZoteroStore } from "@/stores/zotero-store";

const BIBTEX = `@article{smith2020widgets,
  title = {On Widgets},
  author = {Smith, Jane},
  year = {2020}
}`;

interface FakeFile {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  content?: string;
}

function mockDocumentStore(
  files: FakeFile[],
  projectRoot: string | null = "/proj",
) {
  const state = {
    projectRoot,
    files,
    updateFileContent: vi.fn(),
    saveFile: vi.fn(() => Promise.resolve()),
    addFile: vi.fn(),
  };
  vi.mocked(useDocumentStore.getState).mockReturnValue(state as never);
  return state;
}

function bibFile(overrides: Partial<FakeFile> = {}): FakeFile {
  return {
    id: "references.bib",
    name: "references.bib",
    relativePath: "references.bib",
    absolutePath: "/proj/references.bib",
    content: "",
    ...overrides,
  };
}

describe("addItemToBib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useZoteroStore.setState({
      apiKey: "key",
      userID: "42",
      isAuthenticated: true,
    });
    vi.mocked(fetchItemBibtex).mockResolvedValue(BIBTEX);
  });

  it("appends the entry to an existing .bib file and saves it", async () => {
    const doc = mockDocumentStore([
      bibFile({ content: "@book{existing2010, title = {Old}}\n" }),
    ]);

    const result = await useZoteroStore
      .getState()
      .addItemToBib("ITEM1", "references.bib");

    expect(result).toEqual({
      status: "added",
      citekey: "smith2020widgets",
      fileName: "references.bib",
    });

    const written = doc.updateFileContent.mock.calls[0][1] as string;
    // Existing entry preserved, new one appended, separated by a blank line.
    expect(written).toContain("@book{existing2010");
    expect(written).toContain("@article{smith2020widgets");
    expect(written).toContain("}\n\n@article{");
    expect(written.endsWith("\n")).toBe(true);
    // Written straight through rather than left to the 2s autosave timer.
    expect(doc.saveFile).toHaveBeenCalledWith("references.bib");
  });

  it("writes into an empty .bib without a leading blank line", async () => {
    const doc = mockDocumentStore([bibFile({ content: "" })]);

    await useZoteroStore.getState().addItemToBib("ITEM1", "references.bib");

    const written = doc.updateFileContent.mock.calls[0][1] as string;
    expect(written.startsWith("@article{")).toBe(true);
  });

  it("reports a duplicate instead of adding the entry twice", async () => {
    const doc = mockDocumentStore([bibFile({ content: BIBTEX })]);

    const result = await useZoteroStore
      .getState()
      .addItemToBib("ITEM1", "references.bib");

    expect(result).toEqual({
      status: "duplicate",
      citekey: "smith2020widgets",
      fileName: "references.bib",
    });
    expect(doc.updateFileContent).not.toHaveBeenCalled();
    expect(doc.saveFile).not.toHaveBeenCalled();
  });

  it("falls back to disk for a file whose content was never loaded", async () => {
    const doc = mockDocumentStore([bibFile({ content: undefined })]);
    vi.mocked(readTexFileContent).mockResolvedValue(
      "@book{ondisk1999, title = {Disk}}\n",
    );

    await useZoteroStore.getState().addItemToBib("ITEM1", "references.bib");

    expect(readTexFileContent).toHaveBeenCalledWith("/proj/references.bib");
    const written = doc.updateFileContent.mock.calls[0][1] as string;
    // The on-disk entry must survive — this is the data-loss case.
    expect(written).toContain("@book{ondisk1999");
    expect(written).toContain("@article{smith2020widgets");
  });

  it("creates references.bib when the project has none", async () => {
    const doc = mockDocumentStore([]);
    vi.mocked(createFileOnDisk).mockResolvedValue("/proj/references.bib");

    const result = await useZoteroStore.getState().addItemToBib("ITEM1", null);

    expect(result).toEqual({
      status: "added",
      citekey: "smith2020widgets",
      fileName: "references.bib",
    });
    expect(createFileOnDisk).toHaveBeenCalledWith(
      "/proj",
      "references.bib",
      `${BIBTEX}\n`,
    );
    // Typed as a bibliography, not as LaTeX source.
    expect(doc.addFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "references.bib", type: "bib" }),
    );
  });

  it("reuses an existing references.bib when no target is named", async () => {
    const doc = mockDocumentStore([bibFile({ content: "" })]);

    await useZoteroStore.getState().addItemToBib("ITEM1", null);

    expect(createFileOnDisk).not.toHaveBeenCalled();
    expect(doc.updateFileContent).toHaveBeenCalled();
  });

  it("errors when the named .bib file has disappeared", async () => {
    mockDocumentStore([bibFile()]);

    const result = await useZoteroStore
      .getState()
      .addItemToBib("ITEM1", "gone.bib");

    expect(result.status).toBe("error");
    expect(createFileOnDisk).not.toHaveBeenCalled();
  });

  it("errors when Zotero has no BibTeX for the item", async () => {
    const doc = mockDocumentStore([bibFile()]);
    vi.mocked(fetchItemBibtex).mockResolvedValue("");

    const result = await useZoteroStore
      .getState()
      .addItemToBib("NOTE1", "references.bib");

    expect(result.status).toBe("error");
    expect(doc.updateFileContent).not.toHaveBeenCalled();
  });

  it("surfaces a failed Zotero request rather than throwing", async () => {
    mockDocumentStore([bibFile()]);
    vi.mocked(fetchItemBibtex).mockRejectedValue(
      new Error("Invalid or expired API key"),
    );

    const result = await useZoteroStore
      .getState()
      .addItemToBib("ITEM1", "references.bib");

    expect(result).toEqual({
      status: "error",
      message: "Invalid or expired API key",
    });
  });

  it("errors when not connected to Zotero", async () => {
    mockDocumentStore([bibFile()]);
    useZoteroStore.setState({ apiKey: null, userID: null });

    const result = await useZoteroStore
      .getState()
      .addItemToBib("ITEM1", "references.bib");

    expect(result.status).toBe("error");
    expect(fetchItemBibtex).not.toHaveBeenCalled();
  });

  it("errors when no project is open", async () => {
    mockDocumentStore([], null);

    const result = await useZoteroStore
      .getState()
      .addItemToBib("ITEM1", "references.bib");

    expect(result.status).toBe("error");
  });
});
