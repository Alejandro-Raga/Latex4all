import { useEffect } from "react";
import { createLogger } from "@/lib/debug/logger";
import { automateVault, refreshPairedNotes } from "@/lib/vault/tag-import";
import { useZoteroLibrary } from "@/lib/zotero-library";
import { useSettingsStore } from "@/stores/settings-store";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";

const log = createLogger("zotero-tags");
const SETTLE_MS = 10_000;
const EVERY_MS = 10 * 60_000;

/**
 * Keeps the vault in step with Zotero's tags (see tag-import.ts): with
 * "Zotero → vault, automatically" on, papers with the vault tag and
 * "type: name" tags get their notes; notes paired with a tag follow it.
 * A little after start, after Zotero's library changes, and every ten
 * minutes. Only notes that changed are written.
 */
export function ZoteroTagNotesSync() {
  const live = useSettingsStore((s) => s.zoteroTagNotesLive);
  const auto = useSettingsStore((s) => s.zoteroAutoVault);
  const apiKey = useZoteroStore((s) => s.apiKey);
  const userID = useZoteroStore((s) => s.userID);
  const ready = useVaultStore((s) => Boolean(s.index));
  const version = useZoteroLibrary(
    (s) => `${s.mirror?.version ?? 0}:${s.mirror?.localVersion ?? 0}`,
  );

  // Automatic: the vault and the library are read at start, not only when a
  // panel needs them.
  useEffect(() => {
    if (!auto || !apiKey || !userID) return;
    void useVaultStore.getState().ensureVault();
    void useZoteroLibrary.getState().ensure(apiKey, userID);
  }, [auto, apiKey, userID]);

  useEffect(() => {
    if ((!live && !auto) || !ready) return;
    const run = async () => {
      try {
        if (auto) {
          const done = await automateVault();
          if (done.papers || done.notes) {
            log.info(
              `Zotero → vault: ${done.papers} paper notes, ${done.notes} new notes`,
            );
          }
        }
        if (live || auto) {
          const n = await refreshPairedNotes();
          if (n) log.info(`Updated ${n} notes paired with Zotero tags`);
        }
      } catch (err) {
        log.warn("Couldn't bring the vault in step with Zotero", {
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
  }, [live, auto, ready, version]);

  return null;
}
