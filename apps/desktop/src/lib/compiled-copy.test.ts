import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "@tauri-apps/plugin-fs";
import {
  fullPath,
  keptPath,
  saveCompiledCopy,
  setCompiledCopy,
} from "./compiled-copy";

const files = new Map<string, string>();
beforeEach(() => {
  files.clear();
  vi.mocked(fs.exists).mockImplementation(async (p) =>
    [...files.keys()].some(
      (f) => f === String(p) || f.startsWith(`${String(p)}/`),
    ),
  );
  vi.mocked(fs.readTextFile).mockImplementation(async (p) => {
    const t = files.get(String(p));
    if (t === undefined) throw new Error("missing");
    return t;
  });
  vi.mocked(fs.writeTextFile).mockImplementation(async (p, t) => {
    files.set(String(p), String(t));
  });
  vi.mocked(fs.mkdir).mockImplementation(async () => {});
  (fs as unknown as { writeFile: unknown }).writeFile = vi.fn(
    async (p: string) => {
      files.set(String(p), "PDF");
    },
  );
});

describe("the compiled PDF's copy", () => {
  it("is kept relative to the project when it's inside it", () => {
    expect(keptPath("/p/Thesis", "/p/Thesis/out/Raga.pdf")).toBe(
      "out/Raga.pdf",
    );
    expect(keptPath("/p/Thesis", "/Users/me/Desktop/Raga.pdf")).toBe(
      "/Users/me/Desktop/Raga.pdf",
    );
    expect(fullPath("/p/Thesis", "out/Raga.pdf")).toBe(
      "/p/Thesis/out/Raga.pdf",
    );
    expect(fullPath("/p/Thesis", "C:/x/Raga.pdf")).toBe("C:/x/Raga.pdf");
  });

  it("is written after a compile of its file, not of another", async () => {
    files.set("/p/Thesis/main.tex", "x");
    await setCompiledCopy("/p/Thesis", {
      source: "main.tex",
      path: "out/Raga.pdf",
    });
    await saveCompiledCopy("/p/Thesis", "chapter.tex", new Uint8Array([1]));
    expect(files.has("/p/Thesis/out/Raga.pdf")).toBe(false);
    await saveCompiledCopy("/p/Thesis", "main.tex", new Uint8Array([1]));
    expect(files.has("/p/Thesis/out/Raga.pdf")).toBe(true);
    expect(files.get("/p/Thesis/.latex4all/project.json")).toContain(
      "Raga.pdf",
    );
  });

  it("isn't written to a folder outside the project that isn't there", async () => {
    files.set("/q/main.tex", "x");
    await setCompiledCopy("/q", {
      source: "main.tex",
      path: "/elsewhere/A.pdf",
    });
    await saveCompiledCopy("/q", "main.tex", new Uint8Array([1]));
    expect(files.has("/elsewhere/A.pdf")).toBe(false);
  });
});
