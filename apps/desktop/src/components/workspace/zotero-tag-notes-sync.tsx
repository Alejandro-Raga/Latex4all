import { useEffect } from "react";
import { createLogger } from "@/lib/debug/logger";
import { refreshPairedNotes } from "@/lib/vault/tag-import";
import { useZoteroLibrary } from "@/lib/zotero-library";
import { useSettingsStore } from "@/stores/settings-store";
import { useVaultStore } from "@/stores/vault-store";

const log = createLogger("zotero-tags");
const SETTLE_MS = 10_000;
const EVERY_MS = 10 * 60_000;

/**
 * Keeps the notes paired with Zotero tags up to date (see tag-import.ts):
 * a little after Zotero's library changes, and every ten minutes. Only notes
 * whose section changed are written.
 */
export function ZoteroTagNotesSync() {
  const live = useSettingsStore((s) => s.zoteroTagNotesLive);
  const ready = useVaultStore((s) => Boolean(s.index));
  const version = useZoteroLibrary(
    (s) => `${s.mirror?.version ?? 0}:${s.mirror?.localVersion ?? 0}`,
  );

  useEffect(() => {
    if (!live || !ready) return;
    const run = () =>
      refreshPairedNotes()
        .then(
          (n) => n && log.info(`Updated ${n} notes paired with Zotero tags`),
        )
        .catch((err) =>
          log.warn("Couldn't update notes paired with Zotero tags", {
            error: String(err),
          }),
        );
    const soon = window.setTimeout(run, SETTLE_MS);
    const every = window.setInterval(run, EVERY_MS);
    return () => {
      window.clearTimeout(soon);
      window.clearInterval(every);
    };
  }, [live, ready, version]);

  return null;
}
