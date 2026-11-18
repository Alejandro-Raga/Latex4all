import { pdfVersion } from "@/lib/pdf-notes";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  useContext,
} from "react";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { readFile, stat } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Panel, PanelGroup } from "react-resizable-panels";
import { setReaderFull, useReaderFull } from "@/stores/reader-full-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { addPdfToZotero } from "@/lib/zotero-file-upload";
import { inProject, useNav } from "@/stores/nav-store";
import { LibraryPage } from "./vault-standalone";

const FULL_KEY =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
    ? "⌘F"
    : "Ctrl+F";
import {
  ListPlusIcon,
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
  Maximize2Icon,
  Minimize2Icon,
  PanelBottomIcon,
  PanelRightIcon,
  PlusIcon,
  BookOpenIcon,
  MessageSquarePlusIcon,
  PaperclipIcon,
  SearchIcon,
  StarIcon,
  XIcon,
  type LucideIcon,
  NotebookTextIcon,
  RefreshCwIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useProjectStore } from "@/stores/project-store";
import { useDocumentStore } from "@/stores/document-store";
import { DEFAULT_BIB_FILE_NAME, useZoteroStore } from "@/stores/zotero-store";
import {
  type PaperFocus,
  type ReadingPaper,
  useReadingStore,
} from "@/stores/reading-store";
import {
  openPaperInTab,
  useLibraryPreview,
} from "@/components/zotero-pdf-dialog";
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
  findPdfAttachment,
  fetchAnnotations,
  type ZoteroItemSummary,
} from "@/lib/zotero-api";
import {
  filterByConditions,
  NO_REFERENCE_FILTER,
  REFERENCE_SORTS,
  type ReferenceFilter,
  referenceFilterActive,
  searchReferences,
  sortReferences,
  type ReferenceSort,
} from "@/lib/zotero-search";
import { PaperReader } from "./preview/paper-reader";
import type { PdfAnnotationRect } from "./preview/pdf-viewer";
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
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  addReferencePdfToChat,
  importReferencePdf,
  type ReferencePdfSource,
} from "@/lib/reference-import";
import { cn } from "@/lib/utils";
import type { CitePlace } from "@/lib/vault/project-note";
import { itemsIn, pdfOf, useZoteroLibrary } from "@/lib/zotero-library";
import { zoteroPdfBytes } from "@/lib/zotero-pdf-cache";
import { addPaperToVault } from "@/lib/vault/add-paper";
import { useVaultStore } from "@/stores/vault-store";
import { useSettingsWindow } from "@/stores/settings-window-store";
import {
  CitedAt,
  CitedHeader,
  type CitedOrder,
  CitedToggle,
  orderCited,
  useCitedItems,
} from "./cited-here";
import {
  addCitekeysToVault,
  addCitekeysToZoteroWithToast,
} from "./citation-check";
import { AddToReadingMenu } from "@/components/planner/reading-menu";
import { ConnectionPills } from "./connection-pills";
import { openInVault } from "./highlight-quote";
import { ConnectNoteMenu } from "./topic-menu";
import { useQuickTask } from "@/components/planner/quick-task";
import { groupProjects } from "@/lib/project-grouping";
import { LibraryFilterRow } from "./library-filter";
import { FilterToggle } from "./vault-filter";
import { createLogger } from "@/lib/debug/logger";
import { DockHeaderBar, DockWideButton } from "./dock/dock-section";
import { canOpenPdf } from "@/lib/zotero-source";

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
      /** The Zotero attachment it came from, where new highlights go. */
      attachmentKey?: string;
    }
  | { kind: "image"; dataUrl: string }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

const LIBRARY_PLACE = "latex4all-library-place";

/** The same file read twice: a PDF's bytes, or the text, alike. */
function samePreview(a: Preview, b: Preview): boolean {
  if (a.kind === "pdf" && b.kind === "pdf") {
    return (
      a.data.length === b.data.length &&
      pdfVersion(a.data) === pdfVersion(b.data)
    );
  }
  if (a.kind === "text" && b.kind === "text") return a.content === b.content;
  if (a.kind === "image" && b.kind === "image") return a.dataUrl === b.dataUrl;
  return a.kind === b.kind && a.kind !== "loading" && a.kind !== "error";
}

type SelectedFile =
  | {
      source: "fs";
      id: string;
      label: string;
      absolutePath: string;
      type: ProjectFileType;
      /** Where to open it (a note's link to a highlight). */
      focus?: PaperFocus;
    }
  | {
      source: "zotero";
      id: string;
      label: string;
      itemKey: string;
      /** A highlight or page to bring into view (a note's link). */
      focus?: PaperFocus;
    };

/** Sentinel cache/expand key for "My Library" (all items, no collection filter). */
const MY_LIBRARY_KEY = "__zotero_my_library__";

function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

