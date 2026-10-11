import { beforeEach, describe, expect, it } from "vitest";
import { runSync, type SyncConfig, type SyncState } from "./engine";
import type { Cache, Item } from "./model";

const paper = (key: string, extra: Record<string, unknown> = {}): Item => ({
  key,
  data: {
    key,
    itemType: "journalArticle",
    title: `Paper ${key}`,
    date: "2020",
    creators: [
      {
        creatorType: "author",
        firstName: "Ann",
        lastName: `Author${key.slice(-1)}`,
      },
    ],
    tags: [],
    ...extra,
  },
});
const pdf = (key: string, parent: string): Item => ({
  key,
  data: {
    key,
    itemType: "attachment",
    parentItem: parent,
    contentType: "application/pdf",
    title: "PDF",
  },
});
const highlight = (
  key: string,
  parent: string,
  extra: Record<string, unknown> = {},
): Item => ({
  key,
  data: {
    key,
    itemType: "annotation",
    parentItem: parent,
    annotationType: "highlight",
    annotationText: `Text of ${key}`,
    annotationComment: "",
    annotationSortIndex: "00001|000001|00010",
    annotationPosition: '{"pageIndex":0,"rects":[[1,1,2,2]]}',
    dateModified: "2020-01-01T00:00:00Z",
    tags: [],
    ...extra,
  },
});

let files: Map<string, string>;
let library: Item[];
const store = {
  read: async (p: string) => files.get(p) ?? null,
  list: async (dir: string) =>
    [...files.keys()]
      .filter(
        (p) =>
          p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"),
      )
      .map((p) => p.slice(dir.length + 1)),
  listAll: async () => [...files.keys()],
  write: async (p: string, t: string) => void files.set(p, t),
};
let version = 1;
const zot = {
  itemsSince: async () => ({ items: library, version: ++version }),
  deletedSince: async () => [],
};
const cfg: SyncConfig = {
  papersDir: "Papers",
  ideasDir: "Ideas",
  topicsDir: "Topics",
  forceTag: "obsidian",
  today: "2026-10-11",
  now: new Date("2026-10-11T12:00:00Z"),
};

describe("the sync over time", () => {
  let state: SyncState;
  let cache: Cache;
  beforeEach(() => {
    files = new Map();
    state = { version: 0, paths: {} };
    cache = new Map();
    library = [
      paper("PAPER001", { tags: [{ tag: "obsidian" }] }),
      pdf("PDF00001", "PAPER001"),
      highlight("ANN00001", "PDF00001", { tags: [{ tag: "topic: Science" }] }),
    ];
  });

  it("gives a paper with the vault tag a note, and a topic its note", async () => {
    await runSync(store, zot, state, cache, cfg);
    expect(files.get("Papers/Author2020.md")).toContain("> Text of ANN00001");
    expect(files.get("Topics/Science.md")).toContain("## Passages");
    expect(files.get("Papers/Author2020.md")).toContain("Topics: [[Science]]");
  });

  it("doesn't bring back a topic note deleted in Obsidian", async () => {
    await runSync(store, zot, state, cache, cfg);
    files.delete("Topics/Science.md");
    library = [
      highlight("ANN00001", "PDF00001", {
        tags: [{ tag: "topic: Science" }],
        dateModified: "2021-01-01T00:00:00Z",
      }),
    ];
    await runSync(store, zot, state, cache, { ...cfg, rebuild: true });
    expect(files.has("Topics/Science.md")).toBe(false);
  });

  it("follows a topic note renamed in Obsidian", async () => {
    await runSync(store, zot, state, cache, cfg);
    files.set(
      "Topics/Science of science.md",
      files.get("Topics/Science.md") as string,
    );
    files.delete("Topics/Science.md");
    library = [
      highlight("ANN00002", "PDF00001", { tags: [{ tag: "topic: Science" }] }),
    ];
    await runSync(store, zot, state, cache, cfg);
    expect(files.has("Topics/Science.md")).toBe(false);
    expect(files.get("Topics/Science of science.md")).toContain(
      "Text of ANN00002",
    );
  });

  it("makes an idea note from a highlight tagged idea, following its comment until edited", async () => {
    library = [
      paper("PAPER001"),
      pdf("PDF00001", "PAPER001"),
      highlight("ANN00001", "PDF00001", {
        tags: [{ tag: "idea" }],
        annotationComment: "Firms learn at conferences",
      }),
    ];
    await runSync(store, zot, state, cache, cfg);
    const path = "Ideas/Firms learn at conferences.md";
    expect(files.get(path)).toContain("Firms learn at conferences");
    expect(files.get("Papers/Author2020.md")).toContain(
      "💡 [[Firms learn at conferences]]",
    );
    // The comment changes in Zotero: the note follows.
    library = [
      highlight("ANN00001", "PDF00001", {
        tags: [{ tag: "idea" }],
        annotationComment: "Firms learn at conferences, a lot",
      }),
    ];
    await runSync(store, zot, state, cache, cfg);
    expect(files.get(path)).toContain("a lot");
    // Edited in Obsidian: it's yours, and stays as you wrote it.
    files.set(path, `${files.get(path)}\nMy own thoughts.\n`);
    library = [
      highlight("ANN00001", "PDF00001", {
        tags: [{ tag: "idea" }],
        annotationComment: "Changed again",
      }),
    ];
    await runSync(store, zot, state, cache, cfg);
    expect(files.get(path)).toContain("My own thoughts.");
    expect(files.get(path)).not.toContain("Changed again");
  });

  it("keeps a paper's note when its vault tag is removed", async () => {
    await runSync(store, zot, state, cache, cfg);
    library = [paper("PAPER001", { tags: [] })];
    await runSync(store, zot, state, cache, cfg);
    expect(files.has("Papers/Author2020.md")).toBe(true);
  });

  it("files highlights under a type of your own, and a note paired with a tag", async () => {
    library = [
      paper("PAPER001"),
      pdf("PDF00001", "PAPER001"),
      highlight("ANN00001", "PDF00001", {
        tags: [{ tag: "method: Diff-in-diff" }],
      }),
      highlight("ANN00002", "PDF00001", { tags: [{ tag: "Network theory" }] }),
    ];
    files.set(
      "Topics/Network theory.md",
      '---\nzotero_tag: "Network theory"\n---\nMine.\n',
    );
    await runSync(store, zot, state, cache, {
      ...cfg,
      custom: [
        {
          kind: "type-m",
          word: "method",
          label: "Method",
          dir: "Methods",
          kindTag: "method",
        },
      ],
      paired: [
        {
          tag: "Network theory",
          path: "Topics/Network theory.md",
          label: "Topics",
        },
      ],
    });
    expect(files.get("Methods/Diff-in-diff.md")).toContain("Text of ANN00001");
    expect(files.get("Methods/Diff-in-diff.md")).toContain("zotero_method:");
    expect(files.get("Topics/Network theory.md")).toContain("Mine.");
    expect(files.get("Topics/Network theory.md")).toContain("Text of ANN00002");
    expect(files.get("Papers/Author2020.md")).toContain(
      "Method: [[Diff-in-diff]]",
    );
  });
});
