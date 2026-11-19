import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  exportStore,
  importStore,
  local,
  type PathMap,
  portable,
  syncAppState,
} from "@/lib/collab/app-state-sync";

const ID = "0123456789abcdef0123456789abcdef";
const mac: PathMap = {
  roots: { [ID]: "/Users/me/Projects/Thesis" },
  home: "/Users/me",
  sep: "/",
};
const pc: PathMap = {
  roots: { [ID]: "C:\\Users\\Me\\Latex4All\\Thesis (2)" },
  home: "C:\\Users\\Me",
  sep: "\\",
};

describe("app state between linked devices", () => {
  beforeEach(() => localStorage.clear());

  it("makes paths portable and brings them back as the other device's", () => {
    const p = portable("/Users/me/Projects/Thesis/main.tex", mac);
    expect(p).toBe(`@p:${ID}/main.tex`);
    expect(local(p, pc)).toBe("C:\\Users\\Me\\Latex4All\\Thesis (2)\\main.tex");
    const v = portable("/Users/me/Seafile/Vault", mac);
    expect(v).toBe("@home/Seafile/Vault");
    expect(local(v, pc)).toBe("C:\\Users\\Me\\Seafile\\Vault");
    expect(local("@p:ffffffffffffffffffffffffffffffff", pc)).toBeNull();
    expect(portable("latex4all-workspace:/Users/me/Projects/Thesis", mac)).toBe(
      `latex4all-workspace:@p:${ID}`,
    );
  });

  it("keeps per-device fields, puts project lists together, drops unknown projects", () => {
    const macStore = JSON.stringify({
      state: {
        recentProjects: [
          { path: "/Users/me/Projects/Thesis", name: "Thesis" },
          { path: "/Users/me/Elsewhere/Only on Mac", name: "Only" },
        ],
        favorites: ["/Users/me/Projects/Thesis"],
        lastProjectFolder: "/Users/me/Projects",
        sharedProjects: { [ID]: "/Users/me/Projects/Thesis" },
      },
      version: 1,
    });
    const out = exportStore("latex4all-projects", macStore, mac) as string;
    expect(out).not.toContain("lastProjectFolder");
    const pcStore = JSON.stringify({
      state: {
        recentProjects: [{ path: "C:\\Users\\Me\\Notes", name: "Notes" }],
        favorites: [],
        lastProjectFolder: "C:\\Users\\Me\\Latex4All",
        sharedProjects: { [ID]: "C:\\Users\\Me\\Latex4All\\Thesis (2)" },
      },
      version: 1,
    });
    const merged = JSON.parse(
      importStore("latex4all-projects", out, pcStore, pc) as string,
    ).state;
    expect(merged.favorites).toEqual(["C:\\Users\\Me\\Latex4All\\Thesis (2)"]);
    expect(merged.lastProjectFolder).toBe("C:\\Users\\Me\\Latex4All");
    expect(merged.sharedProjects[ID]).toBe(
      "C:\\Users\\Me\\Latex4All\\Thesis (2)",
    );
    expect(merged.recentProjects.map((p: { name: string }) => p.name)).toEqual([
      "Thesis",
      "Only",
      "Notes",
    ]);
  });

  it("leaves out projects the other device can't find (another drive)", () => {
    const raw = JSON.stringify({
      state: {
        recentProjects: [
          { path: "/Users/me/Projects/Thesis", name: "Thesis" },
          { path: "/Volumes/USB/Old", name: "Old" },
        ],
        favorites: ["/Volumes/USB/Old", "/Users/me/Projects/Thesis"],
      },
      version: 1,
    });
    const out = JSON.parse(
      exportStore("latex4all-projects", raw, mac) as string,
    ).state;
    expect(out.recentProjects.map((p: { name: string }) => p.name)).toEqual([
      "Thesis",
    ]);
    expect(out.favorites).toEqual([`@p:${ID}`]);
  });

  it("carries a change from one device to the other through the document", () => {
    const doc = new Y.Doc();
    localStorage.setItem(
      "latex4all-settings",
      JSON.stringify({ state: { vimMode: true }, version: 0 }),
    );
    // The first device: its settings go into the library.
    const a = syncAppState(doc, {}, mac);
    expect(a.changed).toEqual([]);
    // The second device, with settings of its own: takes the library's.
    localStorage.setItem(
      "latex4all-settings",
      JSON.stringify({ state: { vimMode: false }, version: 0 }),
    );
    const b = syncAppState(doc, {}, pc);
    expect(b.changed).toContain("latex4all-settings");
    expect(
      JSON.parse(localStorage.getItem("latex4all-settings") as string).state
        .vimMode,
    ).toBe(true);
    // Changed there later: goes out, and a device in step takes it.
    localStorage.setItem(
      "latex4all-settings",
      JSON.stringify({ state: { vimMode: false, glass: "high" }, version: 0 }),
    );
    syncAppState(doc, b.known, pc);
    localStorage.setItem(
      "latex4all-settings",
      JSON.stringify({ state: { vimMode: true }, version: 0 }),
    );
    const again = syncAppState(doc, a.known, mac);
    expect(again.changed).toContain("latex4all-settings");
    expect(
      JSON.parse(localStorage.getItem("latex4all-settings") as string).state
        .glass,
    ).toBe("high");
  });
});
