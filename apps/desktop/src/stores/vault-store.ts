import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  findObsidianVaults,
  LocalVaultSource,
  ServerVaultSource,
  type VaultSource,
} from "@/lib/vault/load";
import { parseNote } from "@/lib/vault/parse";
import { fillTemplate } from "@/lib/vault/template";
import {
  buildVaultIndex,
  type KindOverrides,
  type NoteKind,
  type VaultIndex,
} from "@/lib/vault/vault-index";
import {
  webdavConnect,
  webdavDisconnect,
  webdavStatus,
  type WebdavStatus,
} from "@/lib/vault/webdav";

/** A read of the vault is under way (reloads don't overlap). */
let reading = false;

/**
 * Asks before throwing away unsaved edits to a vault note. True when there
 * are none, or the user agrees to lose them.
 */
export function confirmLeaveVaultEdit(): boolean {
  const { unsavedEdit } = useVaultStore.getState();
  if (!unsavedEdit) return true;
  if (!window.confirm(`Discard your unsaved changes to “${unsavedEdit}”?`)) {
    return false;
  }
  useVaultStore.setState({ unsavedEdit: null });
  return true;
}

/** Which vault hand-picked note kinds belong to. */
function vaultKey(state: { mode: string; vaultPath: string | null }) {
  return state.mode === "server" ? "server" : (state.vaultPath ?? "");
}

/** This vault's hand-picked note kinds. */
function chosenKinds(): KindOverrides {
  const state = useVaultStore.getState();
  return state.noteKinds[vaultKey(state)] ?? {};
}

/** The index with one note replaced (or added), without rereading the vault. */
function withNote(index: VaultIndex | null, path: string, text: string) {
  const others = (index?.list ?? []).filter((n) => n.path !== path);
  return buildVaultIndex([...others, parseNote(path, text)], chosenKinds());
}

interface VaultState {
  // Persisted
  /** Where the vault is read from. */
  mode: "local" | "server";
  /** Folder of the Obsidian vault on this computer, for local mode. */
  vaultPath: string | null;
  /** Projects that keep a note in the vault, by project folder. */
  linkedProjects: Record<string, true>;
  /** Vault folder for those notes. */
  projectsFolder: string;
  /** Zotero tag that brings a paper into the vault (whatever syncs it watches for). */
  paperTag: string;
  /** Where Latex4All puts paper notes; "" finds where the vault keeps them. */
  papersFolder: string;
  /** Note kinds picked by hand, per vault, by lower-cased note name. */
  noteKinds: Record<string, KindOverrides>;
  /** Folder and template last used for a new note ("" / null: none). */
  lastNoteFolder: string | null;
  lastTemplate: string | null;

  // Transient
  source: VaultSource | null;
  /** The connected server, if any (its password stays on the Rust side). */
  server: WebdavStatus | null;
  index: VaultIndex | null;
  /** Attachment paths inside the vault by lower-cased file name. */
  attachments: Map<string, string>;
  /** Server version of each note as last read, for safe saving. */
  versions: Map<string, string | null>;
  /** Template notes in the vault's templates folder. */
  templates: string[];
  /** Obsidian's folder for new notes, when it has one set. */
  newNoteFolder: string | null;
  loading: boolean;
  /** A reload was asked for by hand and is running. */
  syncing: boolean;
  error: string | null;
  /** Name of the note being read, or null for the list. */
  current: string | null;
  /** Where you were before `current`, for Back; "" is the list of notes. */
  history: string[];
  /** Where Back came from, for Forward. */
  forward: string[];
  /** The note being edited, while it has changes that aren't saved. */
  unsavedEdit: string | null;

