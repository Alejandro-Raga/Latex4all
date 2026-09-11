import { useState } from "react";
import {
  TriangleAlertIcon,
  DownloadIcon,
  FlaskConicalIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSettingsStore, type UpdateChannel } from "@/stores/settings-store";
import { useUpdater } from "@/hooks/use-updater";

/**
 * First-run channel picker + update prompt.
 *
 * Mounted once, near the root, so it can prompt regardless of whether a
 * project is open. Both channels ask before downloading — the channel decides
 * *which* builds are offered, not whether consent is required.
 */
export function UpdateManager() {
  const channel = useSettingsStore((s) => s.updateChannel);
  const setChannel = useSettingsStore((s) => s.setUpdateChannel);

  const { status, installUpdate, restart, setStatus } = useUpdater();
  const [dismissed, setDismissed] = useState(false);

  // ── First run: no channel chosen yet ──
  if (!channel) {
    return <ChannelPicker onPick={setChannel} />;
  }

  const showPrompt =
    !dismissed &&
    (status.state === "available" ||
      status.state === "downloading" ||
      status.state === "installing" ||
      status.state === "ready" ||
      status.state === "error");

  if (!showPrompt) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Only dismissable before the download starts; closing mid-install
        // would hide progress while the installer keeps running.
        if (!open && status.state === "available") {
          setDismissed(true);
          setStatus({ state: "idle" });
        }
      }}
    >
      <DialogContent
        showCloseButton={
          status.state === "available" || status.state === "error"
        }
        className="sm:max-w-md"
      >
        {status.state === "available" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <DownloadIcon className="size-4" />
                {status.isDowngrade
                  ? `Roll back to ${status.version}`
                  : `Update available — ${status.version}`}
              </DialogTitle>
              <DialogDescription>
                {status.isDowngrade
                  ? "This is older than the build you are running. Your projects are untouched; settings added by a newer build may be reset."
                  : channel === "test"
                    ? "A new test build is ready to install."
                    : "A new release is ready to install."}
              </DialogDescription>
            </DialogHeader>
            {status.notes && (
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 p-3 text-muted-foreground text-xs">
                {status.notes}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDismissed(true)}>
                Not now
              </Button>
              <Button onClick={installUpdate} className="gap-1.5">
                <DownloadIcon className="size-3.5" />
                {status.isDowngrade ? "Roll back" : "Download & install"}
              </Button>
            </DialogFooter>
          </>
        )}

        {status.state === "error" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlertIcon className="size-4" />
                Update failed
              </DialogTitle>
              <DialogDescription>{status.message}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setStatus({ state: "idle" })}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {status.state === "downloading" && (
          <>
            <DialogHeader>
              <DialogTitle>Downloading update…</DialogTitle>
              <DialogDescription>{status.percent}% complete</DialogDescription>
            </DialogHeader>
            <Progress value={status.percent} />
          </>
        )}

        {status.state === "installing" && (
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2Icon className="size-4 animate-spin" />
              Installing…
            </DialogTitle>
            <DialogDescription>This only takes a moment.</DialogDescription>
          </DialogHeader>
        )}

        {status.state === "ready" && (
          <>
            <DialogHeader>
              <DialogTitle>Update installed</DialogTitle>
              <DialogDescription>
                Restart to start using the new version.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDismissed(true)}>
                Later
              </Button>
              <Button onClick={restart} className="gap-1.5">
                <RefreshCwIcon className="size-3.5" />
                Restart now
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── First-run channel picker ───

function ChannelPicker({ onPick }: { onPick: (c: UpdateChannel) => void }) {
  return (
    <Dialog open>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose an update channel</DialogTitle>
          <DialogDescription>
            Latex4All can update itself so you never have to reinstall by hand.
            You can change this later in Settings → Updates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <ChannelOption
            icon={DownloadIcon}
            title="Release"
            blurb="Official tagged releases only. Fewer updates, each one deliberately published."
            onClick={() => onPick("release")}
          />
          <ChannelOption
            icon={FlaskConicalIcon}
            title="Test"
            blurb="Every build pushed to the testing branch. Newest changes first, and rougher edges."
            onClick={() => onPick("test")}
          />
        </div>

        <p className="text-muted-foreground text-xs">
          Either way, Latex4All asks before downloading anything.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function ChannelOption({
  icon: Icon,
  title,
  blurb,
  onClick,
}: {
  icon: typeof DownloadIcon;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card/30 p-3.5 text-left transition-all hover:border-border hover:bg-muted/40"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs leading-snug">
          {blurb}
        </div>
      </div>
    </button>
  );
}
