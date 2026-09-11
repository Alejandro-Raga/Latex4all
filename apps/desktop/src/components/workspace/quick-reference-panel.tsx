import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  FileIcon,
  FileTextIcon,
  FileCodeIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderOpenDotIcon,
  ImageIcon,
  LibraryIcon,
  Loader2Icon,
  MinusIcon,
  PlusIcon,
  BookOpenIcon,
  SearchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useProjectStore } from "@/stores/project-store";
import { useDocumentStore } from "@/stores/document-store";
import { DEFAULT_BIB_FILE_NAME, useZoteroStore } from "@/stores/zotero-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  buildCollectionTree,
  type ZoteroCollectionNode,
} from "@/lib/zotero-collection-tree";
import {
  scanProjectFolder,
  readTexFileContent,
  readImageAsDataUrl,
  type FsProjectFile,
  type ProjectFileType,
} from "@/lib/tauri/fs";
import {
  fetchLibraryItems,
  findPdfAttachment,
  downloadAttachmentFile,
  fetchAnnotations,
  type ZoteroItemSummary,
} from "@/lib/zotero-api";
import {
  REFERENCE_SORTS,
  searchReferences,
  sortReferences,
  type ReferenceSort,
} from "@/lib/zotero-search";
import { PdfViewer, type PdfAnnotationRect } from "./preview/pdf-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("quick-reference");

/** Text files above this size are truncated in the preview — this is a peek, not an editor. */
const MAX_PREVIEW_CHARS = 300_000;

interface TreeNode {
  name: string;
  relativePath: string;
  kind: "folder" | ProjectFileType;
  absolutePath?: string;
  children?: TreeNode[];
}

function buildTree(files: FsProjectFile[], folders: string[]): TreeNode {
  const root: TreeNode = {
    name: "",
    relativePath: "",
    kind: "folder",
    children: [],
  };
  const byPath = new Map<string, TreeNode>([["", root]]);

  const ensureFolder = (relativePath: string): TreeNode => {
    const existing = byPath.get(relativePath);
    if (existing) return existing;
    const lastSlash = relativePath.lastIndexOf("/");
    const parentPath = lastSlash === -1 ? "" : relativePath.slice(0, lastSlash);
    const name =
      lastSlash === -1 ? relativePath : relativePath.slice(lastSlash + 1);
    const parent = ensureFolder(parentPath);
    const node: TreeNode = {
      name,
      relativePath,
      kind: "folder",
      children: [],
    };
    parent.children?.push(node);
    byPath.set(relativePath, node);
    return node;
  };

  for (const folder of [...folders].sort((a, b) => a.length - b.length)) {
    ensureFolder(folder);
  }
  for (const file of files) {
    const lastSlash = file.relativePath.lastIndexOf("/");
    const parentPath =
      lastSlash === -1 ? "" : file.relativePath.slice(0, lastSlash);
    const name =
      lastSlash === -1
        ? file.relativePath
        : file.relativePath.slice(lastSlash + 1);
    const parent = ensureFolder(parentPath);
    parent.children?.push({
      name,
      relativePath: file.relativePath,
      kind: file.type,
      absolutePath: file.absolutePath,
    });
  }

  const sortChildren = (node: TreeNode) => {
    node.children?.sort((a, b) => {
      if (a.kind === "folder" && b.kind !== "folder") return -1;
      if (a.kind !== "folder" && b.kind === "folder") return 1;
      return a.name.localeCompare(b.name);
    });
    node.children?.forEach(sortChildren);
  };
  sortChildren(root);

  return root;
}

function fileIcon(kind: ProjectFileType) {
  switch (kind) {
    case "tex":
      return FileCodeIcon;
    case "pdf":
    case "bib":
      return FileTextIcon;
    case "image":
      return ImageIcon;
    default:
      return FileIcon;
  }
}

