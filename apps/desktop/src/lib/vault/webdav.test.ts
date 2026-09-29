import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerVaultSource } from "./load";
import { parseMultistatus, WebdavConflictError } from "./webdav";

const BASE = "https://cloud.example.com/seafdav/Commonplace/Commonplace";

function multistatus(
  entries: { href: string; folder?: boolean; etag?: string }[],
) {
  return `<?xml version="1.0" encoding="utf-8" ?>
<ns0:multistatus xmlns:ns0="DAV:">${entries
    .map(
      (
        e,
      ) => `<ns0:response><ns0:href>${e.href}</ns0:href><ns0:propstat><ns0:prop>
<ns0:resourcetype>${e.folder ? "<ns0:collection />" : ""}</ns0:resourcetype>
${e.etag ? `<ns0:getetag>"${e.etag}"</ns0:getetag>` : ""}
</ns0:prop><ns0:status>HTTP/1.1 200 OK</ns0:status></ns0:propstat></ns0:response>`,
    )
    .join("")}</ns0:multistatus>`;
}

const b64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe("parseMultistatus", () => {
  it("reads entries relative to the vault, whatever the XML prefix", () => {
    const xml = multistatus([
      { href: "/seafdav/Commonplace/Commonplace/Ideas/", folder: true },
      {
        href: "/seafdav/Commonplace/Commonplace/Ideas/Qu%C3%A9%20tal.md",
        etag: "e1",
      },
    ]);
    expect(parseMultistatus(xml, "/seafdav/Commonplace/Commonplace")).toEqual([
      { path: "Ideas", isFolder: true, etag: null },
      { path: "Ideas/Qué tal.md", isFolder: false, etag: '"e1"' },
    ]);
  });
});

describe("ServerVaultSource", () => {
  const files: Record<string, { text: string; etag: string }> = {};
  const gets: string[] = [];
  const mock = vi.mocked(invoke);

  beforeEach(() => {
    gets.length = 0;
    Object.assign(files, {
      "Papers/Nelson1959.md": {
        text: "---\ncitekey: Nelson1959\n---\nsee [[Idea one]]",
        etag: "p1",
      },
      "Ideas/Idea one.md": { text: "from [[Nelson1959]]", etag: "i1" },
      "Templates/Idea.md": { text: "template", etag: "t1" },
    });
    mock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd !== "vault_webdav_request") throw new Error(cmd);
      const { method, path, ifMatch, body } = args;
      if (method === "PROPFIND") {
        const dir = path.replace(/\/$/, "");
        const href = (p: string) => `/seafdav/Commonplace/Commonplace/${p}`;
        const children =
          dir === ""
            ? [
                { href: href(""), folder: true },
                { href: href(".obsidian/"), folder: true },
                { href: href("Papers/"), folder: true },
                { href: href("Ideas/"), folder: true },
                { href: href("Templates/"), folder: true },
                { href: href("ink.svg"), etag: "x" },
              ]
            : [
                { href: href(`${dir}/`), folder: true },
                ...Object.entries(files)
                  .filter(([p]) => p.startsWith(`${dir}/`))
                  .map(([p, f]) => ({
                    href: href(p.split("/").map(encodeURIComponent).join("/")),
                    etag: f.etag,
                  })),
              ];
        return { status: 207, etag: null, body: b64(multistatus(children)) };
      }
      if (method === "GET") {
        gets.push(path);
        const f = files[path];
        return f
          ? { status: 200, etag: f.etag, body: b64(f.text) }
          : { status: 404, etag: null, body: "" };
      }
      if (method === "PUT") {
        if (ifMatch && files[path]?.etag !== ifMatch)
          return { status: 412, etag: null, body: "" };
        files[path] = { text: body, etag: `${files[path]?.etag ?? "n"}+` };
        return { status: 204, etag: files[path].etag, body: "" };
      }
      throw new Error(method);
    });
  });

  it("loads notes from every folder, skipping Obsidian's own and templates", async () => {
    const source = new ServerVaultSource({ url: BASE, username: "me" });
    expect(source.label).toBe("Commonplace");
    const { notes, attachments, versions } = await source.load();
    expect(notes.map((n) => n.path).sort()).toEqual([
      "Ideas/Idea one.md",
      "Papers/Nelson1959.md",
    ]);
    expect(attachments.get("ink.svg")).toBe("ink.svg");
    expect(versions.get("Ideas/Idea one.md")).toBe('"i1"');
  });

  it("only downloads notes that changed since the last load", async () => {
    const source = new ServerVaultSource({ url: BASE, username: "me" });
    await source.load();
    gets.length = 0;
    files["Ideas/Idea one.md"] = { text: "changed", etag: "i2" };
    const { notes } = await source.load();
    expect(gets.filter((p) => !p.startsWith(".obsidian"))).toEqual([
      "Ideas/Idea one.md",
    ]);
    expect(notes.find((n) => n.name === "Idea one")?.body).toBe("changed");
  });

  it("refuses to overwrite a note changed elsewhere", async () => {
    const source = new ServerVaultSource({ url: BASE, username: "me" });
    await expect(
      source.writeNote("Ideas/Idea one.md", "mine", "stale"),
    ).rejects.toBeInstanceOf(WebdavConflictError);
    await expect(
      source.writeNote("Ideas/Idea one.md", "mine"),
    ).resolves.toBeTruthy();
    expect(files["Ideas/Idea one.md"].text).toBe("mine");
  });
});
