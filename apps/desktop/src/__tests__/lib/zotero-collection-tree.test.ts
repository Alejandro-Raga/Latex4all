import { describe, it, expect } from "vitest";
import type { ZoteroCollection } from "@/lib/zotero-api";
import {
  buildCollectionTree,
  collectSubtreeKeys,
} from "@/lib/zotero-collection-tree";

// Mirrors the real-world shape that caused the bug: several flat
// collections plus a multi-level nested one.
const SAMPLE: ZoteroCollection[] = [
  { key: "JOB", name: "Job Market paper", parentKey: false, itemCount: 12 },
  { key: "INNO", name: "Innovation", parentKey: false, itemCount: 2 },
  {
    key: "INNO_NIS",
    name: "National Innovation Systems",
    parentKey: "INNO",
    itemCount: 5,
  },
  {
    key: "INNO_TOPIC",
    name: "Topic Selection",
    parentKey: "INNO",
    itemCount: 3,
  },
  { key: "SCI", name: "Science and Society", parentKey: false, itemCount: 1 },
  { key: "SCI_CS", name: "Citizen Science", parentKey: "SCI", itemCount: 4 },
  { key: "SCI_CS_LEY", name: "Leyendo", parentKey: "SCI_CS", itemCount: 6 },
];

describe("buildCollectionTree", () => {
  it("nests children under their parent instead of dropping them", () => {
    const tree = buildCollectionTree(SAMPLE);
    const inno = tree.find((n) => n.key === "INNO");
    expect(inno?.children.map((c) => c.key).sort()).toEqual([
      "INNO_NIS",
      "INNO_TOPIC",
    ]);
  });

  it("supports multi-level nesting", () => {
    const tree = buildCollectionTree(SAMPLE);
    const sci = tree.find((n) => n.key === "SCI");
    const cs = sci?.children.find((n) => n.key === "SCI_CS");
    expect(cs?.children.map((c) => c.key)).toEqual(["SCI_CS_LEY"]);
    expect(cs?.children[0]?.depth).toBe(2);
  });

  it("only returns top-level collections as roots", () => {
    const tree = buildCollectionTree(SAMPLE);
    expect(tree.map((n) => n.key).sort()).toEqual(["INNO", "JOB", "SCI"]);
  });

  it("assigns depth 0 to roots and increments per level", () => {
    const tree = buildCollectionTree(SAMPLE);
    const sci = tree.find((n) => n.key === "SCI");
    expect(sci?.depth).toBe(0);
    expect(sci?.children[0]?.depth).toBe(1);
  });

  it("aggregates item counts across the whole subtree", () => {
    const tree = buildCollectionTree(SAMPLE);
    const sci = tree.find((n) => n.key === "SCI");
    // 1 (SCI) + 4 (Citizen Science) + 6 (Leyendo)
    expect(sci?.totalItemCount).toBe(11);
  });

  it("leaves a collection's own count untouched when it has no children", () => {
    const tree = buildCollectionTree(SAMPLE);
    const job = tree.find((n) => n.key === "JOB");
    expect(job?.totalItemCount).toBe(12);
  });

  it("treats a collection whose parent is missing from the list as a root", () => {
    const orphan: ZoteroCollection[] = [
      { key: "ORPHAN", name: "Orphan", parentKey: "MISSING", itemCount: 1 },
    ];
    const tree = buildCollectionTree(orphan);
    expect(tree.map((n) => n.key)).toEqual(["ORPHAN"]);
  });

  it("returns an empty array for an empty collection list", () => {
    expect(buildCollectionTree([])).toEqual([]);
  });
});

describe("collectSubtreeKeys", () => {
  it("returns just the collection itself when it has no children", () => {
    expect(collectSubtreeKeys(SAMPLE, "JOB")).toEqual(["JOB"]);
  });

  it("includes all descendants at every depth", () => {
    const keys = collectSubtreeKeys(SAMPLE, "SCI");
    expect(keys.sort()).toEqual(["SCI", "SCI_CS", "SCI_CS_LEY"]);
  });

  it("includes direct children only one level deep when that's all there is", () => {
    const keys = collectSubtreeKeys(SAMPLE, "INNO");
    expect(keys.sort()).toEqual(["INNO", "INNO_NIS", "INNO_TOPIC"]);
  });

  it("does not include unrelated collections", () => {
    const keys = collectSubtreeKeys(SAMPLE, "INNO");
    expect(keys).not.toContain("JOB");
    expect(keys).not.toContain("SCI");
  });
});
