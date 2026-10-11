import { describe, expect, it } from "vitest";
import type { ZoteroCollection } from "@/lib/zotero-api";
import { paperFolderTree, UNFILED_KEY } from "./paper-folders";
import type { VaultNote } from "./vault-index";

const paper = (name: string, zoteroKey: string | null) =>
  ({ name, zoteroKey }) as VaultNote;

const collections: ZoteroCollection[] = [
  { key: "FIRMS", name: "Science & Firms", parentKey: false, itemCount: 3 },
  { key: "DUKE", name: "Duke School", parentKey: "FIRMS", itemCount: 1 },
  { key: "CLASS", name: "Classics", parentKey: "FIRMS", itemCount: 0 },
  { key: "METH", name: "Methods", parentKey: false, itemCount: 2 },
  { key: "CAUSAL", name: "Causal Inference", parentKey: "METH", itemCount: 1 },
  { key: "NET", name: "Networks", parentKey: false, itemCount: 9 },
];

const library: Record<string, string[]> = {
  STARS: ["FIRMS", "CAUSAL"],
  DECLINE: ["DUKE"],
  LOOSE: [],
};

const tree = (notes: VaultNote[]) =>
  paperFolderTree(notes, collections, (k) => library[k] ?? null);

describe("papers in their Zotero folders", () => {
  it("shows only folders holding a vault paper, and the folders above them", () => {
    const roots = tree([
      paper("Like Stars", "STARS"),
      paper("Decline", "DECLINE"),
    ]);
    expect(roots.map((r) => r.name)).toEqual(["Methods", "Science & Firms"]);
    const firms = roots[1];
    expect(firms.folders.map((f) => f.name)).toEqual(["Duke School"]);
    expect(roots[0].folders.map((f) => f.name)).toEqual(["Causal Inference"]);
  });

  it("lists a paper in every folder it's in, and counts it once per branch", () => {
    const roots = tree([
      paper("Like Stars", "STARS"),
      paper("Decline", "DECLINE"),
    ]);
    const [methods, firms] = roots;
    expect(firms.notes.map((n) => n.name)).toEqual(["Like Stars"]);
    expect(methods.folders[0].notes.map((n) => n.name)).toEqual(["Like Stars"]);
    expect(firms.count).toBe(2);
    expect(methods.count).toBe(1);
  });

  it("puts papers in no folder, unknown to Zotero or not from it under Unfiled, last", () => {
    const roots = tree([
      paper("Like Stars", "STARS"),
      paper("Loose", "LOOSE"),
      paper("Not in library", "GONE0000"),
      paper("Own note", null),
    ]);
    const last = roots[roots.length - 1];
    expect(last.key).toBe(UNFILED_KEY);
    expect(last.notes.map((n) => n.name)).toEqual([
      "Loose",
      "Not in library",
      "Own note",
    ]);
  });

  it("has no folders at all without Zotero", () => {
    const roots = paperFolderTree([paper("A", null)], [], () => null);
    expect(roots).toHaveLength(1);
    expect(roots[0].key).toBe(UNFILED_KEY);
  });
});
