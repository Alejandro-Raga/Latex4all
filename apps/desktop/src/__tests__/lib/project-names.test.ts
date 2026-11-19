import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  isPlaceholderName,
  metaMap,
  nameFromFolder,
} from "@/lib/collab/project-doc";

describe("project names", () => {
  it("knows a fetched folder's placeholder from a name", () => {
    expect(isPlaceholderName("Shared project")).toBe(true);
    expect(isPlaceholderName("Shared project (12)")).toBe(true);
    expect(isPlaceholderName("Thesis")).toBe(false);
    expect(isPlaceholderName(undefined)).toBe(true);
  });
  it("never records a placeholder, and mends one from a real folder name", () => {
    const doc = new Y.Doc();
    nameFromFolder(doc, "/Users/me/Projects/Shared project (3)");
    expect(metaMap(doc).get("name")).toBeUndefined();
    metaMap(doc).set("name", "Shared project (3)");
    nameFromFolder(doc, "C:\\Users\\me\\Projects\\Research outline");
    expect(metaMap(doc).get("name")).toBe("Research outline");
    nameFromFolder(doc, "/x/Other");
    expect(metaMap(doc).get("name")).toBe("Research outline");
  });
});
