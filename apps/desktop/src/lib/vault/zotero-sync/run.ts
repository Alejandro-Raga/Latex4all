/**
 * The Zotero → vault sync, run by Latex4All against your vault and library
 * (engine.ts does the work). What it remembers about the vault — which note
 * is whose, what was deleted in Obsidian — is kept in the vault itself
 * (`Latex4All/Zotero sync.md`), so every computer syncing it agrees. The
 * copy of the library it works from is kept on each computer, in the app's
 * data, with the library version it's up to date with.
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import { zoteroFetch } from "@/lib/zotero-api";
import { type ZoteroSource, withZoteroSource } from "@/lib/zotero-source";
import { useVaultStore, vaultStyle } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { papersFolderOf } from "../add-paper";
import { kindFolder } from "../kind-folders";
import { LATEX4ALL_FOLDER } from "../note-types-file";
import { KIND_GROUPS } from "../vault-index";
import { TAG_BEGIN, TAG_END, pairedTag } from "../zotero-tag-notes";
import {
  type CustomGroup,
  type PairedTag,
  runSync,
  type SyncState,
  type SyncStore,
  type SyncZotero,
} from "./engine";
import { BEGIN, type Cache, END, type Item } from "./model";

export const SYNC_STATE_PATH = `${LATEX4ALL_FOLDER}Zotero sync.md`;

const STATE_INTRO =
  "What the Zotero sync remembers about this vault: which note is whose, and what was deleted here. Latex4All keeps it; leave it as it is.";

export function syncStateFile(state: SyncState): string {
  // The library version is each computer's own (see the copy below).
  const shared = { ...state, version: 0 };
  return `${STATE_INTRO}\n\n\`\`\`json\n${JSON.stringify(shared, null, 1)}\n\`\`\`\n`;
}

export function readSyncStateFile(text: string): SyncState | null {
  const m = /```json\n([\s\S]*?)\n```/.exec(text);
  if (!m) return null;
  try {
    const state = JSON.parse(m[1]) as SyncState;
    return state && typeof state === "object" && state.paths ? state : null;
  } catch {
    return null;
  }
}

// ─── The copy of the library, on this computer ───

interface SavedCache {
  format: 1;
  userID: string;
  /** The library version the copy is up to date with, in each numbering. */
  web: number;
  local: number;
  items: [string, Item][];
  /** The setup the notes were last written for (see `run`). */
  setup?: string;
}

async function cachePath(userID: string) {
  const dir = await join(await appDataDir(), "zotero");
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return join(dir, `vault-sync-${userID}.json`);
}

let kept: SavedCache | null = null;

async function loadCache(userID: string): Promise<SavedCache> {
  if (kept?.userID === userID) return kept;
  kept = await readCache(userID);
  return kept;
}

async function readCache(userID: string): Promise<SavedCache> {
  const empty: SavedCache = { format: 1, userID, web: 0, local: 0, items: [] };
  try {
    const path = await cachePath(userID);
    if (!(await exists(path))) return empty;
    const saved = JSON.parse(await readTextFile(path)) as SavedCache;
    return saved.format === 1 && saved.userID === userID ? saved : empty;
  } catch {
    return empty;
  }
}

async function saveCache(saved: SavedCache) {
  await writeTextFile(await cachePath(saved.userID), JSON.stringify(saved));
}

// ─── Zotero and the vault, as the engine asks for them ───

function zoteroFor(
  apiKey: string,
  userID: string,
  source: ZoteroSource,
): SyncZotero {
  const get = (path: string) =>
    zoteroFetch(apiKey, `/users/${userID}${path}`, undefined, source);
  const pages = async (since: number, extra: Record<string, string>) => {
    const items: Item[] = [];
    let version = since;
    for (let start = 0; ; start += 100) {
      const params = new URLSearchParams({
        since: String(since),
        includeTrashed: "1",
        format: "json",
        limit: "100",
        start: String(start),
        ...extra,
      });
      const response = await get(`/items?${params}`);
      version = Number(
        response.headers.get("Last-Modified-Version") ?? version,
      );
      const page = (await response.json()) as Item[];
      items.push(...page.map(({ key, data }) => ({ key, data })));
      if (page.length < 100) break;
    }
    return { items, version };
  };
  return {
    async itemsSince(since) {
      const all = await pages(since, {});
      if (source !== "local") return all;
      // The Zotero app leaves highlights out unless they're asked for.
      const seen = new Set(all.items.map((i) => i.key));
      const anns = await pages(since, { itemType: "annotation" });
      return {
        items: [...all.items, ...anns.items.filter((i) => !seen.has(i.key))],
        version: Math.max(all.version, anns.version),
      };
    },
    async deletedSince(since) {
      const body = (await (await get(`/deleted?since=${since}`)).json()) as {
        items?: string[];
      };
      return body.items ?? [];
    },
  };
}

