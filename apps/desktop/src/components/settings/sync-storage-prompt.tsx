import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getSyncSettings,
  needsStorageQuestion,
  patchSyncSettings,
  storageQuestionAnswered,
  type SyncSettings,
} from "@/lib/tauri/sync-settings";
import { useProjectStore } from "@/stores/project-store";
import { SyncStorageChoice } from "./sync-settings";

/**
 * Where changes wait, asked once after the update for people who already
 * share projects (others are asked at their first share).
 */
export function SyncStoragePrompt() {
  const [asking, setAsking] = useState<SyncSettings | null>(null);
  useEffect(() => {
    if (getCurrentWebviewWindow().label !== "main") return;
    const timer = setTimeout(() => {
      const shares = Object.keys(useProjectStore.getState().sharedProjects);
      if (shares.length === 0) return;
      getSyncSettings()
        .then((s) => {
          if (needsStorageQuestion(s)) setAsking(s);
        })
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, []);
  const done = (s: SyncSettings) => {
    setAsking(null);
    storageQuestionAnswered();
    void patchSyncSettings({
      storage: s.storage || "server",
      folder: s.folder,
      hubCode: s.hubCode,
      chosen: true,
    }).catch(() => {});
  };
  return (
    <Dialog
      open={asking !== null}
      onOpenChange={(o) => !o && asking && done(asking)}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync storage</DialogTitle>
        </DialogHeader>
        {asking && <SyncStorageChoice settings={asking} onChange={setAsking} />}
        <div className="flex justify-end">
          <Button size="sm" onClick={() => asking && done(asking)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