  /** Picks the source to read from; uses Obsidian's last vault when none is set. */
  ensureVault: () => Promise<void>;
  useLocalFolder: (path: string) => void;
  /** A note was deleted: out of the index, and out of view if it was open. */
  noteDeleted: (path: string) => void;
  /** Sets what a note is (null: back to what it's found to be). */
  setNoteKind: (name: string, kind: NoteKind | null) => void;
  linkProject: (root: string, linked: boolean) => void;
  setProjectsFolder: (folder: string) => void;
  setPaperTag: (tag: string) => void;
  setPapersFolder: (folder: string) => void;
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
  /** Shows a note written elsewhere (e.g. a project note) without a reread. */
  noteWritten: (path: string, text: string) => void;
  /** Creates a note in `folder`, from `template` if given, and returns its name. */
  createNote: (
    folder: string,
    title: string,
    template: string | null,
  ) => Promise<string>;
  open: (name: string) => void;
  back: () => void;
  goForward: () => void;
  showList: () => void;
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      mode: "local",
      vaultPath: null,
      lastNoteFolder: null,
      lastTemplate: null,
      linkedProjects: {},
      projectsFolder: "My work",
      paperTag: "obsidian",
      papersFolder: "",
      noteKinds: {},
      source: null,
      server: null,
      index: null,
      attachments: new Map(),
      versions: new Map(),
      templates: [],
      newNoteFolder: null,
      loading: false,
      syncing: false,
      error: null,
      current: null,
      history: [],
      forward: [],
      unsavedEdit: null,

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
          forward: [],
        });
        get().reload();
      },

      linkProject: (root, linked) =>
        set((s) => {
          const next = { ...s.linkedProjects };
          if (linked) next[root] = true;
          else delete next[root];
          return { linkedProjects: next };
        }),

      setPaperTag: (tag) => set({ paperTag: tag.trim() }),
      setPapersFolder: (folder) =>
        set({ papersFolder: folder.trim().replace(/^\/+|\/+$/g, "") }),

      setProjectsFolder: (folder) =>
        set({ projectsFolder: folder.replace(/^\/+|\/+$/g, "") }),

      useServer: () => {
        const { server, source } = get();
        if (!server || source?.kind === "server") return;
        set({
          mode: "server",
          source: new ServerVaultSource(server),
          index: null,
          current: null,
          history: [],
          forward: [],
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
          forward: [],
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
          const loaded = await source.load();
          if (get().source === source) {
            set({
              index: buildVaultIndex(loaded.notes, chosenKinds()),
              attachments: loaded.attachments,
              versions: loaded.versions,
              templates: loaded.templates,
              newNoteFolder: loaded.newNoteFolder,
            });
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

      noteDeleted: (path) => {
        const index = get().index;
        const gone = index?.list.find((n) => n.path === path);
        const versions = new Map(get().versions);
        versions.delete(path);
        set({
          versions,
          index: index
            ? buildVaultIndex(
                index.list.filter((n) => n.path !== path),
                chosenKinds(),
              )
            : null,
        });
        if (gone && get().current === gone.name) {
          set({ current: null, forward: [] });
        }
      },

      setNoteKind: (name, kind) => {
        const key = vaultKey(get());
        const mine = { ...(get().noteKinds[key] ?? {}) };
        if (kind) mine[name.toLowerCase()] = kind;
        else delete mine[name.toLowerCase()];
        set({ noteKinds: { ...get().noteKinds, [key]: mine } });
        const index = get().index;
        if (index) set({ index: buildVaultIndex(index.list, mine) });
      },

      noteWritten: (path, text) => {
        set({ index: withNote(get().index, path, text) });
        get().reload();
      },

      createNote: async (folder, title, template) => {
        const { source } = get();
        if (!source) throw new Error("No vault is open.");
        const name = title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
        if (!name) throw new Error("Give the note a title.");
        const text = template
          ? fillTemplate((await source.readNote(template)).text, name)
          : "";
        set({ lastNoteFolder: folder, lastTemplate: template ?? "" });
        const path = folder ? `${folder}/${name}.md` : `${name}.md`;
        await source.createNote(path, text);
        set({ index: withNote(get().index, path, text) });
        get().reload();
        return name;
      },

      open: (name) => {
        const { current, history } = get();
        if (name === current || !confirmLeaveVaultEdit()) return;
        set({
          current: name,
          history: [...history, current ?? ""].slice(-50),
          forward: [],
        });
      },

      back: () => {
        const { current, history, forward } = get();
        if (!history.length || !confirmLeaveVaultEdit()) return;
        set({
          current: history[history.length - 1] || null,
          history: history.slice(0, -1),
          forward: [current ?? "", ...forward],
        });
      },

      goForward: () => {
        const { current, history, forward } = get();
        if (!forward.length || !confirmLeaveVaultEdit()) return;
        set({
          current: forward[0] || null,
          history: [...history, current ?? ""].slice(-50),
          forward: forward.slice(1),
        });
      },

      showList: () => {
        const { current, history } = get();
        if (current === null || !confirmLeaveVaultEdit()) return;
        set({
          current: null,
          history: [...history, current].slice(-50),
          forward: [],
        });
      },
    }),
    {
      name: "latex4all-vault",
      partialize: (state) => ({
        mode: state.mode,
        vaultPath: state.vaultPath,
        lastNoteFolder: state.lastNoteFolder,
        lastTemplate: state.lastTemplate,
        linkedProjects: state.linkedProjects,
        projectsFolder: state.projectsFolder,
        paperTag: state.paperTag,
        papersFolder: state.papersFolder,
        noteKinds: state.noteKinds,
      }),
    },
  ),
);
