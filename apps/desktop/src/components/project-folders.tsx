/**
 * Folders on the projects page: tiles to open, a name to give, a menu to
 * file a project in one. Only how projects are listed; nothing on disk.
 */
import {
  ChevronRightIcon,
  FolderIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type ProjectFolder,
  useProjectFolders,
} from "@/stores/project-folders-store";

export const FOLDER_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/**
 * Opens a dialog once the menu it was chosen from has closed: closing hands
 * focus back to where the menu was opened, which would close the dialog.
 */
export const afterMenu = (open: () => void) => setTimeout(open, 0);

export const folderColor = (f?: ProjectFolder) =>
  f?.color ?? "var(--muted-foreground)";

/** Asking for a folder's name: a new one (and a project to put in it), or a rename. */
export type FolderPrompt =
  | { kind: "new"; path?: string }
  | { kind: "rename"; id: string };

export function FolderNameDialog({
  prompt,
  onClose,
}: {
  prompt: FolderPrompt | null;
  onClose: () => void;
}) {
  const folders = useProjectFolders((s) => s.folders);
  const [name, setName] = useState("");
  useEffect(() => {
    if (!prompt) return;
    setName(
      prompt.kind === "rename"
        ? (folders.find((f) => f.id === prompt.id)?.name ?? "")
        : "",
    );
  }, [prompt, folders]);
  return (
    <Dialog open={prompt !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {prompt?.kind === "rename" ? "Rename folder" : "New folder"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const store = useProjectFolders.getState();
            if (prompt?.kind === "rename") store.rename(prompt.id, name);
            else if (prompt) {
              const id = store.add(name);
              if (id && prompt.path) store.put(prompt.path, id);
            }
            onClose();
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Thesis, Teaching…"
            aria-label="Folder name"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {prompt?.kind === "rename" ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The folders, favourites first, each opening on a click. */
export function FolderTiles({
  counts,
  onOpen,
  onPrompt,
}: {
  counts: Record<string, number>;
  onOpen: (id: string) => void;
  onPrompt: (p: FolderPrompt) => void;
}) {
  const folders = useProjectFolders((s) => s.folders);
  if (folders.length === 0) return null;
  const sorted = [...folders].sort(
    (a, b) =>
      Number(!!b.favorite) - Number(!!a.favorite) ||
      a.name.localeCompare(b.name),
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Folders
        </span>
        <span className="text-muted-foreground/60 text-xs tabular-nums">
          {folders.length}
        </span>
        <span className="h-px flex-1 bg-border/60" />
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
        {sorted.map((f) => (
          <ContextMenu key={f.id}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                onClick={() => onOpen(f.id)}
                className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
              >
                <FolderIcon
                  className="size-5 shrink-0"
                  style={{ color: folderColor(f) }}
                  fill={`color-mix(in oklab, ${folderColor(f)} 25%, transparent)`}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-sm">
                  {f.name}
                </span>
                {f.favorite && (
                  <StarIcon className="size-3.5 shrink-0 fill-current text-amber-500" />
                )}
                <span className="text-muted-foreground text-xs tabular-nums">
                  {counts[f.id] ?? 0}
                </span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
              <ContextMenuItem onSelect={() => onOpen(f.id)}>
                Open
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  afterMenu(() => onPrompt({ kind: "rename", id: f.id }))
                }
              >
                Rename…
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  useProjectFolders.getState().toggleFavorite(f.id)
                }
              >
                {f.favorite ? "Remove from favourites" : "Add to favourites"}
              </ContextMenuItem>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label="Color"
                    onClick={() =>
                      useProjectFolders.getState().setColor(f.id, c)
                    }
                    className={cn(
                      "size-4 rounded-full ring-offset-1 ring-offset-popover hover:ring-2 hover:ring-ring",
                      f.color === c && "ring-2 ring-ring",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => useProjectFolders.getState().remove(f.id)}
              >
                <Trash2Icon className="size-3.5" />
                Delete folder
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
    </section>
  );
}

/** "Move to folder ▸" in a project's menu. */
export function MoveToFolderMenu({
  path,
  onNew,
}: {
  path: string;
  onNew: () => void;
}) {
  const folders = useProjectFolders((s) => s.folders);
  const current = useProjectFolders((s) => s.of[path]);
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Move to folder</ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-48 overflow-y-auto">
        {folders.map((f) => (
          <ContextMenuItem
            key={f.id}
            disabled={f.id === current}
            onSelect={() => useProjectFolders.getState().put(path, f.id)}
          >
            <FolderIcon
              className="size-3.5"
              style={{ color: folderColor(f) }}
            />
            <span className="truncate">{f.name}</span>
          </ContextMenuItem>
        ))}
        {folders.length > 0 && <ContextMenuSeparator />}
        <ContextMenuItem onSelect={() => afterMenu(onNew)}>
          New folder…
        </ContextMenuItem>
        {current && (
          <ContextMenuItem
            onSelect={() => useProjectFolders.getState().put(path, null)}
          >
            Out of the folder
          </ContextMenuItem>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Where a project is filed, on its card, when folders aren't shown. */
export function FolderTag({ path }: { path: string }) {
  const folder = useProjectFolders((s) =>
    s.folders.find((f) => f.id === s.of[path]),
  );
  if (!folder) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <FolderIcon
        className="size-3 shrink-0"
        style={{ color: folderColor(folder) }}
      />
      <span className="truncate">{folder.name}</span>
    </span>
  );
}

/** "All projects › Thesis", to go back up. */
export function FolderTrail({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const folder = useProjectFolders((s) => s.folders.find((f) => f.id === id));
  return (
    <span className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={onBack}
        className="truncate text-muted-foreground hover:text-foreground"
      >
        All projects
      </button>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{folder?.name ?? "Folder"}</span>
    </span>
  );
}
