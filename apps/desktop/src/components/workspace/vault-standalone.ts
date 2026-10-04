import { createContext, useContext } from "react";

/**
 * Set where the vault is shown on its own (Library & Vault, no project):
 * its front page then opens on the whole vault's map.
 */
export const VaultStandalone = createContext(false);

export const useVaultStandalone = () => useContext(VaultStandalone);
