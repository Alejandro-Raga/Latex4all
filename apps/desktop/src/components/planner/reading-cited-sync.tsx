import { useEffect, useMemo } from "react";
import { useItemKeyByCitekey } from "@/components/workspace/cited-here";
import { projectKey } from "@/lib/plan/plan-store";
import { noteReading } from "@/lib/plan/reading-sync";
import { citedKeys } from "@/lib/vault/project-note";
import { useDocumentStore } from "@/stores/document-store";
import { useVaultStore } from "@/stores/vault-store";

/**
 * While a project is open: the papers its LaTeX cites are marked cited on
 * its own reading list, a moment after the typing stops.
 */
export function ReadingCitedSync() {
  const root = useDocumentStore((s) => s.projectRoot);
  const files = useDocumentStore((s) => s.files);
  const fromZotero = useItemKeyByCitekey();
  const index = useVaultStore((s) => s.index);

  const cited = useMemo(() => {
    const tex = files.filter(
      (f) => f.type === "tex" && typeof f.content === "string",
    ) as { content: string }[];
    return citedKeys(tex);
  }, [files]);

  useEffect(() => {
    if (!root || cited.length === 0) return;
    const timer = setTimeout(() => {
      // A citation key's Zotero item: from the project's Zotero collections,
      // else from the vault's paper notes.
      const fromVault = new Map<string, string>();
      for (const n of index?.list ?? []) {
        if (n.citekey && n.zoteroKey) fromVault.set(n.citekey, n.zoteroKey);
      }
      const items = cited
        .map((k) => fromZotero.get(k) ?? fromVault.get(k))
        .filter((k): k is string => Boolean(k));
      void noteReading(items, "cited", projectKey(root));
    }, 2000);
    return () => clearTimeout(timer);
  }, [root, cited.join(","), fromZotero, index]);

  return null;
}
