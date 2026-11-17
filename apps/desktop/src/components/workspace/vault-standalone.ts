import { createContext, useContext } from "react";

/**
 * Set where the vault is shown on its own (Library & Vault, no project):
 * its front page then opens on the whole vault's map.
 */
export const VaultStandalone = createContext(false);

export const useVaultStandalone = () => useContext(VaultStandalone);

/**
 * Set on the Library & Vault page: its Zotero library is the start page's,
 * not the open project's (one may be open behind it).
 */
export const LibraryPage = createContext(false);