type Preview =
  | { kind: "loading" }
  | { kind: "text"; content: string; truncated: boolean }
  | {
      kind: "pdf";
      data: Uint8Array;
      annotations?: PdfAnnotationRect[];
      annotationsError?: string;
    }
  | { kind: "image"; dataUrl: string }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

type SelectedFile =
  | {
      source: "fs";
      id: string;
      label: string;
      absolutePath: string;
      type: ProjectFileType;
    }
  | {
      source: "zotero";
      id: string;
      label: string;
      itemKey: string;
    };

/** Sentinel cache/expand key for "My Library" (all items, no collection filter). */
const MY_LIBRARY_KEY = "__zotero_my_library__";

function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

export function QuickReferencePanel({ onClose }: { onClose: () => void }) {
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const currentProjectRoot = useDocumentStore((s) => s.projectRoot);
  const zoteroAuthenticated = useZoteroStore((s) => s.isAuthenticated);
  const zoteroApiKey = useZoteroStore((s) => s.apiKey);
  const zoteroUserID = useZoteroStore((s) => s.userID);
  const zoteroCollections = useZoteroStore((s) => s.collections);
  const loadZoteroCollections = useZoteroStore((s) => s.loadCollections);

  const [refProjectPath, setRefProjectPath] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const [expandedZoteroCollections, setExpandedZoteroCollections] = useState<
    Set<string>
  >(new Set());
  const [zoteroItemsByCollection, setZoteroItemsByCollection] = useState<
    Map<string, ZoteroItemSummary[]>
  >(new Map());
  const [zoteroLoadingKeys, setZoteroLoadingKeys] = useState<Set<string>>(
    new Set(),
  );
  const [zoteroErrorKeys, setZoteroErrorKeys] = useState<Map<string, string>>(
    new Map(),
  );
  const [zoteroQuery, setZoteroQuery] = useState("");
  const [zoteroSort, setZoteroSort] = useState<ReferenceSort>("relevance");

  const treeCache = useRef(new Map<string, TreeNode>());
  const previewCache = useRef(new Map<string, Preview>());

  useEffect(() => {
    if (zoteroAuthenticated && zoteroCollections.length === 0) {
      loadZoteroCollections();
    }
  }, [zoteroAuthenticated, zoteroCollections.length, loadZoteroCollections]);

  const availableProjects = useMemo(() => {
    const currentNormalized = currentProjectRoot
      ? normalizePath(currentProjectRoot)
      : null;
    return recentProjects.filter(
      (p) => normalizePath(p.path) !== currentNormalized,
    );
  }, [recentProjects, currentProjectRoot]);

  const openReferenceProject = useCallback(async (path: string) => {
    setRefProjectPath(path);
    setSelectedFile(null);
    setPreview(null);

    const cached = treeCache.current.get(path);
    if (cached) {
      setTree(cached);
      setExpanded(new Set());
      return;
    }

    setTreeLoading(true);
    setTreeError(null);
    try {
      const { files, folders } = await scanProjectFolder(path);
      const built = buildTree(files, folders);
      treeCache.current.set(path, built);
      setTree(built);
      setExpanded(new Set());
    } catch (err) {
      log.warn("Failed to scan reference project", {
        path,
        error: String(err),
      });
      setTreeError("Couldn't read this project's files.");
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const handleBrowse = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await openReferenceProject(selected);
    }
  }, [openReferenceProject]);

  const handleBack = useCallback(() => {
    setRefProjectPath(null);
    setTree(null);
    setTreeError(null);
    setSelectedFile(null);
    setPreview(null);
  }, []);

  const toggleFolder = useCallback((relativePath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  }, []);

  const selectFile = useCallback((node: TreeNode) => {
    if (!node.absolutePath || node.kind === "folder") return;
    setSelectedFile({
      source: "fs",
      id: node.absolutePath,
      label: node.relativePath,
      absolutePath: node.absolutePath,
      type: node.kind,
    });
  }, []);

  const loadZoteroItemsForKey = useCallback(
    async (cacheKey: string, collectionKey: string | null) => {
      if (zoteroItemsByCollection.has(cacheKey)) return;
      if (!zoteroApiKey || !zoteroUserID) return;

      setZoteroLoadingKeys((prev) => new Set(prev).add(cacheKey));
      setZoteroErrorKeys((prev) => {
        if (!prev.has(cacheKey)) return prev;
        const next = new Map(prev);
        next.delete(cacheKey);
        return next;
      });
      try {
        const items = await fetchLibraryItems(
          zoteroApiKey,
          zoteroUserID,
          collectionKey,
        );
        setZoteroItemsByCollection((prev) =>
          new Map(prev).set(cacheKey, items),
        );
      } catch (err) {
        log.warn("Failed to load Zotero library items", {
          collectionKey,
          error: String(err),
        });
        setZoteroErrorKeys((prev) =>
          new Map(prev).set(cacheKey, "Couldn't load items."),
        );
      } finally {
        setZoteroLoadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(cacheKey);
          return next;
        });
      }
    },
    [zoteroApiKey, zoteroUserID, zoteroItemsByCollection],
  );

  const toggleZoteroNode = useCallback(
    (cacheKey: string, collectionKey: string | null) => {
      setExpandedZoteroCollections((prev) => {
        const next = new Set(prev);
        if (next.has(cacheKey)) {
          next.delete(cacheKey);
        } else {
          next.add(cacheKey);
          loadZoteroItemsForKey(cacheKey, collectionKey);
        }
        return next;
      });
    },
    [loadZoteroItemsForKey],
  );

  const selectZoteroItem = useCallback((item: ZoteroItemSummary) => {
    setSelectedFile({
      source: "zotero",
      id: `zotero:${item.key}`,
      label: item.title,
      itemKey: item.key,
    });
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreview(null);
      return;
    }
    // Zotero content (PDFs, and especially annotations) changes outside this
    // app — never serve a stale snapshot from earlier in the session.
    if (selectedFile.source === "fs") {
      const cached = previewCache.current.get(selectedFile.id);
      if (cached) {
        setPreview(cached);
        return;
      }
    }

    let cancelled = false;
    setPreview({ kind: "loading" });

    const load = async (): Promise<Preview> => {
      if (selectedFile.source === "zotero") {
        if (!zoteroApiKey || !zoteroUserID) {
          return { kind: "error", message: "Not connected to Zotero." };
        }
        const attachment = await findPdfAttachment(
          zoteroApiKey,
          zoteroUserID,
          selectedFile.itemKey,
        );
        if (!attachment) return { kind: "unsupported" };
        if (!attachment.downloadable) {
          return {
            kind: "error",
            message:
              "This item's PDF is a local file link in Zotero, not uploaded to Zotero cloud storage, so it can't be opened from here.",
          };
        }
        const [data, annotationsResult] = await Promise.all([
          downloadAttachmentFile(zoteroApiKey, zoteroUserID, attachment.key),
          fetchAnnotations(zoteroApiKey, zoteroUserID, attachment.key)
            .then((annotations) => ({ annotations, error: undefined }))
            .catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              log.warn("Failed to load Zotero annotations", {
                attachmentKey: attachment.key,
                error: message,
              });
              return { annotations: [] as PdfAnnotationRect[], error: message };
            }),
        ]);
        log.info("Zotero annotations loaded", {
          attachmentKey: attachment.key,
          count: annotationsResult.annotations.length,
          pageIndexes: annotationsResult.annotations.map((a) => a.pageIndex),
          error: annotationsResult.error,
        });
        return {
          kind: "pdf",
          data,
          annotations: annotationsResult.annotations,
          annotationsError: annotationsResult.error,
        };
      }

      switch (selectedFile.type) {
        case "pdf": {
          const data = await readFile(selectedFile.absolutePath);
          return { kind: "pdf", data };
        }
        case "image": {
          const dataUrl = await readImageAsDataUrl(selectedFile.absolutePath);
          return { kind: "image", dataUrl };
        }
        case "tex":
        case "bib":
        case "style":
        case "other": {
          const content = await readTexFileContent(selectedFile.absolutePath);
          if (content.length > MAX_PREVIEW_CHARS) {
            return {
              kind: "text",
              content: content.slice(0, MAX_PREVIEW_CHARS),
              truncated: true,
            };
          }
          return { kind: "text", content, truncated: false };
        }
        default:
          return { kind: "unsupported" };
      }
    };

    load()
      .then((result) => {
        if (cancelled) return;
        if (selectedFile.source === "fs") {
          previewCache.current.set(selectedFile.id, result);
        }
        setPreview(result);
      })
      .catch((err) => {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        log.warn("Failed to load reference preview", {
          id: selectedFile.id,
          error: detail,
        });
        setPreview({
          kind: "error",
          message: `Couldn't open this file. (${detail})`,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile, zoteroApiKey, zoteroUserID]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const refProjectName = refProjectPath
    ? refProjectPath.split(/[/\\]/).pop() || refProjectPath
    : null;
  const zoteroCollectionTree = useMemo(
    () => buildCollectionTree(zoteroCollections),
    [zoteroCollections],
  );

  const searching = zoteroQuery.trim().length > 0;
  // A search spans the library, not whichever collections happen to be open,
  // so it needs the same full item list "My Library" loads — fetched once and
  // then reused by both.
  useEffect(() => {
    if (searching) loadZoteroItemsForKey(MY_LIBRARY_KEY, null);
  }, [searching, loadZoteroItemsForKey]);

  const searchResults = useMemo(() => {
    if (!searching) return [];
    const items = zoteroItemsByCollection.get(MY_LIBRARY_KEY);
    if (!items) return [];
    return searchReferences(items, zoteroQuery, zoteroSort);
  }, [searching, zoteroItemsByCollection, zoteroQuery, zoteroSort]);
  const selectedZoteroItemKey =
    selectedFile?.source === "zotero" ? selectedFile.itemKey : null;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] shrink-0 items-center gap-2 border-border border-b px-3">
        {refProjectPath ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleBack}
            title="Back"
            aria-label="Back"
          >
            <ArrowLeftIcon className="size-3.5" />
          </Button>
        ) : (
          <LibraryIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {refProjectName ?? "Quick reference"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          title="Close"
          aria-label="Close quick reference"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {!refProjectPath && (
        <PanelGroup direction="vertical" className="min-h-0 flex-1">
          <Panel defaultSize={55} minSize={20} className="min-h-0">
            <div className="h-full overflow-y-auto p-2">
              {availableProjects.length === 0 ? (
                <p className="p-3 text-muted-foreground text-xs">
                  No other recent projects yet. Open a folder to reference it
                  here.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {availableProjects.map((p) => (
                    <button
                      key={p.path}
                      type="button"
                      onClick={() => openReferenceProject(p.path)}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-1 border-border border-t p-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleBrowse}
                >
                  Open folder…
                </Button>
              </div>

              <div className="mt-3 border-border border-t pt-2">
                <p className="mb-1 px-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  Zotero
                </p>
                {!zoteroAuthenticated ? (
                  <p className="px-2 text-muted-foreground text-xs">
                    Connect Zotero from the sidebar's Zotero tab to browse your
                    library here.
                  </p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <div className="mb-1 flex items-center gap-1.5 px-2">
                      <div className="relative min-w-0 flex-1">
                        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={zoteroQuery}
                          onChange={(e) => setZoteroQuery(e.target.value)}
                          placeholder="Search title or author…"
                          aria-label="Search references by title or author"
                          className="h-7 pr-7 pl-7 text-xs"
                        />
                        {zoteroQuery && (
                          <button
                            type="button"
                            onClick={() => setZoteroQuery("")}
                            aria-label="Clear search"
                            className="absolute top-1/2 right-1.5 flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <XIcon className="size-3" />
                          </button>
                        )}
                      </div>
                      <Select
                        value={zoteroSort}
                        onValueChange={(value) =>
                          setZoteroSort(value as ReferenceSort)
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="h-7! w-auto shrink-0 text-xs"
                          aria-label="Order references"
                          title="Order references"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REFERENCE_SORTS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {searching ? (
                      <ZoteroSearchResults
                        results={searchResults}
                        loading={zoteroLoadingKeys.has(MY_LIBRARY_KEY)}
                        error={zoteroErrorKeys.get(MY_LIBRARY_KEY)}
                        selectedItemKey={selectedZoteroItemKey}
                        onSelectItem={selectZoteroItem}
                      />
                    ) : (
                      <>
                        <ZoteroTreeRow
                          icon={BookOpenIcon}
                          label="My Library"
                          expanded={expandedZoteroCollections.has(
                            MY_LIBRARY_KEY,
                          )}
                          onToggle={() =>
                            toggleZoteroNode(MY_LIBRARY_KEY, null)
                          }
                        />
                        {expandedZoteroCollections.has(MY_LIBRARY_KEY) && (
                          <ZoteroNestedGroup>
                            <ZoteroItemsSlot
                              items={zoteroItemsByCollection.get(
                                MY_LIBRARY_KEY,
                              )}
                              loading={zoteroLoadingKeys.has(MY_LIBRARY_KEY)}
                              error={zoteroErrorKeys.get(MY_LIBRARY_KEY)}
                              selectedItemKey={selectedZoteroItemKey}
                              onSelectItem={selectZoteroItem}
                              sort={zoteroSort}
                            />
                          </ZoteroNestedGroup>
                        )}
                        {zoteroCollectionTree.map((node) => (
                          <ZoteroCollectionTree
                            key={node.key}
                            node={node}
                            expandedKeys={expandedZoteroCollections}
                            onToggleExpand={toggleZoteroNode}
                            itemsByCollection={zoteroItemsByCollection}
                            loadingKeys={zoteroLoadingKeys}
                            errorKeys={zoteroErrorKeys}
                            selectedItemKey={selectedZoteroItemKey}
                            onSelectItem={selectZoteroItem}
                            sort={zoteroSort}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="h-px bg-border transition-colors hover:bg-ring" />
          <Panel minSize={15} className="min-h-0">
            <FilePreview selectedFile={selectedFile} preview={preview} />
          </Panel>
        </PanelGroup>
      )}

      {refProjectPath && (
        <PanelGroup direction="vertical" className="min-h-0 flex-1">
          <Panel defaultSize={45} minSize={15} className="min-h-0">
            <div className="h-full overflow-y-auto p-1.5">
              {treeLoading && (
                <div className="flex items-center gap-2 p-2 text-muted-foreground text-xs">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Reading project…
                </div>
              )}
              {treeError && (
                <p className="p-2 text-destructive text-xs">{treeError}</p>
              )}
              {tree && !treeLoading && (
                <TreeView
                  node={tree}
                  depth={0}
                  expanded={expanded}
                  onToggleFolder={toggleFolder}
                  selectedPath={
                    selectedFile?.source === "fs" ? selectedFile.label : null
                  }
                  onSelectFile={selectFile}
                />
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="h-px bg-border transition-colors hover:bg-ring" />
          <Panel minSize={15} className="min-h-0">
            <FilePreview selectedFile={selectedFile} preview={preview} />
          </Panel>
        </PanelGroup>
      )}
    </div>
  );
}

/** A single expand/collapse row shared by "My Library" and each collection node. */
function ZoteroTreeRow({
  icon: Icon,
  label,
  expanded,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex w-full items-center rounded-md hover:bg-muted">
      <button
        type="button"
        onClick={onToggle}
        className="flex shrink-0 items-center justify-center px-1 py-1.5"
        title={expanded ? "Collapse" : "Expand"}
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3 text-muted-foreground" />
        )}
      </button>
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    </div>
  );
}

function ZoteroItemRow({
  item,
  isSelected,
  onSelect,
}: {
  item: ZoteroItemSummary;
  isSelected: boolean;
  onSelect: (item: ZoteroItemSummary) => void;
}) {
  const subtitle = [item.creators, item.year].filter(Boolean).join(" · ");
  const files = useDocumentStore((s) => s.files);
  const addItemToBib = useZoteroStore((s) => s.addItemToBib);
  const [adding, setAdding] = useState(false);

  // Every .bib in the project is a candidate target; listing them flat beats a
  // submenu, since projects rarely have more than one or two.
  const bibFiles = useMemo(
    () =>
      files
        .filter((f) => f.name.toLowerCase().endsWith(".bib"))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    [files],
  );

  const handleAdd = useCallback(
    async (targetFileId: string | null, fileLabel: string) => {
      setAdding(true);
      try {
        const result = await addItemToBib(item.key, targetFileId);
        if (result.status === "added") {
          toast.success(`Added to ${result.fileName}`, {
            description: `\\cite{${result.citekey}}`,
          });
        } else if (result.status === "duplicate") {
          toast.info(`Already in ${result.fileName}`, {
            description: `\\cite{${result.citekey}}`,
          });
        } else {
          toast.error(`Could not add to ${fileLabel}`, {
            description: result.message,
          });
        }
      } finally {
        setAdding(false);
      }
    },
    [addItemToBib, item.key],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(item)}
          className={cn(
            "flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-muted",
            isSelected && "bg-muted font-medium",
          )}
        >
          <FileTextIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{item.title}</span>
            {subtitle && (
              <span className="block truncate font-normal text-muted-foreground">
                {subtitle}
              </span>
            )}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {bibFiles.length === 0 ? (
          <ContextMenuItem
            disabled={adding}
            onClick={() => handleAdd(null, DEFAULT_BIB_FILE_NAME)}
          >
            <PlusIcon className="size-3.5" />
            Add to new {DEFAULT_BIB_FILE_NAME}
          </ContextMenuItem>
        ) : (
          bibFiles.map((file) => (
            <ContextMenuItem
              key={file.id}
              disabled={adding}
              onClick={() => handleAdd(file.id, file.name)}
            >
              <PlusIcon className="size-3.5" />
              <span className="truncate">Add to {file.relativePath}</span>
            </ContextMenuItem>
          ))
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Loading/error/items shown under an expanded collection or "My Library". */
function ZoteroItemsSlot({
  items,
  loading,
  error,
  selectedItemKey,
  onSelectItem,
  sort,
}: {
  items: ZoteroItemSummary[] | undefined;
  loading: boolean;
  error: string | undefined;
  selectedItemKey: string | null;
  onSelectItem: (item: ZoteroItemSummary) => void;
  sort: ReferenceSort;
}) {
  const ordered = useMemo(
    () => (items ? sortReferences(items, sort) : undefined),
    [items, sort],
  );

  return (
    <>
      {loading && (
        <div className="flex items-center gap-2 py-1 text-muted-foreground text-xs">
          <Loader2Icon className="size-3 animate-spin" />
          Loading…
        </div>
      )}
      {error && <p className="py-1 text-destructive text-xs">{error}</p>}
      {ordered?.length === 0 && !loading && !error && (
        <p className="py-1 text-muted-foreground text-xs">No items here.</p>
      )}
      {ordered?.map((item) => (
        <ZoteroItemRow
          key={item.key}
          item={item}
          isSelected={selectedItemKey === item.key}
          onSelect={onSelectItem}
        />
      ))}
    </>
  );
}

/** A flat, already-ordered result list. A search spans the whole library, so
 * the collection tree it replaces would have nothing useful to say about
 * where each hit lives. */
function ZoteroSearchResults({
  results,
  loading,
  error,
  selectedItemKey,
  onSelectItem,
}: {
  results: ZoteroItemSummary[];
  loading: boolean;
  error: string | undefined;
  selectedItemKey: string | null;
  onSelectItem: (item: ZoteroItemSummary) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-muted-foreground text-xs">
        <Loader2Icon className="size-3 animate-spin" />
        Searching your library…
      </div>
    );
  }
  if (error) {
    return <p className="px-2 py-1 text-destructive text-xs">{error}</p>;
  }
  if (results.length === 0) {
    return (
      <p className="px-2 py-1 text-muted-foreground text-xs">
        No references match. Try fewer words, or scope one with{" "}
        <code>author:</code> or <code>title:</code>.
      </p>
    );
  }
  return (
    <>
      <p className="px-2 py-1 text-muted-foreground text-xs">
        {results.length} {results.length === 1 ? "match" : "matches"}
      </p>
      {results.map((item) => (
        <ZoteroItemRow
          key={item.key}
          item={item}
          isSelected={selectedItemKey === item.key}
          onSelect={onSelectItem}
        />
      ))}
    </>
  );
}

/** Wraps an expanded node's children in a left guide-line + indent, so nested
 * collections and their articles visually read as "contained within" their
 * parent rather than as independent, same-level rows. */
function ZoteroNestedGroup({ children }: { children: ReactNode }) {
  return <div className="ml-[9px] border-border border-l pl-3">{children}</div>;
}

function ZoteroCollectionTree({
  node,
  expandedKeys,
  onToggleExpand,
  itemsByCollection,
  loadingKeys,
  errorKeys,
  selectedItemKey,
  onSelectItem,
  sort,
}: {
  node: ZoteroCollectionNode;
  expandedKeys: Set<string>;
  onToggleExpand: (cacheKey: string, collectionKey: string | null) => void;
  itemsByCollection: Map<string, ZoteroItemSummary[]>;
  loadingKeys: Set<string>;
  errorKeys: Map<string, string>;
  selectedItemKey: string | null;
  onSelectItem: (item: ZoteroItemSummary) => void;
  sort: ReferenceSort;
}) {
  const isExpanded = expandedKeys.has(node.key);

  return (
    <>
      <ZoteroTreeRow
        icon={FolderIcon}
        label={node.name}
        expanded={isExpanded}
        onToggle={() => onToggleExpand(node.key, node.key)}
      />
      {isExpanded && (
        <ZoteroNestedGroup>
          <ZoteroItemsSlot
            items={itemsByCollection.get(node.key)}
            loading={loadingKeys.has(node.key)}
            error={errorKeys.get(node.key)}
            selectedItemKey={selectedItemKey}
            onSelectItem={onSelectItem}
            sort={sort}
          />
          {node.children.map((child) => (
            <ZoteroCollectionTree
              key={child.key}
              node={child}
              expandedKeys={expandedKeys}
              onToggleExpand={onToggleExpand}
              itemsByCollection={itemsByCollection}
              loadingKeys={loadingKeys}
              errorKeys={errorKeys}
              selectedItemKey={selectedItemKey}
              onSelectItem={onSelectItem}
              sort={sort}
            />
          ))}
        </ZoteroNestedGroup>
      )}
    </>
  );
}

function TreeView({
  node,
  depth,
  expanded,
  onToggleFolder,
  selectedPath,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  selectedPath: string | null;
  onSelectFile: (node: TreeNode) => void;
}) {
  return (
    <>
      {node.children?.map((child) => {
        if (child.kind === "folder") {
          const isExpanded = expanded.has(child.relativePath);
          const FolderIconComp = isExpanded
            ? FolderOpenDotIcon
            : FolderOpenIcon;
          return (
            <div key={child.relativePath}>
              <button
                type="button"
                onClick={() => onToggleFolder(child.relativePath)}
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs transition-colors hover:bg-muted"
                style={{ paddingLeft: depth * 14 + 4 }}
              >
                {isExpanded ? (
                  <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
                )}
                <FolderIconComp className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{child.name}</span>
              </button>
              {isExpanded && (
                <TreeView
                  node={child}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggleFolder={onToggleFolder}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectFile}
                />
              )}
            </div>
          );
        }

        const Icon = fileIcon(child.kind);
        const isSelected = selectedPath === child.relativePath;
        return (
          <button
            key={child.relativePath}
            type="button"
            onClick={() => onSelectFile(child)}
            className={cn(
              "flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs transition-colors hover:bg-muted",
              isSelected && "bg-muted font-medium",
            )}
            style={{ paddingLeft: depth * 14 + 20 }}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{child.name}</span>
          </button>
        );
      })}
    </>
  );
}

/** Per-file zoom cache, mirroring the main PDF preview's per-root cache. */
const pdfZoomCache = new Map<string, number>();

function FilePreview({
  selectedFile,
  preview,
}: {
  selectedFile: SelectedFile | null;
  preview: Preview | null;
}) {
  const [scale, setScale] = useState(1);
  const pdfDarkMode = useSettingsStore((s) => s.pdfDarkModeReference);
  const setPdfDarkMode = useSettingsStore((s) => s.setPdfDarkModeReference);

  useEffect(() => {
    if (selectedFile) {
      setScale(pdfZoomCache.get(selectedFile.id) ?? 1);
    }
  }, [selectedFile]);

  const handleScaleChange = useCallback(
    (next: number) => {
      setScale(next);
      if (selectedFile) pdfZoomCache.set(selectedFile.id, next);
    },
    [selectedFile],
  );

  const zoomIn = useCallback(
    () => handleScaleChange(Math.min(4, scale + 0.1)),
    [handleScaleChange, scale],
  );
  const zoomOut = useCallback(
    () => handleScaleChange(Math.max(0.25, scale - 0.1)),
    [handleScaleChange, scale],
  );

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground text-xs">
        Select a file to preview it here.
      </div>
    );
  }

  if (!preview || preview.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-xs">
        <Loader2Icon className="size-3.5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (preview.kind === "error") {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-destructive text-xs">
        {preview.message}
      </div>
    );
  }

  if (preview.kind === "unsupported") {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground text-xs">
        {selectedFile.source === "zotero"
          ? "This item doesn't have a PDF attachment."
          : "Preview isn't available for this file type."}
      </div>
    );
  }

  if (preview.kind === "text") {
    return (
      <div className="h-full overflow-auto p-3">
        {preview.truncated && (
          <p className="mb-2 text-amber-600 text-xs dark:text-amber-500">
            File is large — showing the first part only.
          </p>
        )}
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
          {preview.content}
        </pre>
      </div>
    );
  }

  if (preview.kind === "image") {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-3">
        {/* biome-ignore lint/a11y/useAltText: reference-only thumbnail, filename shown above */}
        <img
          src={preview.dataUrl}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  // preview.kind === "pdf"
  const annotationCount = preview.annotations?.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-border border-b px-2">
        {preview.annotationsError ? (
          <span
            className="min-w-0 truncate text-destructive text-xs"
            title={preview.annotationsError}
          >
            Annotations: {preview.annotationsError}
          </span>
        ) : (
          <span className="min-w-0 truncate text-muted-foreground text-xs">
            {annotationCount > 0
              ? `${annotationCount} annotation${annotationCount === 1 ? "" : "s"}`
              : "No annotations found"}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={zoomOut}
            disabled={scale <= 0.25}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <MinusIcon className="size-3.5" />
          </Button>
          <span className="w-10 text-center text-muted-foreground text-xs tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={zoomIn}
            disabled={scale >= 4}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
      </div>
      <PdfViewer
        data={preview.data}
        scale={scale}
        rootFileId={selectedFile.id}
        onScaleChange={handleScaleChange}
        annotations={preview.annotations}
        darkMode={pdfDarkMode}
        onToggleDarkMode={() => setPdfDarkMode(!pdfDarkMode)}
      />
    </div>
  );
}