/** The vault through Latex4All: what it writes is in the vault's index at once. */
function vaultStore(): SyncStore {
  const { source } = useVaultStore.getState();
  if (!source) throw new Error("Connect your vault first.");
  const versions = new Map<string, string | null>();
  const written = new Set<string>();
  const paths = () => {
    const all = new Set(
      (useVaultStore.getState().index?.list ?? []).map((n) => n.path),
    );
    for (const p of written) all.add(p);
    return [...all];
  };
  return {
    async read(path) {
      try {
        const { text, version } = await source.readNote(path);
        versions.set(path, version);
        return text;
      } catch {
        versions.delete(path);
        return null;
      }
    },
    async list(dir) {
      const prefix = dir ? `${dir}/` : "";
      return paths()
        .filter(
          (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"),
        )
        .map((p) => p.slice(prefix.length));
    },
    async listAll() {
      return paths();
    },
    async write(path, text) {
      if (versions.has(path) || written.has(path)) {
        versions.set(
          path,
          await source.writeNote(path, text, versions.get(path)),
        );
      } else {
        await source.createNote(path, text);
      }
      written.add(path);
      if (path.endsWith(".md"))
        useVaultStore.getState().noteWritten(path, text);
    },
  };
}

// ─── The run ───

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The types of your own with a Zotero tag word, as the engine files them. */
function customGroups(): CustomGroup[] {
  return vaultStyle()
    .types.filter((t) => t.zoteroTag?.trim())
    .map((t) => {
      const word = (t.zoteroTag as string).trim();
      return {
        kind: t.id,
        word,
        label: t.label,
        dir: kindFolder(t.id) || t.label,
        kindTag: t.tag?.replace(/^#/, "").trim() || word,
      };
    });
}

/** Notes paired with a Zotero tag in the tag manager. */
function pairedTags(): PairedTag[] {
  const { index } = useVaultStore.getState();
  const custom = vaultStyle().types;
  const out: PairedTag[] = [];
  for (const n of index?.list ?? []) {
    const tag = pairedTag(n);
    if (!tag) continue;
    const label =
      custom.find((t) => t.id === n.kind)?.label ??
      KIND_GROUPS[n.kind as keyof typeof KIND_GROUPS] ??
      "Notes";
    out.push({ tag, path: n.path, label });
  }
  return out;
}

/** Notes paired by an earlier Latex4All keep their pairing, in the sync's markers. */
async function upgradePairedNotes() {
  const { source, index } = useVaultStore.getState();
  if (!source || !index) return;
  for (const n of index.list) {
    if (!pairedTag(n) || !n.body.includes(TAG_BEGIN)) continue;
    const { text, version } = await source.readNote(n.path);
    const at = text.indexOf(TAG_BEGIN);
    const end = text.indexOf(TAG_END, at);
    if (at < 0 || end < 0) continue;
    const next = `${text.slice(0, at)}${text.includes(BEGIN) ? "" : `${BEGIN}\n${END}`}${text.slice(end + TAG_END.length)}`;
    await source.writeNote(n.path, next, version);
    useVaultStore.getState().noteWritten(n.path, next);
  }
}

export interface SyncResult {
  written: number;
  at: number;
}

/** How the sync is doing, for the tag manager and Settings. */
export const useVaultSync = create<{
  running: boolean;
  last: SyncResult | null;
  error: string | null;
}>(() => ({ running: false, last: null, error: null }));

let running: Promise<SyncResult> | null = null;

/**
 * Brings the vault in step with Zotero, as the Python sync does. `rebuild`
 * writes every note again (when the vault tag or the types changed, say).
 * One run at a time; a call during a run waits for it.
 */
export function syncVaultWithZotero(
  opts: { rebuild?: boolean } = {},
): Promise<SyncResult> {
  if (running) return running;
  useVaultSync.setState({ running: true });
  running = run(opts)
    .then((last) => {
      useVaultSync.setState({ last, error: null });
      return last;
    })
    .catch((err) => {
      useVaultSync.setState({
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    })
    .finally(() => {
      running = null;
      useVaultSync.setState({ running: false });
    });
  return running;
}

async function run({ rebuild }: { rebuild?: boolean }): Promise<SyncResult> {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) throw new Error("Connect Zotero first.");
  await useVaultStore.getState().ensureVault();
  const vault = useVaultStore.getState();
  if (!vault.source || !vault.index)
    throw new Error("Connect your vault first.");
  const { source } = vault;

  await upgradePairedNotes();

  const stateFile = await source.readNote(SYNC_STATE_PATH).catch(() => null);
  const state: SyncState = (stateFile && readSyncStateFile(stateFile.text)) ?? {
    version: 0,
    paths: {},
  };
  const before = stateFile?.text ?? null;

  const saved = await loadCache(userID);
  const cache: Cache = new Map(saved.items);
  const store = vaultStore();
  const setup = {
    papersDir: papersFolderOf(null, vault.papersFolder),
    ideasDir: kindFolder("idea") || "Ideas",
    topicsDir: kindFolder("topic") || "Topics",
    forceTag: vault.paperTag || "obsidian",
    custom: customGroups(),
    paired: pairedTags(),
  };
  // A new vault tag, folder or type changes which notes there are and what
  // they say: all of them are written again.
  const signature = JSON.stringify(setup);
  const again =
    rebuild || (saved.setup !== undefined && saved.setup !== signature);
  const written = await withZoteroSource(async (via) => {
    // The library's changes since this computer's copy, in the numbering of
    // where they come from: the copy, not the vault, knows what it has.
    state.version = via === "local" ? saved.local : saved.web;
    const n = await runSync(
      store,
      zoteroFor(apiKey, userID, via),
      state,
      cache,
      { ...setup, today: today(), now: new Date(), rebuild: again },
    );
    if (via === "local") saved.local = state.version;
    else saved.web = state.version;
    return n;
  });

  saved.items = [...cache];
  saved.setup = signature;
  await saveCache(saved);
  const text = syncStateFile(state);
  if (text !== before) {
    if (stateFile)
      await source.writeNote(SYNC_STATE_PATH, text, stateFile.version);
    else await source.createNote(SYNC_STATE_PATH, text);
  }
  return { written, at: Date.now() };
}