export function QuickReferencePanel({
  onClose,
  closeOnEscape = true,
}: {
  onClose: () => void;
  /** Off in the library, where Esc is for the reader and the dialogs. */
  closeOnEscape?: boolean;
}) {
  const recentProjects = useProjectStore((s) => s.recentProjects);
  // On the Library page, the project open behind it (if any) isn't this
  // library's: it reads and opens papers as with no project.
  const onLibraryPage = useContext(LibraryPage);
  const openProjectRoot = useDocumentStore((s) => s.projectRoot);
  const currentProjectRoot = onLibraryPage ? null : openProjectRoot;
  const zoteroAuthenticated = useZoteroStore((s) => s.isAuthenticated);
  const zoteroApiKey = useZoteroStore((s) => s.apiKey);
  const zoteroUserID = useZoteroStore((s) => s.userID);
  const liveCollections = useZoteroStore((s) => s.collections);
  const savedCollections = useZoteroLibrary((s) => s.mirror?.collections);
  // The saved ones straight away; Zotero's own once they've been fetched.
  const zoteroCollections =
    liveCollections.length > 0 ? liveCollections : (savedCollections ?? []);

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
  // The library as last seen, kept on disk: there at once on launch, and
  // brought up to date in the background (see zotero-library.ts).
  const library = useZoteroLibrary((s) => s.mirror);
  const libraryLoading = useZoteroLibrary((s) => s.loading);
  const libraryError = useZoteroLibrary((s) => s.error);
  const libraryReady = Boolean(library && library.version > 0);
  const zoteroItemsByCollection = useMemo(() => {
    const byKey = new Map<string, ZoteroItemSummary[]>();
    if (!library || !libraryReady) return byKey;
    const all = itemsIn(library, null);
    byKey.set(MY_LIBRARY_KEY, all);
    for (const item of all) {
      for (const c of item.collections) {
        const list = byKey.get(c);
        if (list) list.push(item);
        else byKey.set(c, [item]);
      }
    }
    for (const c of library.collections) {
      if (!byKey.has(c.key)) byKey.set(c.key, []);
    }
    return byKey;
  }, [library, libraryReady]);
  const everyZoteroKey = useMemo(
    () => [MY_LIBRARY_KEY, ...zoteroCollections.map((c) => c.key)],
    [zoteroCollections],
  );
  const zoteroLoadingKeys = useMemo(
    () => new Set(libraryLoading && !libraryReady ? everyZoteroKey : []),
    [libraryLoading, libraryReady, everyZoteroKey],
  );
  const zoteroErrorKeys = useMemo(
    () =>
      new Map(
        libraryError && !libraryReady
          ? everyZoteroKey.map((k) => [k, "Couldn't load the library."])
          : [],
      ),
    [libraryError, libraryReady, everyZoteroKey],
  );
  const [zoteroQuery, setZoteroQuery] = useState("");
  const [zoteroSort, setZoteroSort] = useState<ReferenceSort>("relevance");
  const [zoteroFilter, setZoteroFilter] =
    useState<ReferenceFilter>(NO_REFERENCE_FILTER);
  const [showZoteroFilters, setShowZoteroFilters] = useState(false);
  const [citedOnly, setCitedOnly] = useState(false);
  const [citedOrder, setCitedOrder] = useState<CitedOrder>("text");
  const cited = useCitedItems(citedOnly);
  const vaultReady = useVaultStore((s) => Boolean(s.index));

  const treeCache = useRef(new Map<string, TreeNode>());
  const previewCache = useRef(new Map<string, Preview>());

  useEffect(() => {
    if (zoteroAuthenticated && zoteroApiKey && zoteroUserID) {
      useZoteroLibrary.getState().ensure(zoteroApiKey, zoteroUserID);
    }
  }, [zoteroAuthenticated, zoteroApiKey, zoteroUserID]);

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

    // The last read shown at once; read again for what's changed since.
    const cached = treeCache.current.get(path);
    if (cached) {
      setTree(cached);
      setExpanded(new Set());
    } else {
      setTreeLoading(true);
    }
    setTreeError(null);
    try {
      const { files, folders } = await scanProjectFolder(path);
      const built = buildTree(files, folders);
      treeCache.current.set(path, built);
      setTree(built);
      if (!cached) setExpanded(new Set());
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

  const toggleZoteroNode = useCallback(
    (cacheKey: string, _collectionKey: string | null) => {
      setExpandedZoteroCollections((prev) => {
        const next = new Set(prev);
        if (next.has(cacheKey)) next.delete(cacheKey);
        else next.add(cacheKey);
        return next;
      });
    },
    [],
  );

  // The Library page as you left it: the paper or PDF open, the project
  // being looked through, the collections unfolded. Restored once, before
  // any paper asked of it (which then takes its place).
  useEffect(() => {
    if (!onLibraryPage) return;
    try {
      const saved = JSON.parse(localStorage.getItem(LIBRARY_PLACE) ?? "null");
      if (!saved) return;
      if (typeof saved.project === "string") {
        void openReferenceProject(saved.project);
      }
      if (saved.file && typeof saved.file.id === "string") {
        setSelectedFile(saved.file as SelectedFile);
      }
      if (Array.isArray(saved.collections)) {
        setExpandedZoteroCollections(new Set(saved.collections as string[]));
      }
    } catch {
      // Opens as new.
    }
  }, []);
  useEffect(() => {
    if (!onLibraryPage) return;
    const file = selectedFile
      ? selectedFile.source === "fs"
        ? {
            source: "fs",
            id: selectedFile.id,
            label: selectedFile.label,
            absolutePath: selectedFile.absolutePath,
            type: selectedFile.type,
          }
        : {
            source: "zotero",
            id: selectedFile.id,
            label: selectedFile.label,
            itemKey: selectedFile.itemKey,
          }
      : null;
    try {
      localStorage.setItem(
        LIBRARY_PLACE,
        JSON.stringify({
          file,
          project: refProjectPath,
          collections: [...expandedZoteroCollections],
        }),
      );
    } catch {
      // For this session.
    }
  }, [onLibraryPage, selectedFile, refProjectPath, expandedZoteroCollections]);

  // Asked for a project's folder (from its editor): that one, here.
  const navAsked = useNav((st) => st.asked);
  useEffect(() => {
    if (!onLibraryPage) return;
    const { focus, section } = useNav.getState();
    if (navAsked && focus && section === "library") {
      void openReferenceProject(focus);
    }
  }, [navAsked]);

  // A note's highlight link, with no project open: shown here.
  useEffect(() => {
    useLibraryPreview.setState((s) => ({ listening: s.listening + 1 }));
    // Only where you are: the Library page, or the project's own panel.
    const here = () => (onLibraryPage ? !inProject() : inProject());
    const show = (
      request: ReturnType<typeof useLibraryPreview.getState>["request"],
    ) => {
      if (!request || !here()) return;
      useLibraryPreview.getState().done();
      setSelectedFile({
        source: "zotero",
        id: `zotero:${request.itemKey}`,
        label: request.label,
        itemKey: request.itemKey,
        focus: request.focus,
      });
    };
    // A PDF on this computer (a project's, from a reading list).
    const showFile = (
      file: ReturnType<typeof useLibraryPreview.getState>["file"],
    ) => {
      if (!file || !here()) return;
      useLibraryPreview.getState().done();
      setSelectedFile({
        source: "fs",
        id: file.path,
        label: file.label,
        absolutePath: file.path,
        type: "pdf",
        focus: file.focus,
      });
    };
    show(useLibraryPreview.getState().request);
    showFile(useLibraryPreview.getState().file);
    const unsubscribe = useLibraryPreview.subscribe((s) => {
      show(s.request);
      showFile(s.file);
    });
    return () => {
      unsubscribe();
      useLibraryPreview.setState((s) => ({ listening: s.listening - 1 }));
    };
  }, []);

  const showZoteroItem = useCallback((item: ZoteroItemSummary) => {
    setSelectedFile({
      source: "zotero",
      id: `zotero:${item.key}`,
      label: item.title,
      itemKey: item.key,
    });
  }, []);

  const selectZoteroItem = useCallback(
    (item: ZoteroItemSummary) => {
      // In a project, a paper opens in a tab of the big PDF pane (its
      // header moves it here); here when it has no PDF, to say so.
      if (currentProjectRoot) {
        void openPaperInTab(item.key, item.title).then((opened) => {
          if (!opened) {
            setSelectedFile({
              source: "zotero",
              id: `zotero:${item.key}`,
              label: item.title,
              itemKey: item.key,
            });
          }
        });
        return;
      }
      showZoteroItem(item);
    },
    [currentProjectRoot, showZoteroItem],
  );

  useEffect(() => {
    if (!selectedFile) {
      setPreview(null);
      return;
    }
    // Zotero content (PDFs, and especially annotations) changes outside this
    // app — never serve a stale snapshot from earlier in the session.
    // A file of a project: the last read shown at once, read again anyway
    // (a draft re-exported since shows as it is now).
    const cached =
      selectedFile.source === "fs"
        ? previewCache.current.get(selectedFile.id)
        : undefined;

    let cancelled = false;
    setPreview(cached ?? { kind: "loading" });

    const load = async (): Promise<Preview> => {
      if (selectedFile.source === "zotero") {
        if (!zoteroApiKey || !zoteroUserID) {
          return { kind: "error", message: "Not connected to Zotero." };
        }
        // Where the PDF is, from the saved library when it knows (offline
        // too), else asked of Zotero.
        const known = useZoteroLibrary.getState().mirror;
        const attachment =
          (known && pdfOf(known, selectedFile.itemKey)) ??
          (await findPdfAttachment(
            zoteroApiKey,
            zoteroUserID,
            selectedFile.itemKey,
          ));
        if (!attachment) return { kind: "unsupported" };
        if (!(await canOpenPdf(attachment))) {
          return {
            kind: "error",
            message:
              "This PDF is a linked file in Zotero, not uploaded to Zotero storage. Open Zotero to view it here.",
          };
        }
        const [data, annotationsResult] = await Promise.all([
          zoteroPdfBytes(zoteroApiKey, zoteroUserID, attachment),
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
          attachmentKey: attachment.key,
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
          // Unchanged on disk: what's shown stays (no reload, no lost place).
          if (cached && samePreview(cached, result)) return;
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
    if (!closeOnEscape) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, closeOnEscape]);

  // Without a project there's no PDF pane: a paper is read here, below the
  // list or beside it, or across the whole pane.
  const [previewSide, setPreviewSide] = useStoredChoice<"below" | "beside">(
    "quick-reference-preview-side",
    "below",
    ["below", "beside"],
  );
  const previewFull = useReaderFull((s) => s.on);
  const setPreviewFull = (next: boolean | ((on: boolean) => boolean)) => {
    const { on } = useReaderFull.getState();
    setReaderFull(typeof next === "function" ? next(on) : next);
  };
  // Off when the panel goes (or a project opens): never stuck on.
  useEffect(() => () => useReaderFull.getState().set(false), []);
  // Esc leaves the full window; ⌘F (Ctrl+F) goes in and out, while a
  // paper is open here and there's no project (whose editor has ⌘F).
  const canFull = !currentProjectRoot && !!selectedFile;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useReaderFull.getState().on) {
        setReaderFull(false);
        return;
      }
      if (
        canFull &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        setReaderFull(!useReaderFull.getState().on);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [canFull]);
  const beside = previewSide === "beside";
  const fullPreview = previewFull && !currentProjectRoot;
  const direction = beside && !currentProjectRoot ? "horizontal" : "vertical";
  const readerControls = currentProjectRoot
    ? undefined
    : {
        beside,
        full: previewFull,
        toggleSide: () => setPreviewSide(beside ? "below" : "beside"),
        toggleFull: () => setPreviewFull((f) => !f),
      };

  const refProjectName = refProjectPath
    ? refProjectPath.split(/[/\\]/).pop() || refProjectPath
    : null;
  const zoteroCollectionTree = useMemo(
    () => buildCollectionTree(zoteroCollections),
    [zoteroCollections],
  );

  // A search or a picked condition lists the whole library's matches.
  const searching =
    zoteroQuery.trim().length > 0 || referenceFilterActive(zoteroFilter);

  const searchResults = useMemo(() => {
    if (!searching) return [];
    const items = zoteroItemsByCollection.get(MY_LIBRARY_KEY);
    if (!items) return [];
    return searchReferences(items, zoteroQuery, zoteroSort, zoteroFilter);
  }, [
    searching,
    zoteroItemsByCollection,
    zoteroQuery,
    zoteroSort,
    zoteroFilter,
  ]);
  const recentPapers = useBookmarkStore((st) => st.recent).slice(0, 8);
  const selectedZoteroItemKey =
    selectedFile?.source === "zotero" ? selectedFile.itemKey : null;

  // Only once something is picked: an empty preview is wasted room.
  const previewPane = selectedFile && (
    <>
      {!fullPreview && (
        <ResizeHandle
          direction={beside && !currentProjectRoot ? "vertical" : "horizontal"}
        />
      )}
      <Panel
        id="preview"
        order={2}
        defaultSize={50}
        minSize={15}
        className="min-h-0 min-w-0"
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center gap-1.5 border-border border-b px-2 py-1">
            <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
              {selectedFile.label}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={() => {
                setSelectedFile(null);
                setPreview(null);
                setPreviewFull(false);
              }}
              title="Close the preview"
              aria-label="Close the preview"
            >
              <XIcon className="size-3" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <FilePreview
              selectedFile={selectedFile}
              preview={preview}
              reader={readerControls}
            />
          </div>
        </div>
      </Panel>
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <DockHeaderBar>
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
          {refProjectName ?? "Library"}
        </span>
        <DockWideButton />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          title="Close"
          aria-label="Close the Library"
        >
          <XIcon className="size-3.5" />
        </Button>
      </DockHeaderBar>

      {!refProjectPath && (
        <PanelGroup
          key={direction}
          direction={direction}
          className="min-h-0 flex-1"
        >
          {!fullPreview && (
            <Panel
              id="browse"
              order={1}
              defaultSize={55}
              minSize={20}
              className="min-h-0"
            >
              <div className="h-full overflow-y-auto p-2">
                {recentPapers.length > 0 && (
                  <FoldSection
                    id="recent"
                    title="Recently opened"
                    count={recentPapers.length}
                  >
                    <div className="flex flex-col">
                      {recentPapers.map((r) => (
                        <button
                          key={r.itemKey}
                          type="button"
                          onClick={() =>
                            selectZoteroItem({
                              key: r.itemKey,
                              title: r.label,
                            } as ZoteroItemSummary)
                          }
                          className={cn(
                            "flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted/70",
                            selectedFile?.source === "zotero" &&
                              selectedFile.itemKey === r.itemKey &&
                              "bg-muted",
                          )}
                        >
                          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {r.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </FoldSection>
                )}
                <FoldSection
                  id="projects"
                  title="Projects"
                  count={availableProjects.length}
                  action={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={handleBrowse}
                      title="Open folder…"
                      aria-label="Open folder"
                    >
                      <FolderOpenIcon className="size-3.5" />
                    </Button>
                  }
                >
                  <ReferenceProjects
                    projects={availableProjects}
                    onOpen={openReferenceProject}
                    onBrowse={handleBrowse}
                  />
                </FoldSection>

                <FoldSection
                  id="zotero"
                  title="Zotero"
                  action={zoteroAuthenticated ? <ZoteroRefresh /> : undefined}
                >
                  {!zoteroAuthenticated ? (
                    <button
                      type="button"
                      onClick={() =>
                        useSettingsWindow.getState().show("zotero")
                      }
                      className="px-2 py-1 text-left text-muted-foreground text-xs hover:text-foreground"
                    >
                      Connect Zotero in Settings to browse your library here.
                    </button>
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
                            title="Also: author:nelson, year:1990-2005, year:>2010, type:book"
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
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.value === "relevance" &&
                                !zoteroQuery.trim()
                                  ? "Default"
                                  : option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FilterToggle
                          open={showZoteroFilters}
                          active={referenceFilterActive(zoteroFilter)}
                          onToggle={() => setShowZoteroFilters((v) => !v)}
                        />
                        {currentProjectRoot && (
                          <CitedToggle on={citedOnly} onChange={setCitedOnly} />
                        )}
                      </div>
                      {showZoteroFilters && (
                        <LibraryFilterRow
                          items={
                            zoteroItemsByCollection.get(MY_LIBRARY_KEY) ?? []
                          }
                          filter={zoteroFilter}
                          onChange={setZoteroFilter}
                        />
                      )}
                      {citedOnly && currentProjectRoot ? (
                        <>
                          <CitedHeader
                            order={citedOrder}
                            onOrder={setCitedOrder}
                          >
                            {!libraryReady ? (
                              "Loading your library…"
                            ) : (
                              <>
                                {cited.items.length} cited in this project
                                {cited.missing.length > 0 && (
                                  <>
                                    {" · "}
                                    <span title={cited.missing.join(", ")}>
                                      {cited.missing.length} not in Zotero:
                                    </span>{" "}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void addCitekeysToZoteroWithToast(
                                          cited.missing,
                                        )
                                      }
                                      className="text-primary hover:underline"
                                    >
                                      add
                                    </button>
                                    {vaultReady && (
                                      <>
                                        {" · "}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void addCitekeysToVault(
                                              cited.missing,
                                            )
                                          }
                                          className="text-primary hover:underline"
                                          title="Adds them to Zotero, then writes their notes"
                                        >
                                          add with notes
                                        </button>
                                      </>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </CitedHeader>
                          {orderCited(
                            matchingQuery(
                              cited.items.filter(
                                (c) =>
                                  filterByConditions([c.item], zoteroFilter)
                                    .length > 0,
                              ),
                              zoteroQuery,
                            ),
                            (c) => c.places,
                            (c) => cited.items.indexOf(c),
                            citedOrder,
                          ).map(({ item, places }) => (
                            <ZoteroItemRow
                              key={item.key}
                              item={item}
                              isSelected={selectedZoteroItemKey === item.key}
                              onSelect={selectZoteroItem}
                              places={places}
                            />
                          ))}
                        </>
                      ) : searching ? (
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
                            collectionKey={null}
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
                </FoldSection>
              </div>
            </Panel>
          )}
          {previewPane}
        </PanelGroup>
      )}

      {refProjectPath && (
        <PanelGroup
          key={direction}
          direction={direction}
          className="min-h-0 flex-1"
        >
          {!fullPreview && (
            <Panel
              id="browse"
              order={1}
              defaultSize={45}
              minSize={15}
              className="min-h-0"
            >
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
          )}
          {previewPane}
        </PanelGroup>
      )}
    </div>
  );
}

/** A choice remembered on this computer. */
function useStoredChoice<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      return stored && allowed.includes(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Remembered for this session only.
    }
  };
  return [value, set];
}

/** Whether a section is folded, remembered on this computer. */
function useFolded(id: string): [boolean, (folded: boolean) => void] {
  const storageKey = `quick-reference-folded:${id}`;
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setFolded(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {}
  };
  return [folded, set];
}

/** A titled section that folds away. */
function FoldSection({
  id,
  title,
  count,
  action,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [folded, setFolded] = useFolded(id);
  return (
    <div className="mb-2 border-border border-b pb-2 last:border-b-0">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={() => setFolded(!folded)}
          aria-expanded={!folded}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide hover:text-foreground"
        >
          {folded ? (
            <ChevronRightIcon className="size-3 shrink-0" />
          ) : (
            <ChevronDownIcon className="size-3 shrink-0" />
          )}
          {title}
          {count !== undefined && count > 0 && (
            <span className="font-normal normal-case">{count}</span>
          )}
        </button>
        {action}
      </div>
      {!folded && <div className="pt-1">{children}</div>}
    </div>
  );
}

const PROJECTS_SHOWN = 5;

/** Other projects to reference: starred first, then the latest opened. */
function ReferenceProjects({
  projects,
  onOpen,
  onBrowse,
}: {
  projects: { path: string; name: string; lastOpened: number }[];
  onOpen: (path: string) => void;
  onBrowse: () => void;
}) {
  const favorites = useProjectStore((s) => s.favorites);
  const projectTypes = useProjectStore((s) => s.projectTypes);
  const addedAt = useProjectStore((s) => s.addedAt);
  const [query, setQuery] = useState("");
  // Sections folded shut, by type; with many projects, all but favourites
  // start folded.
  const [folded, setFolded] = useState<Set<string> | null>(null);
  const types = useMemo(
    () =>
      new Map(
        Object.entries(projectTypes).map(([path, type]) => [
          normalizePath(path),
          type,
        ]),
      ),
    [projectTypes],
  );
  const groups = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const typeOf = (path: string) => types.get(normalizePath(path)) ?? "";
    const matching = projects.filter((p) =>
      words.every(
        (w) =>
          p.name.toLowerCase().includes(w) ||
          typeOf(p.path).toLowerCase().includes(w),
      ),
    );
    return groupProjects({
      projects: matching,
      sort: "type",
      favorites: new Set(
        projects
          .filter((p) =>
            favorites.some((f) => normalizePath(f) === normalizePath(p.path)),
          )
          .map((p) => p.path),
      ),
      types: new Map(
        matching.flatMap((p) => {
          const type = typeOf(p.path);
          return type ? [[p.path, type] as const] : [];
        }),
      ),
      addedAt: new Map(Object.entries(addedAt)),
    });
  }, [projects, favorites, types, addedAt, query]);

  if (projects.length === 0) {
    return (
      <button
        type="button"
        onClick={onBrowse}
        className="px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
      >
        Open a folder to reference it here.
      </button>
    );
  }
  const shut =
    folded ??
    new Set(
      projects.length > PROJECTS_SHOWN * 2
        ? groups.filter((g) => g.key !== "favorites").map((g) => g.key)
        : [],
    );
  const toggle = (key: string) => {
    const next = new Set(shut);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFolded(next);
  };
  return (
    <div className="flex flex-col gap-0.5">
      {projects.length > PROJECTS_SHOWN && (
        <div className="relative mb-1 px-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a project or type…"
            aria-label="Find a project"
            className="h-7 pl-7 text-xs"
          />
        </div>
      )}
      {groups.map((group) => {
        const open = query !== "" || !shut.has(group.key);
        return (
          <div key={group.key}>
            {group.label && (
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={open}
                className="flex w-full items-center gap-1 px-2 pt-1.5 pb-0.5 text-left font-medium text-[11px] text-muted-foreground uppercase tracking-wide hover:text-foreground"
              >
                {open ? (
                  <ChevronDownIcon className="size-3" />
                ) : (
                  <ChevronRightIcon className="size-3" />
                )}
                {group.label}
                <span className="ml-1 normal-case">
                  {group.projects.length}
                </span>
              </button>
            )}
            {open &&
              group.projects.map((p) => (
                <ProjectRow key={p.path} project={p} onOpen={onOpen} />
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** What can be done with a project's PDF: the same as with a Zotero paper. */
function ProjectPdfMenu({ path, name }: { path: string; name: string }) {
  const title = name.replace(/\.pdf$/i, "");
  return (
    <ContextMenuContent className="w-56">
      <ContextMenuItem
        onClick={() =>
          useLibraryPreview.getState().askFile({ path, label: title })
        }
      >
        <BookOpenIcon className="size-3.5" />
        Read
      </ContextMenuItem>
      <ReferencePdfActions
        source={{ kind: "file", absolutePath: path, fileName: name }}
      />
      <ContextMenuItem
        onClick={() =>
          void addProjectPdfToZotero(path, name, (itemKey, t) =>
            useLibraryPreview.getState().ask({ itemKey, label: t }),
          )
        }
      >
        <LibraryIcon className="size-3.5" />
        Add to Zotero
      </ContextMenuItem>
      {/* As for a Zotero paper: on a reading list, or a task. */}
      <AddToReadingMenu paper={{ title, url: `file://${encodeURI(path)}` }} />
      <ContextMenuItem
        onClick={() =>
          useQuickTask.getState().show({ text: `Read “${title}”` })
        }
      >
        <ListPlusIcon className="size-3.5" />
        Add a task
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** A project's PDFs, found once per project while the app is open. */
const pdfCache = new Map<
  string,
  { path: string; name: string; folder: string }[]
>();

/** Opened in place: the project's PDFs, the rest of its files left out. */
function ProjectPdfs({
  root,
  onShowAll,
}: {
  root: string;
  onShowAll: () => void;
}) {
  const [pdfs, setPdfs] = useState(() => pdfCache.get(root) ?? null);
  const [failed, setFailed] = useState(false);
  // Read again each time it's opened (a PDF just exported shows), the last
  // list shown meanwhile.
  useEffect(() => {
    let live = true;
    scanProjectFolder(root)
      .then(({ files }) => {
        const found = files
          .filter((f) => f.type === "pdf")
          .map((f) => {
            const parts = f.relativePath.split("/");
            const name = parts.pop() as string;
            return { path: f.absolutePath, name, folder: parts.join("/") };
          })
          .sort(
            (a, b) =>
              a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name),
          );
        pdfCache.set(root, found);
        if (live) setPdfs(found);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [root]);
  const showAll = (
    <button
      type="button"
      onClick={onShowAll}
      className="w-full rounded-md py-1 pr-2 pl-8 text-left text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
    >
      Show all files
    </button>
  );
  if (failed) {
    return (
      <p className="py-1 pl-8 text-muted-foreground text-xs">
        Couldn't read this project's files.
      </p>
    );
  }
  if (!pdfs) {
    return (
      <p className="flex items-center gap-1.5 py-1 pl-8 text-muted-foreground text-xs">
        <Loader2Icon className="size-3 animate-spin" />
        Looking for PDFs…
      </p>
    );
  }
  return (
    <div className="pb-1">
      {pdfs.length === 0 && (
        <p className="py-1 pl-8 text-muted-foreground text-xs">No PDFs</p>
      )}
      {pdfs.map((pdf) => (
        <ContextMenu key={pdf.path}>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={() =>
                useLibraryPreview.getState().askFile({
                  path: pdf.path,
                  label: pdf.name.replace(/\.pdf$/i, ""),
                })
              }
              title={pdf.folder ? `${pdf.folder}/${pdf.name}` : pdf.name}
              className="flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-8 text-left text-xs transition-colors hover:bg-muted"
            >
              <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {pdf.name.replace(/\.pdf$/i, "")}
              </span>
              {pdf.folder && (
                <span className="max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground">
                  {pdf.folder}
                </span>
              )}
            </button>
          </ContextMenuTrigger>
          <ProjectPdfMenu path={pdf.path} name={pdf.name} />
        </ContextMenu>
      ))}
      {showAll}
    </div>
  );
}

/**
 * A project in the list: a click shows its PDFs under it, to read; all its
 * files on request. Star or remove on right-click.
 */
function ProjectRow({
  project,
  onOpen,
}: {
  project: { path: string; name: string };
  onOpen: (path: string) => void;
}) {
  const starred = useProjectStore((s) =>
    s.favorites.some((f) => normalizePath(f) === normalizePath(project.path)),
  );
  const [open, setOpen] = useState(false);
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            title={project.path}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-muted"
          >
            <ChevronRightIcon
              className={cn(
                "size-3 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
            {open ? (
              <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => onOpen(project.path)}>
            <FolderOpenIcon className="size-3.5" />
            Show all files
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              useProjectStore.getState().toggleFavorite(project.path)
            }
          >
            <StarIcon className="size-3.5" />
            {starred ? "Unstar" : "Star"}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              useProjectStore.getState().removeRecentProject(project.path)
            }
          >
            <XIcon className="size-3.5" />
            Remove from the list
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open && (
        <ProjectPdfs
          root={project.path}
          onShowAll={() => onOpen(project.path)}
        />
      )}
    </div>
  );
}

/**
 * The two places a paper you are reading can go: the project's reference files,
 * or the chat, so Claude can use it while editing. Shared by Zotero items and
 * by PDFs sitting in another project's folder.
 */
/**
 * A project's PDF into your Zotero library, to read it as a paper there
 * (highlights, comments, passages in notes). Opens it as that paper.
 */
async function addProjectPdfToZotero(
  path: string,
  name: string,
  open?: (itemKey: string, title: string) => void,
) {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) {
    toast.error("Connect Zotero in Settings first.");
    return;
  }
  const title = name.replace(/\.pdf$/i, "");
  const id = toast.loading(`Adding “${title}” to Zotero…`);
  try {
    const [bytes, info] = await Promise.all([
      readFile(path),
      stat(path).catch(() => null),
    ]);
    const { itemKey } = await addPdfToZotero(apiKey, userID, {
      bytes,
      filename: name,
      title,
      mtime: info?.mtime?.getTime(),
    });
    await useZoteroLibrary.getState().sync(apiKey, userID);
    toast.success(`“${title}” is in your Zotero library`, { id });
    open?.(itemKey, title);
  } catch (err) {
    toast.error(
      `Couldn't add it: ${err instanceof Error ? err.message : String(err)}`,
      { id },
    );
  }
}

function ReferencePdfActions({ source }: { source: ReferencePdfSource }) {
  // Both go into the open project: none, nothing to offer.
  const projectOpen = useDocumentStore((s) => Boolean(s.projectRoot));
  // A Zotero PDF has to be downloaded first, which is slow enough to need
  // saying so — the menu has already closed by then.
  const run = (
    action: (source: ReferencePdfSource) => Promise<string>,
    loading: string,
    success: (path: string) => string,
  ) => {
    toast.promise(action(source), {
      loading,
      success,
      error: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("Reference PDF action failed", { error: message });
        return `Couldn't add this PDF. ${message}`;
      },
    });
  };

  if (!projectOpen) return null;
  return (
    <>
      <ContextMenuItem
        onClick={() =>
          run(
            importReferencePdf,
            "Adding to references…",
            (path) => `Added ${path}`,
          )
        }
      >
        <PaperclipIcon className="size-3.5" />
        Add PDF to references
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() =>
          run(
            addReferencePdfToChat,
            "Adding to chat…",
            (path) => `Attached ${path} to chat`,
          )
        }
      >
        <MessageSquarePlusIcon className="size-3.5" />
        Add PDF to chat
      </ContextMenuItem>
    </>
  );
}

/** A single expand/collapse row shared by "My Library" and each collection node. */
function ZoteroTreeRow({
  icon: Icon,
  label,
  expanded,
  onToggle,
  collectionKey,
}: {
  icon: LucideIcon;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** Right-click adds the whole collection (null: library) to a .bib file. */
  collectionKey?: string | null;
}) {
  const projectOpen = useDocumentStore((s) => Boolean(s.projectRoot));
  const row = (
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
  if (collectionKey === undefined || !projectOpen) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <CollectionToBibItems collectionKey={collectionKey} name={label} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Fetches what changed in Zotero since the library was last read. */
function ZoteroRefresh() {
  const syncing = useZoteroLibrary((s) => s.syncing);
  const error = useZoteroLibrary((s) => s.error);
  const refresh = () => {
    const { apiKey, userID } = useZoteroStore.getState();
    if (apiKey && userID)
      void useZoteroLibrary.getState().sync(apiKey, userID, true);
  };
  return (
    <button
      type="button"
      onClick={refresh}
      disabled={syncing}
      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
      title={
        error ? `Refresh (last try failed: ${error})` : "Refresh from Zotero"
      }
      aria-label="Refresh from Zotero"
    >
      <RefreshCwIcon className={cn("size-3.5", syncing && "animate-spin")} />
    </button>
  );
}

/** The project's .bib files, for "Add … to" menus. */
function useBibFiles() {
  const files = useDocumentStore((s) => s.files);
  return useMemo(
    () =>
      files
        .filter((f) => f.name.toLowerCase().endsWith(".bib"))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    [files],
  );
}

/** "Add all to <file>.bib" for a collection or the whole library. */
function CollectionToBibItems({
  collectionKey,
  name,
}: {
  collectionKey: string | null;
  name: string;
}) {
  const bibFiles = useBibFiles();
  const add = (fileId: string | null, label: string) =>
    toast.promise(
      useZoteroStore.getState().addCollectionToBib(collectionKey, name, fileId),
      {
        loading: `Adding ${name} to ${label}…`,
        success: (r) =>
          r.added
            ? `Added ${r.added} to ${r.fileName}${r.skipped ? ` (${r.skipped} already there)` : ""}`
            : `Everything in ${name} is already in ${r.fileName}`,
        error: (err) =>
          `Couldn't add ${name}. ${err instanceof Error ? err.message : String(err)}`,
      },
    );
  return bibFiles.length === 0 ? (
    <ContextMenuItem onClick={() => add(null, DEFAULT_BIB_FILE_NAME)}>
      <PlusIcon className="size-3.5" />
      Add all to new {DEFAULT_BIB_FILE_NAME}
    </ContextMenuItem>
  ) : (
    bibFiles.map((file) => (
      <ContextMenuItem key={file.id} onClick={() => add(file.id, file.name)}>
        <PlusIcon className="size-3.5" />
        <span className="truncate">Add all to {file.relativePath}</span>
      </ContextMenuItem>
    ))
  );
}

/** Cited items whose title or authors have every word typed. */
function matchingQuery<T extends { item: ZoteroItemSummary }>(
  list: T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter(({ item }) => {
    const text = `${item.title} ${item.creators} ${item.year}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

function ZoteroItemRow({
  item,
  isSelected,
  onSelect,
  places,
}: {
  item: ZoteroItemSummary;
  isSelected: boolean;
  onSelect: (item: ZoteroItemSummary) => void;
  /** Where the open project cites it. */
  places?: CitePlace[];
}) {
  const projectOpen = useDocumentStore((s) => Boolean(s.projectRoot));
  const subtitle = [item.creators, item.year].filter(Boolean).join(" · ");
  const addItemToBib = useZoteroStore((s) => s.addItemToBib);
  const [adding, setAdding] = useState(false);

  // Every .bib in the project is a candidate target; listing them flat beats a
  // submenu, since projects rarely have more than one or two.
  const bibFiles = useBibFiles();

  // Its note in the vault, if it has one; a topic needs one to list.
  const vaultIndex = useVaultStore((s) => s.index);
  const vaultNote = useMemo(
    () => vaultIndex?.list.find((n) => n.zoteroKey === item.key),
    [vaultIndex, item.key],
  );
  const vaultNoteName = vaultNote?.name;

  const addToVault = () =>
    toast.promise(addPaperToVault(item.key), {
      loading: "Adding to your vault…",
      success: (r) =>
        r.status === "exists"
          ? `${r.name} already has a note`
          : r.status === "updated"
            ? `Updated ${r.name} in your vault`
            : `Added ${r.name} to your vault`,
      error: (err) =>
        `Couldn't add it to your vault. ${err instanceof Error ? err.message : String(err)}`,
    });

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
        <div>
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
          {places && (
            <div className="pb-1 pl-7">
              <CitedAt places={places} />
            </div>
          )}
          {vaultIndex && vaultNote && (
            <div className="-mt-1 pb-1 pl-7">
              <ConnectionPills
                index={vaultIndex}
                note={vaultNote}
                onOpen={openInVault}
              />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ReferencePdfActions
          source={{ kind: "zotero", itemKey: item.key, title: item.title }}
        />
        <ContextMenuItem onClick={addToVault}>
          <NotebookTextIcon className="size-3.5" />
          Add to vault
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            useQuickTask
              .getState()
              .show(
                vaultNote
                  ? { pin: { name: vaultNote.name, title: vaultNote.title } }
                  : { text: `Read “${item.title}”` },
              )
          }
        >
          <ListPlusIcon className="size-3.5" />
          Add a task
        </ContextMenuItem>
        <AddToReadingMenu paper={{ title: item.title, itemKey: item.key }} />
        <ConnectNoteMenu
          noteName={vaultNoteName}
          resolve={async () =>
            vaultNoteName ?? (await addPaperToVault(item.key)).name
          }
        />
        {projectOpen && <ContextMenuSeparator />}
        {!projectOpen ? null : bibFiles.length === 0 ? (
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
        No references match. Try fewer words or a wider year range.
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
        collectionKey={node.key}
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
        const row = (
          <button
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

        if (child.kind !== "pdf" || !child.absolutePath) {
          return <Fragment key={child.relativePath}>{row}</Fragment>;
        }

        return (
          <ContextMenu key={child.relativePath}>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ProjectPdfMenu path={child.absolutePath} name={child.name} />
          </ContextMenu>
        );
      })}
    </>
  );
}

/** How a paper is laid out in the library, where there's no PDF pane. */
interface ReaderControls {
  beside: boolean;
  full: boolean;
  toggleSide: () => void;
  toggleFull: () => void;
}

function FilePreview({
  selectedFile,
  preview,
  reader,
}: {
  selectedFile: SelectedFile | null;
  preview: Preview | null;
  reader?: ReaderControls;
}) {
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

  // preview.kind === "pdf": the same reader as the PDF pane (highlights,
  // notes, ideas and topics), under the preview's own title.
  const paper: ReadingPaper = {
    id: selectedFile.id,
    label:
      selectedFile.source === "fs"
        ? (selectedFile.label.split(/[\\/]/).pop() ?? selectedFile.label)
        : selectedFile.label,
    data: preview.data,
    annotations: preview.annotations,
    filePath:
      selectedFile.source === "fs" ? selectedFile.absolutePath : undefined,
    zotero:
      selectedFile.source === "zotero" && preview.attachmentKey
        ? {
            itemKey: selectedFile.itemKey,
            attachmentKey: preview.attachmentKey,
          }
        : undefined,
    focus: selectedFile.focus,
  };
  return (
    <PaperReader
      key={selectedFile.id}
      paper={paper}
      visible
      inline
      status={
        preview.annotationsError ? (
          <span
            className="min-w-0 flex-1 truncate text-destructive text-xs"
            title={preview.annotationsError}
          >
            Annotations: {preview.annotationsError}
          </span>
        ) : undefined
      }
      actions={
        reader ? (
          <>
            {!reader.full && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={reader.toggleSide}
                title={reader.beside ? "Below the list" : "Beside the list"}
                aria-label={
                  reader.beside ? "Below the list" : "Beside the list"
                }
              >
                {reader.beside ? (
                  <PanelBottomIcon className="size-3.5" />
                ) : (
                  <PanelRightIcon className="size-3.5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="mr-1 size-6 shrink-0"
              onClick={reader.toggleFull}
              title={
                reader.full
                  ? `Exit full window (Esc or ${FULL_KEY})`
                  : `Read in full window (${FULL_KEY})`
              }
              aria-label={
                reader.full ? "Exit full window" : "Read in full window"
              }
            >
              {reader.full ? (
                <Minimize2Icon className="size-3.5" />
              ) : (
                <Maximize2Icon className="size-3.5" />
              )}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="mr-1 h-6 shrink-0 gap-1 px-2 text-xs"
            onClick={() => useReadingStore.getState().open(paper)}
            title="Opens it in a tab of the big PDF pane, beside your editor"
          >
            <Maximize2Icon className="size-3" />
            Read in PDF pane
          </Button>
        )
      }
    />
  );
}
