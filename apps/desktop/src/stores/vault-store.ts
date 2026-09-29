import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  findObsidianVaults,
  LocalVaultSource,
  ServerVaultSource,
  type VaultSource,
} from "@/lib/vault/load";
import { parseNote } from "@/lib/vault/parse";
import { buildVaultIndex, type VaultIndex } from "@/lib/vault/vault-index";
import {
  webdavConnect,
  webdavDisconnect,
  webdavStatus,
  type WebdavStatus,
} from "@/lib/vault/webdav";

/** A read of the vault is under way (reloads don't overlap). */
let reading = false;

/** The index with one note replaced (or added), without rereading the vault. */
function withNote(index: VaultIndex | null, path: string, text: string) {
  const others = (index?.list ?? []).filter((n) => n.path !== path);
  return buildVaultIndex([...others, parseNote(path, text)]);
}

interface VaultState {
  // Persisted
  /** Where the vault is read from. */
  mode: "local" | "server";
  /** Folder of the Obsidian vault on this computer, for local mode. */
  vaultPath: string | null;

  // Transient
  source: VaultSource | null;
  /** The connected server, if any (its password stays on the Rust side). */
  server: WebdavStatus | null;
  index: VaultIndex | null;
  /** Attachment paths inside the vault by lower-cased file name. */
  attachments: Map<string, string>;
  /** Server version of each note as last read, for safe saving. */
  versions: Map<string, string | null>;
  loading: boolean;
  /** A reload was asked for by hand and is running. */
  syncing: boolean;
  error: string | null;
  /** Name of the note being read, or null for the list. */
  current: string | null;
  /** Notes visited before `current`, for Back. */
  history: string[];

  /** Picks the source to read from; uses Obsidian's last vault when none is set. */
  ensureVault: () => Promise<void>;
  useLocalFolder: (path: string) => void;
  /** Switches back to the connected server. */
  useServer: () => void;
  connectServer: (
    url: string,
    username: string,
    password: string,
  ) => Promise<void>;
  disconnectServer: () => Promise<void>;
  reload: (byHand?: boolean) => Promise<void>;
  /**
   * Saves a note and refreshes the vault. Unless `force`d, fails with
   * WebdavConflictError if it changed on the server since it was read.
   */
  saveNote: (path: string, text: string, force?: boolean) => Promise<void>;
  /** Creates a note in `folder` and returns its name. */
  createNote: (folder: string, title: string, text: string) => Promise<string>;
  open: (name: string) => void;
  back: () => void;
  showList: () => void;
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      mode: "local",
      vaultPath: null,
      source: null,
      server: null,
      index: null,
      attachments: new Map(),
      versions: new Map(),
      loading: false,
      syncing: false,
      error: null,
      current: null,
      history: [],

      ensureVault: async () => {
        if (get().source) {
          if (!get().index) await get().reload();
          return;
        }
        const server = await webdavStatus().catch(() => null);
        set({ server });
        if (get().mode === "server") {
          if (server) {
            set({ source: new ServerVaultSource(server) });
            await get().reload();
            return;
          }
          set({ mode: "local" });
        }
        let path = get().vaultPath;
        if (!path) {
          const [first] = await findObsidianVaults();
          if (!first) return;
          path = first.path;
        }
        set({ vaultPath: path, source: new LocalVaultSource(path) });
        await get().reload();
      },

      useLocalFolder: (path) => {
        set({
          mode: "local",
          vaultPath: path,
          source: new LocalVaultSource(path),
          index: null,
          current: null,
          history: [],
        });
        get().reload();
      },

      useServer: () => {
        const { server, source } = get();
        if (!server || source?.kind === "server") return;
        set({
          mode: "server",
          source: new ServerVaultSource(server),
          index: null,
          current: null,
          history: [],
        });
        get().reload();
      },

      connectServer: async (url, username, password) => {
        const server = await webdavConnect(url, username, password);
        set({
          mode: "server",
          server,
          source: new ServerVaultSource(server),
          index: null,
          current: null,
          history: [],
        });
        await get().reload();
      },

      disconnectServer: async () => {
        await webdavDisconnect();
        set({ server: null, source: null, mode: "local", index: null });
        await get().ensureVault();
      },

      reload: async (byHand = false) => {
        const { source } = get();
        if (!source || reading) return;
        reading = true;
        set({ loading: !get().index, syncing: byHand, error: null });
        try {
          const { notes, attachments, versions } = await source.load();
          if (get().source === source) {
            set({ index: buildVaultIndex(notes), attachments, versions });
          }
        } catch (err) {
          set({
            error: `Couldn't read the vault: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          reading = false;
          set({ loading: false, syncing: false });
        }
        // Another vault was chosen while this one was being read.
        if (get().source !== source) get().reload();
      },

      saveNote: async (path, text, force = false) => {
        const { source, versions } = get();
        if (!source) throw new Error("No vault is open.");
        const version = force ? undefined : versions.get(path);
        const etag = await source.writeNote(path, text, version);
        set({
          versions: new Map(versions).set(path, etag),
          index: withNote(get().index, path, text),
        });
        get().reload();
      },

      createNote: async (folder, title, text) => {
        const { source } = get();
        if (!source) throw new Error("No vault is open.");
        const name = title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
        if (!name) throw new Error("Give the note a title.");
        const path = folder ? `${folder}/${name}.md` : `${name}.md`;
        await source.createNote(path, text);
        set({ index: withNote(get().index, path, text) });
        get().reload();
        return name;
      },

      open: (name) => {
        const { current, history } = get();
        if (name === current) return;
        set({
          current: name,
          history: current ? [...history, current].slice(-50) : history,
        });
      },

      back: () => {
        const { history } = get();
        set({
          current: history[history.length - 1] ?? null,
          history: history.slice(0, -1),
        });
      },

      showList: () => set({ current: null, history: [] }),
    }),
    {
      name: "latex4all-vault",
      partialize: (state) => ({ mode: state.mode, vaultPath: state.vaultPath }),
    },
  ),
);
