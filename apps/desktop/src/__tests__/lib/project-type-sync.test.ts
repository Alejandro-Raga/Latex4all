import { describe, it, expect, vi } from "vitest";
import { syncProjectTypes } from "@/lib/project-type-sync";

function harness({
  cached = {} as Record<string, string | null>,
  disk = {} as Record<string, string | null>,
  pending = new Set<string>(),
} = {}) {
  const setCached = vi.fn((path: string, type: string | null) => {
    cached[path] = type;
  });
  return {
    cached,
    setCached,
    run: (paths: string[], readType?: (p: string) => Promise<string | null>) =>
      syncProjectTypes({
        paths,
        readType: readType ?? (async (p) => disk[p] ?? null),
        getCached: (p) => cached[p] ?? null,
        setCached,
        isPending: (p) => pending.has(p),
      }),
  };
}

describe("syncProjectTypes", () => {
  it("caches what is on disk when the cache is empty", async () => {
    const h = harness({ disk: { "/a": "Thesis" } });
    await h.run(["/a"]);
    expect(h.setCached).toHaveBeenCalledWith("/a", "Thesis");
  });

  it("does nothing when the cache already agrees", async () => {
    const h = harness({ cached: { "/a": "Thesis" }, disk: { "/a": "Thesis" } });
    await h.run(["/a"]);
    expect(h.setCached).not.toHaveBeenCalled();
  });

  it("clears the cache for a project whose type was removed on disk", async () => {
    const h = harness({ cached: { "/a": "Thesis" }, disk: {} });
    await h.run(["/a"]);
    expect(h.setCached).toHaveBeenCalledWith("/a", null);
  });

  it("leaves a path alone while its write is in flight", async () => {
    // The regression: setting a type updates the cache first and writes a
    // moment later. A sync in between reads no file yet and would "correct"
    // the cache back to nothing, so the first attempt looked like it did
    // nothing and only the second stuck.
    const pending = new Set(["/a"]);
    const h = harness({ cached: { "/a": "Article" }, disk: {}, pending });

    await h.run(["/a"]);

    expect(h.setCached).not.toHaveBeenCalled();
    expect(h.cached["/a"]).toBe("Article");
  });

  it("leaves it alone when the write starts during the read", async () => {
    // Same hazard, narrower window: the path was clear when the read began.
    const pending = new Set<string>();
    const h = harness({ cached: { "/a": "Article" }, disk: {}, pending });

    await h.run(["/a"], async () => {
      pending.add("/a");
      return null;
    });

    expect(h.setCached).not.toHaveBeenCalled();
  });

  it("still reconciles other projects while one is being written", async () => {
    const pending = new Set(["/a"]);
    const h = harness({
      cached: { "/a": "Article" },
      disk: { "/b": "Poster" },
      pending,
    });

    await h.run(["/a", "/b"]);

    expect(h.setCached).toHaveBeenCalledTimes(1);
    expect(h.setCached).toHaveBeenCalledWith("/b", "Poster");
  });

  it("copes with no projects at all", async () => {
    const h = harness();
    await expect(h.run([])).resolves.toBeUndefined();
  });
});
