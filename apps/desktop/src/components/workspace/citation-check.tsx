import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  Loader2Icon,
  NotebookTextIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type CitationReport,
  checkCitations,
  citekeySearch,
  renameCiteKey,
} from "@/lib/citations";
import { noteForCitekey } from "@/lib/vault/cite-link";
import { findItemForCitekey } from "@/lib/zotero-api";
import { addPaperToVault } from "@/lib/vault/add-paper";
import { useDocumentStore } from "@/stores/document-store";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";

/** Whether the citation check is open. */
export const useCitationCheck = create<{
  open: boolean;
  show: () => void;
  close: () => void;
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/** Zotero item keys by citation key, from the project's synced .bib files. */
function itemKeysByCitekey(projectRoot: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!projectRoot) return map;
  const synced = useZoteroStore.getState().syncedCollections[projectRoot] ?? {};
  for (const info of Object.values(synced)) {
    for (const [item, key] of Object.entries(info.keyMap)) map.set(key, item);
  }
  return map;
}

async function zoteroItemFor(key: string): Promise<string | null> {
  const { apiKey, userID } = useZoteroStore.getState();
  const known = itemKeysByCitekey(useDocumentStore.getState().projectRoot).get(
    key,
  );
  if (known) return known;
  if (!apiKey || !userID) return null;
  return findItemForCitekey(apiKey, userID, key, citekeySearch(key));
}

function scan(): CitationReport {
  const { files } = useDocumentStore.getState();
  return checkCitations(
    files
      .filter((f) => f.type === "tex")
      .map((f) => ({ content: f.content ?? "" })),
    files
      .filter((f) => f.name.toLowerCase().endsWith(".bib"))
      .map((f) => ({ path: f.relativePath, content: f.content ?? "" })),
  );
}

function Section({
  title,
  empty,
  children,
  count,
  action,
}: {
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
  /** For the whole list, beside the title. */
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <h3 className="flex items-center font-medium text-sm">
        <span className="flex-1">
          {title}
          <span className="ml-1.5 text-muted-foreground">{count}</span>
        </span>
        {count > 0 && action}
      </h3>
      {count === 0 ? (
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <CheckIcon className="size-3.5 text-emerald-500" />
          {empty}
        </p>
      ) : (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto">{children}</ul>
      )}
    </section>
  );
}

function Row({
  label,
  detail,
  action,
}: {
  label: string;
  detail?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/50">
      <span className="min-w-0 flex-1">
        <code className="text-xs">{label}</code>
        {detail && (
          <span className="block truncate text-muted-foreground text-xs">
            {detail}
          </span>
        )}
      </span>
      {action}
    </li>
  );
}

function ActionButton({
  label,
  icon: Icon,
  run,
}: {
  label: string;
  icon: typeof PlusIcon;
  run: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-6 shrink-0 gap-1 px-2 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await run();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <Icon className="size-3" />
      )}
      {label}
    </Button>
  );
}

/**
 * The project's citations against its bibliography and the vault, each
 * problem with the fix beside it.
 */
export function CitationCheckDialog() {
  const open = useCitationCheck((s) => s.open);
  const close = useCitationCheck((s) => s.close);
  const zoteroConnected = useZoteroStore((s) => s.isAuthenticated);
  const vaultIndex = useVaultStore((s) => s.index);
  const [report, setReport] = useState<CitationReport | null>(null);

  const rescan = useCallback(() => setReport(scan()), []);
  useEffect(() => {
    if (open) {
      rescan();
      useVaultStore.getState().ensureVault();
    }
  }, [open, rescan]);

  const addToBib = async (key: string) => {
    const itemKey = await zoteroItemFor(key);
    if (!itemKey)
      throw new Error(`Couldn't find “${key}” in your Zotero library.`);
    const result = await useZoteroStore.getState().addItemToBib(itemKey, null);
    if (result.status === "error") throw new Error(result.message);
    if (result.citekey !== key) {
      // Zotero knows it by another key: cite it by that one everywhere.
      const docs = useDocumentStore.getState();
      for (const f of docs.files) {
        if (f.type !== "tex" || !f.content) continue;
        const renamed = renameCiteKey(f.content, key, result.citekey);
        if (renamed !== f.content) docs.updateFileContent(f.id, renamed);
      }
      toast.success(
        `Added as ${result.citekey}, and your citations now use it`,
      );
    } else {
      toast.success(`Added to ${result.fileName}`);
    }
    rescan();
  };

  const addToVault = async (key: string) => {
    const itemKey = await zoteroItemFor(key);
    if (!itemKey) {
      throw new Error(`Couldn't find “${key}” in your Zotero library.`);
    }
    const result = await addPaperToVault(itemKey, key);
    toast.success(
      result.status === "exists"
        ? `${result.name} already has a note`
        : `Added ${result.name} to your vault`,
    );
  };

  // Every cited paper without a note, one after another, with progress.
  const addAllToVault = async (keys: string[]) => {
    const toastId = toast.loading(`Adding 0 of ${keys.length} to your vault…`);
    let added = 0;
    const missing: string[] = [];
    for (const [i, key] of keys.entries()) {
      toast.loading(`Adding ${i + 1} of ${keys.length} to your vault…`, {
        id: toastId,
      });
      try {
        const itemKey = await zoteroItemFor(key);
        if (!itemKey) {
          missing.push(key);
          continue;
        }
        await addPaperToVault(itemKey, key);
        added++;
      } catch {
        missing.push(key);
      }
    }
    if (missing.length) {
      toast.warning(`Added ${added} to your vault`, {
        id: toastId,
        description: `Not found in Zotero: ${missing.join(", ")}`,
      });
    } else {
      toast.success(`Added ${added} to your vault`, { id: toastId });
    }
  };

  const notInVault =
    report && vaultIndex
      ? report.cited.filter(
          (key) =>
            !report.missing.includes(key) &&
            !noteForCitekey(
              vaultIndex,
              key,
              itemKeysByCitekey(useDocumentStore.getState().projectRoot),
            ),
        )
      : [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Citations</DialogTitle>
          <DialogDescription>
            {report
              ? `${report.cited.length} cited in this project`
              : "Checking…"}
          </DialogDescription>
        </DialogHeader>
        {report && (
          <div className="space-y-4">
            <Section
              title="Cited, not in the bibliography"
              count={report.missing.length}
              empty="Every citation has an entry."
            >
              {report.missing.map((key) => (
                <Row
                  key={key}
                  label={key}
                  action={
                    zoteroConnected && (
                      <ActionButton
                        label="Add from Zotero"
                        icon={PlusIcon}
                        run={() => addToBib(key)}
                      />
                    )
                  }
                />
              ))}
            </Section>
            <Section
              title="In the bibliography, never cited"
              count={report.unused.length}
              empty="Every entry is cited."
            >
              {report.unused.map((e) => (
                <Row
                  key={`${e.file}:${e.key}`}
                  label={e.key}
                  detail={e.title ?? e.file}
                />
              ))}
            </Section>
            {vaultIndex && (
              <Section
                title="Cited, not in your vault"
                count={notInVault.length}
                empty="Every cited paper has a note."
                action={
                  zoteroConnected && (
                    <ActionButton
                      label="Add all"
                      icon={NotebookTextIcon}
                      run={() => addAllToVault(notInVault)}
                    />
                  )
                }
              >
                {notInVault.map((key) => (
                  <Row
                    key={key}
                    label={key}
                    action={
                      zoteroConnected && (
                        <ActionButton
                          label="Add to vault"
                          icon={NotebookTextIcon}
                          run={() => addToVault(key)}
                        />
                      )
                    }
                  />
                ))}
              </Section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
