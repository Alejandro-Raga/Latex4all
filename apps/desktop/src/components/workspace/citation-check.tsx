import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookPlusIcon,
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
  bibEntries,
  type CitationReport,
  checkCitations,
  citekeySearch,
  renameCiteKey,
} from "@/lib/citations";
import { cn } from "@/lib/utils";
import { addPaperToVault } from "@/lib/vault/add-paper";
import { noteForCitekey } from "@/lib/vault/cite-link";
import { findItemForCitekey } from "@/lib/zotero-api";
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

export async function zoteroItemFor(key: string): Promise<string | null> {
  const { apiKey, userID } = useZoteroStore.getState();
  const known = itemKeysByCitekey(useDocumentStore.getState().projectRoot).get(
    key,
  );
  if (known) return known;
  if (!apiKey || !userID) return null;
  // By the entry's own title when the bibliography has it: far surer than
  // words guessed from the key (which may be "noauthor_horizon_2025").
  const title = bibFiles()
    .flatMap((f) => bibEntries(f.content, f.path))
    .find((e) => e.key === key)?.title;
  const year = citekeySearch(key).year;
  if (title) {
    const byTitle = await findItemForCitekey(apiKey, userID, key, {
      words: title.replace(/[{}\\]/g, "").slice(0, 120),
      year,
    });
    if (byTitle) return byTitle;
  }
  return findItemForCitekey(apiKey, userID, key, citekeySearch(key));
}

/**
 * Adds the papers behind these citation keys to the vault, one after
 * another, with progress in a toast (for places outside this window).
 */
let addingToVault = false;
export async function addCitekeysToVault(keys: string[]) {
  if (addingToVault) return;
  addingToVault = true;
  try {
    await addEach(keys);
  } finally {
    addingToVault = false;
  }
}

async function addEach(keys: string[]) {
  const id = toast.loading(`Adding ${keys.length} to your vault…`);
  let added = 0;
  const failed: string[] = [];
  for (const [i, key] of keys.entries()) {
    toast.loading(`Adding to your vault… ${i + 1}/${keys.length}`, { id });
    try {
      const itemKey = await zoteroItemFor(key);
      if (!itemKey) throw new Error("not in Zotero");
      await addPaperToVault(itemKey, key);
      added++;
    } catch {
      failed.push(key);
    }
  }
  if (failed.length) {
    toast.warning(`Added ${added} to your vault`, {
      id,
      description: `Not found in Zotero: ${failed.join(", ")}`,
    });
  } else {
    toast.success(`Added ${added} to your vault`, { id });
  }
}

function bibFiles() {
  return useDocumentStore
    .getState()
    .files.filter((f) => f.name.toLowerCase().endsWith(".bib"))
    .map((f) => ({ path: f.relativePath, content: f.content ?? "" }));
}

function scan(): CitationReport {
  const { files } = useDocumentStore.getState();
  return checkCitations(
    files
      .filter((f) => f.type === "tex")
      .map((f) => ({ content: f.content ?? "" })),
    bibFiles(),
  );
}

type Tab = "bibliography" | "vault" | "unused";

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
    <li className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs" title={label}>
          {label}
        </div>
        {detail && (
          <div
            className="truncate text-muted-foreground text-xs"
            title={detail}
          >
            {detail}
          </div>
        )}
      </div>
      {action && <div className="w-28 shrink-0 text-right">{action}</div>}
    </li>
  );
}

function ActionButton({
  label,
  icon: Icon,
  run,
  primary,
}: {
  label: string;
  icon: typeof PlusIcon;
  run: () => Promise<void>;
  primary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant={primary ? "default" : "outline"}
      className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
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
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {label}
    </Button>
  );
}

/**
 * The project's citations against its bibliography and the vault, each
 * problem with the fix beside it, one list at a time.
 */
