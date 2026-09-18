import { useEffect, useState } from "react";
import { FolderOpenIcon, Loader2Icon } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { defaultProjectFolder, useCollabStore } from "@/stores/collab-store";
import { useProjectStore } from "@/stores/project-store";

export function JoinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const displayName = useCollabStore((s) => s.displayName);
  const setDisplayName = useCollabStore((s) => s.setDisplayName);
  const join = useCollabStore((s) => s.join);
  const progress = useCollabStore((s) => s.progress);
  const lastProjectFolder = useProjectStore((s) => s.lastProjectFolder);
  const setLastProjectFolder = useProjectStore((s) => s.setLastProjectFolder);
  const [link, setLink] = useState("");
  const [folder, setFolder] = useState<string | null>(lastProjectFolder);
  const joining = progress !== null;

  // Where projects are usually kept, unless somewhere else was picked before.
  useEffect(() => {
    if (folder) return;
    defaultProjectFolder()
      .then(setFolder)
      .catch(() => {});
  }, [folder]);

  const chooseFolder = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose where to save the shared project",
    });
    if (typeof selected === "string" && selected) {
      setFolder(selected);
      setLastProjectFolder(selected);
    }
  };

  const handleJoin = async () => {
    try {
      await join(link, folder ?? undefined);
      setLink("");
      onOpenChange(false);
    } catch (err) {
      toast.error("Couldn't join", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !joining && onOpenChange(next)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Join a shared project</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim() && !joining) handleJoin();
          }}
        >
          <Input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Invite link"
            className="font-mono text-sm"
          />
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
          />
          <div className="flex items-center gap-2">
            <span
              className="min-w-0 flex-1 truncate text-muted-foreground text-xs"
              title={folder ?? undefined}
            >
              {folder ? `Saves in ${folder}` : "Choose where to save it"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5 px-2 text-xs"
              onClick={chooseFolder}
              disabled={joining}
            >
              <FolderOpenIcon className="size-3.5" />
              Change
            </Button>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={!link.trim() || joining}
          >
            {joining && <Loader2Icon className="size-4 animate-spin" />}
            {progress ?? "Join"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
