import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
  XIcon,
} from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { useDocumentStore } from "@/stores/document-store";
import {
  scanProjectFolder,
  readTexFileContent,
  readImageAsDataUrl,
  type FsProjectFile,
  type ProjectFileType,
} from "@/lib/tauri/fs";
import { PdfViewer } from "./preview/pdf-viewer";
import { Button } from "@/components/ui/button";
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
  | { kind: "pdf"; data: Uint8Array }
  | { kind: "image"; dataUrl: string }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

interface SelectedFile {
  relativePath: string;
  absolutePath: string;
  type: ProjectFileType;
}

function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

export function QuickReferencePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const currentProjectRoot = useDocumentStore((s) => s.projectRoot);

  const [refProjectPath, setRefProjectPath] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const treeCache = useRef(new Map<string, TreeNode>());
  const previewCache = useRef(new Map<string, Preview>());

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
    setSelectedFile(null);
    setPreview(null);
    setTreeError(null);
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
      relativePath: node.relativePath,
      absolutePath: node.absolutePath,
      type: node.kind,
    });
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreview(null);
      return;
    }
    const cached = previewCache.current.get(selectedFile.absolutePath);
    if (cached) {
      setPreview(cached);
      return;
    }

    let cancelled = false;
    setPreview({ kind: "loading" });

    const load = async (): Promise<Preview> => {
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
        previewCache.current.set(selectedFile.absolutePath, result);
        setPreview(result);
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn("Failed to load reference file preview", {
          path: selectedFile.absolutePath,
          error: String(err),
        });
        setPreview({ kind: "error", message: "Couldn't open this file." });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  // Reset the whole panel when it's closed, so reopening starts at the picker.
  useEffect(() => {
    if (!open) {
      handleBack();
    }
  }, [open, handleBack]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const refProjectName = refProjectPath
    ? refProjectPath.split(/[/\\]/).pop() || refProjectPath
    : null;

  return (
    <div
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-[380px] max-w-[85%] flex-col border-border border-l bg-background shadow-2xl transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full",
      )}
      style={{ top: "var(--titlebar-height)" }}
      aria-hidden={!open}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-3">
        {refProjectPath ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleBack}
            title="Back to projects"
            aria-label="Back to projects"
          >
            <ArrowLeftIcon className="size-3.5" />
          </Button>
        ) : (
          <LibraryIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {refProjectName ?? "Quick Reference"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          title="Close"
          aria-label="Close Quick Reference"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {!refProjectPath && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
          {availableProjects.length === 0 ? (
            <p className="p-3 text-muted-foreground text-xs">
              No other recent projects yet. Open a folder to reference it here.
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
        </div>
      )}

      {refProjectPath && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-[0_0_45%] overflow-y-auto border-border border-b p-1.5">
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
                selectedPath={selectedFile?.relativePath ?? null}
                onSelectFile={selectFile}
              />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <FilePreview selectedFile={selectedFile} preview={preview} />
          </div>
        </div>
      )}
    </div>
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

function FilePreview({
  selectedFile,
  preview,
}: {
  selectedFile: SelectedFile | null;
  preview: Preview | null;
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
        Preview isn't available for this file type.
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
  return (
    <div className="relative h-full min-h-0">
      <PdfViewer
        data={preview.data}
        scale={1}
        rootFileId={selectedFile.absolutePath}
      />
    </div>
  );
}