export function CitationCheckDialog() {
  const open = useCitationCheck((s) => s.open);
  const close = useCitationCheck((s) => s.close);
  const zoteroConnected = useZoteroStore((s) => s.isAuthenticated);
  const vaultIndex = useVaultStore((s) => s.index);
  const [report, setReport] = useState<CitationReport | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const rescan = useCallback(() => setReport(scan()), []);
  useEffect(() => {
    if (open) {
      rescan();
      setTab(null);
      useVaultStore.getState().ensureVault();
    }
  }, [open, rescan]);

  // Titles from the bibliography, so a row names the paper, not just its key.
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    if (!report) return map;
    for (const f of bibFiles()) {
      for (const e of bibEntries(f.content, f.path)) {
        if (e.title) map.set(e.key, e.title);
      }
    }
    return map;
  }, [report]);

  const notInVault = useMemo(
    () =>
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
        : [],
    [report, vaultIndex],
  );

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
    if (result.status === "exists")
      toast.info(`${result.name} already has a note`);
  };

  // One after another, with progress in the window.
  const addAll = async (
    keys: string[],
    add: (key: string) => Promise<void>,
    what: string,
  ) => {
    let added = 0;
    const failed: string[] = [];
    setProgress({ done: 0, total: keys.length });
    for (const [i, key] of keys.entries()) {
      try {
        await add(key);
        added++;
      } catch {
        failed.push(key);
      }
      setProgress({ done: i + 1, total: keys.length });
    }
    setProgress(null);
    rescan();
    if (failed.length) {
      toast.warning(`Added ${added} to ${what}`, {
        description: `Not found in Zotero: ${failed.join(", ")}`,
      });
    } else {
      toast.success(`Added ${added} to ${what}`);
    }
  };

  const tabs: { id: Tab; label: string; count: number }[] = report
    ? [
        {
          id: "bibliography",
          label: "Not in bibliography",
          count: report.missing.length,
        },
        ...(vaultIndex
          ? [
              {
                id: "vault" as const,
                label: "Not in vault",
                count: notInVault.length,
              },
            ]
          : []),
        { id: "unused", label: "Never cited", count: report.unused.length },
      ]
    : [];
  // Open on the first list with something in it.
  const shown =
    tab ?? tabs.find((t) => t.count > 0)?.id ?? tabs[0]?.id ?? "bibliography";

  const list = !report
    ? null
    : shown === "bibliography"
      ? {
          keys: report.missing,
          empty: "Every citation has an entry.",
          bulk: zoteroConnected && {
            label: "Add all from Zotero",
            icon: BookPlusIcon,
            run: () => addAll(report.missing, addToBib, "the bibliography"),
          },
          row: (key: string) => (
            <Row
              key={key}
              label={key}
              action={
                zoteroConnected && (
                  <ActionButton
                    label="Add"
                    icon={PlusIcon}
                    run={() => addToBib(key)}
                  />
                )
              }
            />
          ),
        }
      : shown === "vault"
        ? {
            keys: notInVault,
            empty: "Every cited paper has a note.",
            bulk: zoteroConnected && {
              label: "Add all to vault",
              icon: NotebookTextIcon,
              run: () => addAll(notInVault, addToVault, "your vault"),
            },
            row: (key: string) => (
              <Row
                key={key}
                label={key}
                detail={titles.get(key)}
                action={
                  zoteroConnected && (
                    <ActionButton
                      label="Add"
                      icon={NotebookTextIcon}
                      run={() => addToVault(key)}
                    />
                  )
                }
              />
            ),
          }
        : {
            keys: report.unused.map((e) => e.key),
            empty: "Every entry is cited.",
            bulk: null,
            row: (key: string) => {
              const e = report.unused.find((u) => u.key === key);
              return (
                <Row
                  key={`${e?.file}:${key}`}
                  label={key}
                  detail={e?.title ?? e?.file}
                />
              );
            },
          };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Citations</DialogTitle>
          <DialogDescription>
            {report
              ? `${report.cited.length} cited in this project`
              : "Checking…"}
          </DialogDescription>
        </DialogHeader>

        {report && (
          <>
            <div
              role="tablist"
              className="flex shrink-0 gap-1 rounded-lg bg-muted p-1"
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={shown === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
                    shown === t.id
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] tabular-nums",
                      t.count > 0
                        ? "bg-primary/15 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {t.count}
                  </span>
                </button>
              ))}
            </div>

            {list && list.keys.length === 0 ? (
              <p className="flex items-center justify-center gap-1.5 py-8 text-muted-foreground text-sm">
                <CheckIcon className="size-4 text-emerald-500" />
                {list.empty}
              </p>
            ) : (
              list && (
                <>
                  {list.bulk && (
                    <div className="flex shrink-0 items-center gap-3">
                      {progress ? (
                        <div className="flex flex-1 items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-[width]"
                              style={{
                                width: `${(progress.done / progress.total) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {progress.done} of {progress.total}
                          </span>
                        </div>
                      ) : (
                        <span className="flex-1 text-muted-foreground text-xs">
                          {list.keys.length}{" "}
                          {list.keys.length === 1 ? "paper" : "papers"}
                        </span>
                      )}
                      <ActionButton primary {...list.bulk} />
                    </div>
                  )}
                  <ul className="-mx-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                    {list.keys.map((key) => list.row(key))}
                  </ul>
                </>
              )
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
