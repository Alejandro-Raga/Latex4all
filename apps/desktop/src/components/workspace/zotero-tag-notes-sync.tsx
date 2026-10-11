import { useEffect } from "react";
import { createLogger } from "@/lib/debug/logger";
import { syncVaultWithZotero } from "@/lib/vault/zotero-sync/run";
import { useZoteroLibrary } from "@/lib/zotero-library";
import { useSettingsStore } from "@/stores/settings-store";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";

const log = createLogger("zotero-sync");
const SETTLE_MS = 10_000;
const EVERY_MS = 60_000;

/**
 * The Zotero → vault sync (lib/vault/zotero-sync), while it's on: a little
 * after start, after Zotero's library changes, and every minute. Only notes
 * that changed are written.
 */
export function ZoteroTagNotesSync() {
  const on = useSettingsStore((s) => s.zoteroAutoVault);
  const apiKey = useZoteroStore((s) => s.apiKey);
  const userID = useZoteroStore((s) => s.userID);
  const ready = useVaultStore((s) => Boolean(s.index));
  const version = useZoteroLibrary(
    (s) => `${s.mirror?.version ?? 0}:${s.mirror?.localVersion ?? 0}`,
  );

  // The vault is read at start, not only when a panel needs it.
  useEffect(() => {
    if (on && apiKey && userID) void useVaultStore.getState().ensureVault();
  }, [on, apiKey, userID]);

  useEffect(() => {
    if (!on || !ready || !apiKey || !userID) return;
    const run = async () => {
      try {
        const { written } = await syncVaultWithZotero();
        if (written) log.info(`Zotero → vault: ${written} notes written`);
      } catch (err) {
        log.warn("Couldn't sync Zotero into the vault", {
          error: String(err),
        });
      }
    };
    const soon = window.setTimeout(run, SETTLE_MS);
    const every = window.setInterval(run, EVERY_MS);
    return () => {
      window.clearTimeout(soon);
      window.clearInterval(every);
    };
  }, [on, ready, apiKey, userID, version]);

  return null;
}
