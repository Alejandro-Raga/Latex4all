import { create } from "zustand";
import { persist } from "zustand/middleware";
import { findObsidianVaults, loadVault } from "@/lib/vault/load";
import { buildVaultIndex, type VaultIndex } from "@/lib/vault/vault-index";

/** A read of the vault is under way (reloads don't overlap). */
let reading = false;

interface VaultState {
  // Persisted
  /** Folder of the Obsidian vault shown in the Vault panel. */
  vaultPath: string | null;

  // Transient
  index: VaultIndex | null;
  /** Attachment paths inside the vault by lower-cased file name. */
  attachments: Map<string, string>;
  loading: boolean;
  error: string | null;
  /** Name of the note being read, or null for the list. */
  current: string | null;
  /** Notes visited before `current`, for Back. */
  history: string[];

  setVaultPath: (path: string | null) => void;
  /** Uses the vault Obsidian last had open when none is chosen yet. */
  ensureVault: () => Promise<void>;
  reload: () => Promise<void>;
  open: (name: string) => void;
  back: () => void;
  showList: () => void;
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      vaultPath: null,
      index: null,
      attachments: new Map(),
      loading: false,
      error: null,
      current: null,
      history: [],

      setVaultPath: (path) => {
        set({ vaultPath: path, index: null, current: null, history: [] });
        get().reload();
      },

      ensureVault: async () => {
        if (!get().vaultPath) {
          const [first] = await findObsidianVaults();
          if (!first) return;
          set({ vaultPath: first.path });
        }
        if (!get().index) await get().reload();
      },

      reload: async () => {
        const { vaultPath } = get();
        if (!vaultPath || reading) return;
        reading = true;
        set({ loading: !get().index, error: null });
        try {
          const { notes, attachments } = await loadVault(vaultPath);
          const index = buildVaultIndex(notes);
          if (get().vaultPath === vaultPath)
            set({ index, attachments, loading: false });
        } catch (err) {
          set({
            loading: false,
            error: `Couldn't read the vault: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          reading = false;
        }
        // Another vault was chosen while this one was being read.
        if (get().vaultPath !== vaultPath) get().reload();
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
      partialize: (state) => ({ vaultPath: state.vaultPath }),
    },
  ),
);
