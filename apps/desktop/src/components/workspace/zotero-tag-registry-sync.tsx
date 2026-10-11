import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";
import { createLogger } from "@/lib/debug/logger";
import { syncTagRegistry } from "@/lib/vault/zotero-tag-registry";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";

const log = createLogger("zotero-tags");
const SETTLE_MS = 5_000;
/** The ideas and topics last carried into Zotero, to skip a needless sync. */
let synced: string | null = null;
/** Said once until it works again, not at every change. */
let warned = false;

/**
 * Keeps the Zotero note that carries every idea and topic as a tag in step
 * with the vault (see zotero-tag-registry.ts), a few seconds after the
 * vault's ideas or topics change.
 */
export function ZoteroTagRegistrySync() {
  const index = useVaultStore((s) => s.index);
  const apiKey = useZoteroStore((s) => s.apiKey);
  const userID = useZoteroStore((s) => s.userID);
  const on = useSettingsStore((s) => s.zoteroTagRegistry);
  const names = useMemo(
    () =>
      index
        ? index.list
            .filter((n) => n.kind === "idea" || n.kind === "topic")
            .map((n) => `${n.kind}:${n.name}`)
            .sort()
            .join("\n")
        : null,
    [index],
  );

  useEffect(() => {
    if (!on || !index || names === null || !apiKey || !userID) return;
    if (names === synced) return;
    const timer = window.setTimeout(() => {
      syncTagRegistry(apiKey, userID, index)
        .then((changed) => {
          synced = names;
          warned = false;
          if (changed) log.info("Zotero now has every idea and topic as a tag");
        })
        .catch((err) => {
          // Tried again when the vault next changes.
          log.warn("Couldn't update the ideas and topics note in Zotero", {
            error: String(err),
          });
          if (!warned) {
            warned = true;
            toast.warning("Couldn't put your ideas and topics in Zotero", {
              description: `${err instanceof Error ? err.message : String(err)} It's tried again when they change; or turn it off in Settings → Zotero.`,
            });
          }
        });
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [on, index, names, apiKey, userID]);

  return null;
}
