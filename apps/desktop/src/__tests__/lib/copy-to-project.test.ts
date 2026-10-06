import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "@tauri-apps/plugin-fs";
import { copyFileToProject } from "@/lib/tauri/fs";

const disk = new Map<string, Uint8Array<ArrayBuffer>>();
const bytes = (s: string) =>
  new Uint8Array(new TextEncoder().encode(s)) as Uint8Array<ArrayBuffer>;

beforeEach(() => {
  disk.clear();
  vi.mocked(fs.exists).mockImplementation(
    async (p) => disk.has(String(p)) || String(p).endsWith("/attachments"),
  );
  vi.mocked(fs.readFile).mockImplementation(async (p) => {
    const data = disk.get(String(p));
    if (!data) throw new Error("missing");
    return data;
  });
  vi.mocked(fs.copyFile).mockImplementation(async (from, to) => {
    disk.set(String(to), disk.get(String(from)) ?? new Uint8Array());
  });
});

describe("adding a file to a project", () => {
  it("reuses the same file already there instead of making a copy", async () => {
    disk.set("/src/paper.pdf", bytes("PDF"));
    disk.set("/p/attachments/paper.pdf", bytes("PDF"));
    expect(
      await copyFileToProject("/p", "/src/paper.pdf", "attachments/paper.pdf"),
    ).toBe("attachments/paper.pdf");
    expect(fs.copyFile).not.toHaveBeenCalled();
  });

  it("finds it under a numbered name too", async () => {
    disk.set("/src/paper.pdf", bytes("PDF"));
    disk.set("/p/attachments/paper.pdf", bytes("OTHER"));
    disk.set("/p/attachments/paper (2).pdf", bytes("PDF"));
    expect(
      await copyFileToProject("/p", "/src/paper.pdf", "attachments/paper.pdf"),
    ).toBe("attachments/paper (2).pdf");
  });

  it("still keeps a different file under its own name", async () => {
    disk.set("/src/paper.pdf", bytes("NEW"));
    disk.set("/p/attachments/paper.pdf", bytes("OLD"));
    expect(
      await copyFileToProject("/p", "/src/paper.pdf", "attachments/paper.pdf"),
    ).toBe("attachments/paper (1).pdf");
  });
});
