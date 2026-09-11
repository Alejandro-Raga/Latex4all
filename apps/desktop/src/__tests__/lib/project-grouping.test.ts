import { describe, it, expect } from "vitest";
import {
  FAVORITES_LABEL,
  groupProjects,
  typesInUse,
  type SortableProject,
} from "@/lib/project-grouping";
import { UNTYPED_LABEL } from "@/lib/project-meta";

function project(path: string, lastOpened: number): SortableProject {
  return { path, name: path, lastOpened };
}

const thesis = project("/thesis", 300);
const talk = project("/talk", 200);
const paper = project("/paper", 100);
const notes = project("/notes", 50);

const base = {
  projects: [paper, thesis, notes, talk],
  favorites: new Set<string>(),
  types: new Map<string, string>(),
  addedAt: new Map<string, number>(),
};

describe("project-grouping", () => {
  describe("without favourites or grouping", () => {
    it("is a single run of cards with no heading", () => {
      // The grid as it was before any of this existed: one group, no label.
      const groups = groupProjects({ ...base, sort: "recent" });
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBeNull();
      expect(groups[0].projects.map((p) => p.path)).toEqual([
        "/thesis",
        "/talk",
        "/paper",
        "/notes",
      ]);
    });

    it("orders by date added when asked, falling back to last opened", () => {
      // /notes was opened least recently but added most recently.
      const addedAt = new Map([["/notes", 999]]);
      const groups = groupProjects({ ...base, sort: "added", addedAt });
      expect(groups[0].projects[0].path).toBe("/notes");
    });

    it("returns nothing at all for an empty list", () => {
      expect(groupProjects({ ...base, projects: [], sort: "recent" })).toEqual(
        [],
      );
    });
  });

  describe("favourites", () => {
    it("pins them above everything", () => {
      const favorites = new Set(["/paper"]);
      const groups = groupProjects({ ...base, sort: "recent", favorites });
      expect(groups[0].label).toBe(FAVORITES_LABEL);
      expect(groups[0].projects.map((p) => p.path)).toEqual(["/paper"]);
    });

    it("does not repeat a favourite in the run below it", () => {
      // Appearing twice reads as two projects, not one that is starred.
      const favorites = new Set(["/paper"]);
      const groups = groupProjects({ ...base, sort: "recent", favorites });
      const below = groups[1].projects.map((p) => p.path);
      expect(below).not.toContain("/paper");
      expect(below).toEqual(["/thesis", "/talk", "/notes"]);
    });

    it("names the run below, which would otherwise read as more favourites", () => {
      const favorites = new Set(["/paper"]);
      const groups = groupProjects({ ...base, sort: "recent", favorites });
      expect(groups[1].label).toBe("All projects");
    });

    it("keeps them pinned when grouping by type", () => {
      const favorites = new Set(["/talk"]);
      const types = new Map([
        ["/talk", "Presentation"],
        ["/paper", "Article"],
      ]);
      const groups = groupProjects({ ...base, sort: "type", favorites, types });
      expect(groups[0].label).toBe(FAVORITES_LABEL);
      expect(groups.map((g) => g.label)).not.toContain("Presentation");
    });

    it("shows only the favourites group when everything is a favourite", () => {
      const favorites = new Set(["/paper", "/thesis", "/notes", "/talk"]);
      const groups = groupProjects({ ...base, sort: "recent", favorites });
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe(FAVORITES_LABEL);
    });
  });

  describe("ordering by date created", () => {
    it("puts the newest folder first", () => {
      const createdAt = new Map([
        ["/paper", 900],
        ["/thesis", 100],
        ["/talk", 500],
        ["/notes", 300],
      ]);
      const groups = groupProjects({ ...base, sort: "created", createdAt });
      expect(groups[0].projects.map((p) => p.path)).toEqual([
        "/paper",
        "/talk",
        "/notes",
        "/thesis",
      ]);
    });

    it("falls back for a folder not read from disk yet", () => {
      // Created dates arrive asynchronously. A project still waiting on its
      // stat should sit where its other timestamps put it, not jump to an end.
      const createdAt = new Map([["/notes", 900]]);
      const addedAt = new Map([["/paper", 800]]);
      const groups = groupProjects({
        ...base,
        sort: "created",
        createdAt,
        addedAt,
      });
      expect(groups[0].projects.map((p) => p.path)).toEqual([
        "/notes",
        "/paper",
        "/thesis",
        "/talk",
      ]);
    });

    it("works with no created dates at all", () => {
      const groups = groupProjects({ ...base, sort: "created" });
      expect(groups[0].projects).toHaveLength(4);
    });
  });

  describe("grouping by type", () => {
    const types = new Map([
      ["/thesis", "Thesis"],
      ["/talk", "Presentation"],
      ["/paper", "Article"],
    ]);

    it("makes one group per type, alphabetically", () => {
      const groups = groupProjects({ ...base, sort: "type", types });
      expect(groups.map((g) => g.label)).toEqual([
        "Article",
        "Presentation",
        "Thesis",
        UNTYPED_LABEL,
      ]);
    });

    it("puts untyped projects last, not alphabetically", () => {
      // "No type" would sort between "Book" and "Presentation" on its letters.
      const groups = groupProjects({ ...base, sort: "type", types });
      expect(groups[groups.length - 1].label).toBe(UNTYPED_LABEL);
      expect(groups[groups.length - 1].projects.map((p) => p.path)).toEqual([
        "/notes",
      ]);
    });

    it("keeps custom types beside the suggested ones", () => {
      const custom = new Map(types).set("/notes", "Referee report");
      const groups = groupProjects({ ...base, sort: "type", types: custom });
      expect(groups.map((g) => g.label)).toEqual([
        "Article",
        "Presentation",
        "Referee report",
        "Thesis",
      ]);
    });

    it("orders within a group by the chosen sort", () => {
      const shared = new Map([
        ["/thesis", "Article"],
        ["/paper", "Article"],
      ]);
      const groups = groupProjects({ ...base, sort: "type", types: shared });
      expect(groups[0].projects.map((p) => p.path)).toEqual([
        "/thesis",
        "/paper",
      ]);
    });

    it("gives every group a key distinct from its label", () => {
      const groups = groupProjects({ ...base, sort: "type", types });
      const keys = groups.map((g) => g.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe("typesInUse", () => {
    it("de-duplicates and sorts", () => {
      const types = new Map([
        ["/a", "Thesis"],
        ["/b", "Article"],
        ["/c", "Article"],
      ]);
      expect(typesInUse(types)).toEqual(["Article", "Thesis"]);
    });

    it("is empty when nothing is typed", () => {
      expect(typesInUse(new Map())).toEqual([]);
    });
  });
});
