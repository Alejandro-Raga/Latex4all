import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "@/stores/project-store";

const store = () => useProjectStore.getState();

describe("useProjectStore", () => {
  beforeEach(() => {
    // Reset the store between tests
    useProjectStore.setState({
      recentProjects: [],
      lastProjectFolder: null,
      favorites: [],
      addedAt: {},
      projectTypes: {},
    });
  });

  describe("addRecentProject", () => {
    it("adds a project with extracted name", () => {
      useProjectStore.getState().addRecentProject("/Users/dev/my-thesis");
      const { recentProjects } = useProjectStore.getState();
      expect(recentProjects).toHaveLength(1);
      expect(recentProjects[0].path).toBe("/Users/dev/my-thesis");
      expect(recentProjects[0].name).toBe("my-thesis");
    });

    it("moves duplicate to front and deduplicates", () => {
      const store = useProjectStore.getState();
      store.addRecentProject("/a");
      store.addRecentProject("/b");
      store.addRecentProject("/a");
      const { recentProjects } = useProjectStore.getState();
      expect(recentProjects).toHaveLength(2);
      expect(recentProjects[0].path).toBe("/a");
      expect(recentProjects[1].path).toBe("/b");
    });

    it("normalizes trailing separators when deduplicating", () => {
      const store = useProjectStore.getState();
      store.addRecentProject("C:\\Projects\\Latex4All\\paper\\");
      store.addRecentProject("C:\\Projects\\Latex4All\\paper");
      const { recentProjects } = useProjectStore.getState();
      expect(recentProjects).toHaveLength(1);
      expect(recentProjects[0]).toMatchObject({
        path: "C:\\Projects\\Latex4All\\paper",
        name: "paper",
      });
    });

    it("limits to MAX_RECENT (10) entries", () => {
      const store = useProjectStore.getState();
      for (let i = 0; i < 12; i++) {
        store.addRecentProject(`/project-${i}`);
      }
      const { recentProjects } = useProjectStore.getState();
      expect(recentProjects).toHaveLength(10);
      // Most recent should be first
      expect(recentProjects[0].path).toBe("/project-11");
    });

    it("extracts name from path correctly", () => {
      useProjectStore.getState().addRecentProject("/a/b/c/deep-folder");
      expect(useProjectStore.getState().recentProjects[0].name).toBe(
        "deep-folder",
      );
    });

    it("uses full path as name if no segments", () => {
      useProjectStore.getState().addRecentProject("standalone");
      expect(useProjectStore.getState().recentProjects[0].name).toBe(
        "standalone",
      );
    });
  });

  describe("removeRecentProject", () => {
    it("removes a project by path", () => {
      const store = useProjectStore.getState();
      store.addRecentProject("/a");
      store.addRecentProject("/b");
      store.removeRecentProject("/a");
      const { recentProjects } = useProjectStore.getState();
      expect(recentProjects).toHaveLength(1);
      expect(recentProjects[0].path).toBe("/b");
    });
  });

  describe("renameRecentProject", () => {
    it("replaces the old recent project path with the new folder path", () => {
      const store = useProjectStore.getState();
      store.addRecentProject("/work/old");
      store.addRecentProject("/work/other");
      store.renameRecentProject("/work/old", "/work/new");

      const { recentProjects } = useProjectStore.getState();
      expect(recentProjects[0]).toMatchObject({
        path: "/work/new",
        name: "new",
      });
      expect(
        recentProjects.some((project) => project.path === "/work/old"),
      ).toBe(false);
      expect(
        recentProjects.some((project) => project.path === "/work/other"),
      ).toBe(true);
    });

    it("matches renamed paths even when the old recent path has a trailing slash", () => {
      const store = useProjectStore.getState();
      store.addRecentProject("/work/old/");
      store.renameRecentProject("/work/old", "/work/new/");

      const { recentProjects } = useProjectStore.getState();
      expect(recentProjects).toHaveLength(1);
      expect(recentProjects[0]).toMatchObject({
        path: "/work/new",
        name: "new",
      });
    });
  });

  describe("the recent cap", () => {
    it("never drops a favourite, however long since it was opened", () => {
      // The whole point of a star: it is the project you always want to see.
      store().addRecentProject("/keep");
      store().toggleFavorite("/keep");
      for (let i = 0; i < 20; i++) store().addRecentProject(`/p${i}`);

      const paths = store().recentProjects.map((p) => p.path);
      expect(paths).toContain("/keep");
      // Favourites sit outside the cap rather than eating into it.
      expect(paths.filter((p) => p !== "/keep")).toHaveLength(10);
    });

    it("lets an un-starred project fall past the cap again", () => {
      store().addRecentProject("/old");
      store().toggleFavorite("/old");
      for (let i = 0; i < 15; i++) store().addRecentProject(`/p${i}`);
      expect(store().recentProjects.map((p) => p.path)).toContain("/old");

      store().toggleFavorite("/old");
      expect(store().recentProjects.map((p) => p.path)).not.toContain("/old");
    });
  });

  describe("addedAt", () => {
    it("records when a project was first seen", () => {
      store().addRecentProject("/a");
      expect(store().addedAt["/a"]).toBeGreaterThan(0);
    });

    it("does not move when the project is reopened", () => {
      // Reopening is not re-adding; sorting by date added must stay stable.
      store().addRecentProject("/a");
      const first = store().addedAt["/a"];
      store().addRecentProject("/a");
      expect(store().addedAt["/a"]).toBe(first);
    });
  });

  describe("removing", () => {
    it("forgets the star and the type too", () => {
      // Otherwise re-adding the folder later brings back a star nobody set.
      store().addRecentProject("/a");
      store().toggleFavorite("/a");
      store().cacheProjectType("/a", "Thesis");

      store().removeRecentProject("/a");

      expect(store().favorites).not.toContain("/a");
      expect(store().projectTypes["/a"]).toBeUndefined();
      expect(store().addedAt["/a"]).toBeUndefined();
    });
  });

  describe("renaming", () => {
    it("carries the star, type and added date to the new path", () => {
      store().addRecentProject("/old");
      store().toggleFavorite("/old");
      store().cacheProjectType("/old", "Article");
      const added = store().addedAt["/old"];

      store().renameRecentProject("/old", "/new");

      expect(store().favorites).toEqual(["/new"]);
      expect(store().projectTypes["/new"]).toBe("Article");
      expect(store().projectTypes["/old"]).toBeUndefined();
      expect(store().addedAt["/new"]).toBe(added);
    });
  });

  describe("type cache", () => {
    it("clears the entry when the type is removed", () => {
      store().cacheProjectType("/a", "Poster");
      store().cacheProjectType("/a", null);
      expect(store().projectTypes["/a"]).toBeUndefined();
    });

    it("ignores a trailing slash, as the rest of the store does", () => {
      store().addRecentProject("/a/");
      store().toggleFavorite("/a");
      expect(store().favorites).toEqual(["/a"]);
    });
  });
});
