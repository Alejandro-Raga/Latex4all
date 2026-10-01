import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/stores/document-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { useZoteroLibrary } from "./zotero-library";
import { addCitekeysToZotero, projectTag } from "./zotero-upload";

const BIB = `@article{collab2021,
  title = {A paper only my collaborator had},
  author = {Doe, Jane},
  year = {2021},
}`;

describe("adding a collaborator's references to Zotero", () => {
  let posted: Record<string, unknown>[] = [];
  beforeEach(() => {
    posted = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        posted = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({ successful: { "0": { key: "NEWITEM1" } } }),
        );
      }),
    );
    vi.spyOn(useZoteroLibrary.getState(), "sync").mockResolvedValue();
    useDocumentStore.setState({
      projectRoot: "/Users/me/Papers/Science Policy",
      files: [
        {
          id: "refs.bib",
          name: "refs.bib",
          relativePath: "refs.bib",
          type: "bib",
          content: BIB,
        },
      ],
    } as never);
    useZoteroStore.setState({
      apiKey: "k",
      userID: "1",
      syncedCollections: {
        "/Users/me/Papers/Science Policy": {
          COLL1: {
            collectionKey: "COLL1",
            name: "Policy",
            bibFileName: "refs.bib",
            libraryVersion: 1,
            keyMap: {},
          },
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const keyMap = () =>
    useZoteroStore.getState().syncedCollections[
      "/Users/me/Papers/Science Policy"
    ].COLL1.keyMap;

  it("tags it with the project and puts it in the chosen collection", async () => {
    const { added } = await addCitekeysToZotero(["collab2021"], {
      collection: "OTHER",
    });
    expect(added.get("collab2021")).toBe("NEWITEM1");
    expect(posted[0]).toMatchObject({
      itemType: "journalArticle",
      title: "A paper only my collaborator had",
      tags: [{ tag: "from: Science Policy" }],
      collections: ["OTHER"],
    });
    // Not in the synced collection: its next sync mustn't think it's gone.
    expect(keyMap()).toEqual({});
  });

  it("keeps the key when it goes into the synced collection", async () => {
    await addCitekeysToZotero(["collab2021"]);
    expect(posted[0].collections).toEqual(["COLL1"]);
    expect(keyMap()).toEqual({ NEWITEM1: "collab2021" });
  });

  it("goes nowhere in particular when no collection is picked", async () => {
    await addCitekeysToZotero(["collab2021"], { collection: null });
    expect(posted[0].collections).toBeUndefined();
  });

  it("says when a key has no entry to make it from", async () => {
    const { failed } = await addCitekeysToZotero(["nowhere2020"]);
    expect(failed.get("nowhere2020")).toBe("not in the bibliography");
  });

  it("names the tag after the project folder", () => {
    expect(projectTag("C:\\Work\\Thesis\\")).toBe("from: Thesis");
    expect(projectTag(null)).toBe("from: Latex4All");
  });
});
