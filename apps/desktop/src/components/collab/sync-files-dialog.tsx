import { useMemo } from "react";
import { FileIcon, FolderIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isCompiledOutput } from "@/lib/collab/store-workspace";
import { foldersOf, isUnder, toggled } from "@/lib/collab/sync-choices";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/stores/document-store";
import { useSettingsStore } from "@/stores/settings-store";

const NONE: string[] = [];

interface Row {
  path: string;
  name: string;
  depth: number;
  folder: boolean;
}

/** The project's folders and files, as a tree, in order. */
function rows(paths: string[]): Row[] {
  const all = new Map<string, boolean>();
  for (const path of paths) {
    for (const folder of foldersOf(path)) all.set(folder, true);
    all.set(path, false);
  }
  return [...all]
    .sort(([a, aFolder], [b, bFolder]) => {
      // Within a folder: folders first, then files, each by name.
      const pa = a.split("/");
      const pb = b.split("/");
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        if (pa[i] === pb[i]) continue;
        const aDir = i < pa.length - 1 || aFolder;
        const bDir = i < pb.length - 1 || bFolder;
        if (aDir !== bDir) return aDir ? -1 : 1;
        return pa[i].localeCompare(pb[i]);
      }
      return pa.length - pb.length;
    })
    .map(([path, folder]) => ({
      path,
      name: path.split("/").pop() ?? path,
      depth: path.split("/").length - 1,
      folder,
    }));
}

/**
 * A project's folders and files with a tick for each: unticked ones are
 * left out of the sync (`notSynced`, as in sync-choices.ts).
 */
export function FileChoices({
  paths,
  notSynced,
  onChange,
}: {
  paths: string[];
  notSynced: string[];
  onChange: (notSynced: string[]) => void;
}) {
  const list = useMemo(() => rows(paths), [paths]);
  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-md border py-1">
      {list.map((row) => {
        const synced = !isUnder(row.path, notSynced);
        // Inside a folder left out: follows the folder.
        const byFolder = foldersOf(row.path).some((f) => notSynced.includes(f));
        const Icon = row.folder ? FolderIcon : FileIcon;
        return (
          <label
            key={row.path}
            className={cn(
              "flex cursor-pointer items-center gap-2 py-0.5 pr-2 text-sm hover:bg-muted",
              byFolder && "cursor-default opacity-50",
            )}
            style={{ paddingLeft: 8 + row.depth * 16 }}
          >
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={synced}
              disabled={byFolder}
              onChange={(e) =>
                onChange(toggled(notSynced, row.path, e.currentTarget.checked))
              }
            />
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{row.name}</span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Which of the open project's files sync through Latex4All on this
 * computer: before it's shared too, so the first upload leaves them out.
 */
export function SyncFilesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const files = useDocumentStore((s) => s.files);
  const notSynced = useSettingsStore(
    (s) => (projectRoot && s.notSynced[projectRoot]) || NONE,
  );
  const setNotSynced = useSettingsStore((s) => s.setNotSynced);

  const paths = useMemo(() => {
    const texStems = new Set(
      files
        .filter((f) => f.type === "tex")
        .map((f) => f.relativePath.replace(/\.tex$/i, "")),
    );
    return files
      .filter((f) => !isCompiledOutput(f, texStems))
      .map((f) => f.relativePath);
  }, [files]);

  if (!projectRoot) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Files to sync</DialogTitle>
          <DialogDescription>
            Unticked files aren't sent or received on this computer, so you can
            keep them in step with Dropbox or similar. Collaborators keep their
            copies.
          </DialogDescription>
        </DialogHeader>
        <FileChoices
          paths={paths}
          notSynced={notSynced}
          onChange={(next) => setNotSynced(projectRoot, next)}
        />
      </DialogContent>
    </Dialog>
  );
}
