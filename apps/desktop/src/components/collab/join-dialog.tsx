import { useEffect, useState } from "react";
import { ClipboardPasteIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";
import { homeDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  defaultProjectFolder,
  PEER_COLORS,
  useCollabStore,
} from "@/stores/collab-store";
import { useProjectStore } from "@/stores/project-store";

/** A shared project link: the relay, /p/<32 hex>, and #<key>. */
const LINK =
  /^https?:\/\/[^\s/]+(?:\/[^\s#]*)?\/p\/[0-9a-f]{32}#[A-Za-z0-9_-]{20,}$/;
const looksLikeLink = (text: string) => LINK.test(text.trim());

export function JoinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const displayName = useCollabStore((s) => s.displayName);
  const setDisplayName = useCollabStore((s) => s.setDisplayName);
  const color = useCollabStore((s) => s.color);
  const join = useCollabStore((s) => s.join);
  const progress = useCollabStore((s) => s.progress);
  const lastProjectFolder = useProjectStore((s) => s.lastProjectFolder);
  const setLastProjectFolder = useProjectStore((s) => s.setLastProjectFolder);
  const [link, setLink] = useState("");
  const [folder, setFolder] = useState<string | null>(lastProjectFolder);
  const [home, setHome] = useState<string | null>(null);
  const joining = progress !== null;
  const invalid = link.trim() !== "" && !looksLikeLink(link);

  // Where projects are usually kept, unless somewhere else was picked before.
  useEffect(() => {
    if (folder) return;
    defaultProjectFolder()
      .then(setFolder)
      .catch(() => {});
  }, [folder]);
  useEffect(() => {
    homeDir()
      .then((h) => setHome(h.replace(/[\\/]+$/, "")))
      .catch(() => {});
  }, []);

  // A link already copied is filled in on opening.
  useEffect(() => {
    if (!open || link) return;
    navigator.clipboard
      ?.readText()
      .then((text) => {
        if (looksLikeLink(text)) setLink(text.trim());
      })
      .catch(() => {});
  }, [open, link]);

  const paste = async () => {
    try {
      setLink((await navigator.clipboard.readText()).trim());
    } catch {
      toast.error("Couldn't read the clipboard; paste the link into the box.");
    }
  };

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
      await join(link.trim(), folder ?? undefined);
      setLink("");
      onOpenChange(false);
    } catch (err) {
      toast.error("Couldn't join", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const shownFolder =
    folder && home && folder.startsWith(home)
      ? `~${folder.slice(home.length)}`
      : folder;

  return (
    <Dialog open={open} onOpenChange={(next) => !joining && onOpenChange(next)}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join a shared project</DialogTitle>
          <DialogDescription>
            Paste the invite link you were sent.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (looksLikeLink(link) && !joining) handleJoin();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="join-link">Invite link</Label>
            <div className="flex gap-1.5">
              <Input
                id="join-link"
                autoFocus
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://…/p/…#…"
                aria-invalid={invalid}
                className="min-w-0 flex-1 font-mono text-xs"
                disabled={joining}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={paste}
                disabled={joining}
                title="Paste"
                aria-label="Paste the link"
              >
                <ClipboardPasteIcon className="size-4" />
              </Button>
            </div>
            {invalid && (
              <p className="text-destructive text-xs">
                That isn't a shared project link.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="join-name">Your name</Label>
            <div className="relative">
              <span
                className="absolute top-1/2 left-3 size-2.5 -translate-y-1/2 rounded-full"
                style={{ backgroundColor: color || PEER_COLORS[0] }}
                aria-hidden="true"
              />
              <Input
                id="join-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How others see you"
                className="pl-7"
                disabled={joining}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Save in</Label>
            <div className="flex items-center gap-2 rounded-md border border-input px-3 py-1.5">
              <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
              <span
                className="min-w-0 flex-1 truncate text-sm"
                title={folder ?? undefined}
                dir="rtl"
              >
                {/* rtl keeps the end of a long path in view */}
                <bdi>{shownFolder ?? "…"}</bdi>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={chooseFolder}
                disabled={joining}
              >
                Change
              </Button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={!looksLikeLink(link) || joining}
          >
            {joining && <Loader2Icon className="size-4 animate-spin" />}
            {progress ?? "Join"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
