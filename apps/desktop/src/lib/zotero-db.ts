/**
 * The last resort, when neither the Zotero app nor zotero.org answers (and
 * Settings → Zotero allows it): Zotero's own database on this computer, read
 * from a copy. It answers the same reads as zotero.org's API, with items in
 * the same shape. Only reads: saving to Zotero waits for the app or
 * zotero.org. BibTeX isn't in the database, so it comes from the library
 * copy, which keeps it while this is on.
 */
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

interface DbItem {
  key: string;
  version: number;
  data: Record<string, unknown> & {
    itemType: string;
    parentItem?: string;
    collections?: string[];
    deleted?: number;
    title?: string;
    date?: string;
    creators?: { lastName?: string; firstName?: string; name?: string }[];
  };
}

interface DbLibrary {
  version: number;
  items: DbItem[];
  collections: {
    key: string;
    name: string;
    parent: string | null;
    items: number;
  }[];
}

const KEEP_MS = 30_000;
let read: { library: Promise<DbLibrary>; at: number } | null = null;

/** The database as of the last 30 s (reading it takes a moment). */
function library(): Promise<DbLibrary> {
  if (!read || Date.now() - read.at > KEEP_MS) {
    const library = invoke<DbLibrary>("zotero_db_read");
    read = { library, at: Date.now() };
    library.catch(() => {
      read = null;
    });
  }
  return read.library;
}

async function bibtexOf(key: string): Promise<string | undefined> {
  const { useZoteroLibrary } = await import("./zotero-library");
  return useZoteroLibrary.getState().mirror?.items[key]?.bibtex;
}

function json(body: unknown, version: number, total?: number): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Last-Modified-Version": String(version),
  };
  if (total !== undefined) headers["Total-Results"] = String(total);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/** Zotero's quick search ("titleCreatorYear"): every word in one of those. */
function matches(item: DbItem, q: string): boolean {
  const d = item.data;
  const haystack = [
    d.title ?? "",
    d.date ?? "",
    ...(d.creators ?? []).flatMap((c) => [
      c.lastName ?? "",
      c.firstName ?? "",
      c.name ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** A page of items, as the API sends it (25 unless `limit` says otherwise). */
async function page(
  items: DbItem[],
  params: URLSearchParams,
  version: number,
): Promise<Response> {
  const start = Number(params.get("start") ?? 0);
  const limit = Number(params.get("limit") ?? 25);
  const slice = items.slice(start, start + limit);
  const include = (params.get("include") ?? "data").split(",");
  const body = await Promise.all(
    slice.map(async (item) => ({
      key: item.key,
      version: item.version,
      library: { type: "user" },
      ...(include.includes("data") || !params.has("include")
        ? { data: item.data }
        : {}),
      ...(include.includes("bibtex")
        ? { bibtex: (await bibtexOf(item.key)) ?? "" }
        : {}),
    })),
  );
  return json(body, version, items.length);
}

const NOTICE_EVERY_MS = 10 * 60_000;
let noticed = 0;

/** Says, now and then, that what's shown comes from the database. */
function notice() {
  if (Date.now() - noticed < NOTICE_EVERY_MS) return;
  noticed = Date.now();
  toast.warning("Zotero can't be reached", {
    description:
      "Showing your library from Zotero's database on this computer. Saving to Zotero is paused until Zotero or zotero.org is back.",
  });
}

/**
 * Answers a read zotero.org would answer (a path under /users/<id>/) from
 * Zotero's database.
 */
export async function databaseResponse(path: string): Promise<Response> {
  const url = new URL(`http://zotero${path}`);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "users") return notFound();
  const route = parts.slice(2);
  const params = url.searchParams;
  const lib = await library();
  notice();

  if (route.length === 1 && route[0] === "collections") {
    const all = lib.collections.map((c) => ({
      key: c.key,
      version: lib.version,
      data: { key: c.key, name: c.name, parentCollection: c.parent ?? false },
      meta: { numItems: c.items },
    }));
    const start = Number(params.get("start") ?? 0);
    const limit = Number(params.get("limit") ?? 25);
    return json(all.slice(start, start + limit), lib.version, all.length);
  }

  const byKey = new Map(lib.items.map((i) => [i.key, i]));

  // items/<key> and items/<key>/children
  if (route[0] === "items" && route[1] && route[1] !== "top") {
    const item = byKey.get(route[1]);
    if (!item) return notFound();
    if (route.length === 2) {
      return json(
        {
          key: item.key,
          version: item.version,
          library: { type: "user" },
          data: item.data,
          ...(params.get("include")?.includes("bibtex")
            ? { bibtex: (await bibtexOf(item.key)) ?? "" }
            : {}),
        },
        lib.version,
      );
    }
    if (route.length === 3 && route[2] === "children") {
      const children = lib.items.filter(
        (i) => i.data.parentItem === item.key && !i.data.deleted,
      );
      return page(children, params, lib.version);
    }
    return notFound();
  }

  // items, items/top, collections/<key>/items(/top)
  let list: DbItem[];
  let rest: string[];
  if (route[0] === "items") {
    list = lib.items;
    rest = route.slice(1);
  } else if (route[0] === "collections" && route[2] === "items") {
    list = lib.items.filter((i) => i.data.collections?.includes(route[1]));
    rest = route.slice(3);
  } else {
    return notFound();
  }
  if (rest[0] === "top") list = list.filter((i) => !i.data.parentItem);
  else if (rest.length > 0) return notFound();

  if (params.get("includeTrashed") !== "1") {
    list = list.filter((i) => !i.data.deleted);
  }
  const type = params.get("itemType");
  if (type?.startsWith("-")) {
    list = list.filter((i) => i.data.itemType !== type.slice(1));
  } else if (type) {
    list = list.filter((i) => i.data.itemType === type);
  }
  const q = params.get("q");
  if (q) list = list.filter((i) => matches(i, q));
  return page(list, params, lib.version);
}
