import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  cloudFolders,
  getSyncSettings,
  isHubCode,
  SERVER_DOWNLOAD,
  changed,
  patchSyncSettings,
  storageQuestionAnswered,
  type SyncSettings,
} from "@/lib/tauri/sync-settings";
import { SettingRow, Toggle } from "./settings-parts";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { inviteCode } from "@/lib/tauri/collab";
import { deviceId } from "@/lib/collab/device";
import { useLibraryStore } from "@/stores/library-store";
import { revealInFileManager } from "@/lib/reveal";
import { LibraryProgress } from "@/components/collab/library-progress";

const folderName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The text, and the choice of where changes wait. Also the first-share prompt. */
export function SyncStorageChoice({
  settings,
  onChange,
}: {
  settings: SyncSettings;
  onChange: (next: SyncSettings) => void;
}) {
  const [found, setFound] = useState<string[]>([]);
  const [code, setCode] = useState(settings.hubCode ?? "");
  useEffect(() => {
    cloudFolders()
      .then(setFound)
      .catch(() => {});
  }, []);
  const choose = (
    storage: SyncSettings["storage"],
    more: Partial<SyncSettings> = {},
  ) => onChange({ ...settings, storage, chosen: true, ...more });
  const storage = settings.storage || "server";
  const pickFolder = async () => {
    const dir = await open({ directory: true, title: "Choose a cloud folder" });
    if (typeof dir === "string") choose("folder", { folder: dir });
  };

  const option = (
    value: SyncSettings["storage"],
    title: string,
    detail: React.ReactNode,
    extra?: React.ReactNode,
  ) => (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        storage === value ? "border-primary/60 bg-primary/5" : "border-border",
      )}
    >
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="radio"
          name="sync-storage"
          className="mt-1"
          checked={storage === value}
          onChange={() => choose(value)}
        />
        <span className="min-w-0">
          <span className="block font-medium text-sm">{title}</span>
          <span className="block text-muted-foreground text-xs">{detail}</span>
        </span>
      </label>
      {storage === value && extra && <div className="mt-2 pl-6">{extra}</div>}
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm leading-relaxed">
        When collaborators aren't online at the same time, changes wait in
        storage. The Latex4All server is free, up to a size limit per project.
        You can also use a cloud folder, a computer that stays on, or your own
        server. Everything is encrypted.
      </p>
      <div className="space-y-2">
        {option(
          "server",
          "Latex4All server",
          "Free, with a storage limit per project.",
        )}
        {option(
          "folder",
          "Cloud folder",
          settings.folder
            ? folderName(settings.folder)
            : "Dropbox, OneDrive, iCloud, Google Drive or similar.",
          <div className="flex flex-wrap items-center gap-1.5">
            {found.map((f) => (
              <Button
                key={f}
                size="sm"
                variant={settings.folder === f ? "secondary" : "outline"}
                onClick={() => choose("folder", { folder: f })}
              >
                {folderName(f)}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => void pickFolder()}>
              Other folder…
            </Button>
            <p className="w-full pt-1 text-muted-foreground text-xs">
              Each shared project gets a folder here. Share it with
              collaborators in your cloud service.
            </p>
          </div>,
        )}
        {option(
          "computer",
          "Use this computer as a server",
          "For a computer that's always on. It stays in the menu bar when you close the window.",
        )}
        {option(
          "hub",
          "Your own server",
          <>
            Run the Latex4All server on a computer that's always on.{" "}
            <a
              href={SERVER_DOWNLOAD}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Download the Latex4All server
            </a>
          </>,
          <div className="flex items-center gap-1.5">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Hub code"
              aria-label="Hub code"
              className="h-8 font-mono text-xs"
            />
            <Button
              size="sm"
              disabled={!isHubCode(code) || code.trim() === settings.hubCode}
              onClick={() =>
                choose("hub", { hubCode: code.trim(), hubbed: [] })
              }
            >
              Use
            </Button>
          </div>,
        )}
      </div>
    </div>
  );
}

/** Settings → Sharing. */
export function SyncSettingsSection() {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  // Read again on coming back: something else may have changed them.
  useEffect(() => {
    const load = () =>
      getSyncSettings()
        .then(setSettings)
        .catch(() => {});
    void load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);
  if (!settings) return null;
  const save = (next: SyncSettings) => {
    const before = settings;
    setSettings(next);
    if (next.storage) storageQuestionAnswered();
    patchSyncSettings(changed(before, next))
      .then(setSettings)
      .catch((err) => {
        setSettings(before);
        toast.error("Couldn't save the sync settings", {
          description: err instanceof Error ? err.message : String(err),
        });
      });
  };
  return (
    <div>
      <SettingRow
        label="Peer-to-peer sync (beta)"
        detail="Sync shared projects directly between computers."
      >
        <Toggle
          label="Peer-to-peer sync"
          checked={settings.enabled}
          onChange={(enabled) => save({ ...settings, enabled })}
        />
      </SettingRow>
      <div className="px-5 pt-1 pb-5">
        <SyncStorageChoice settings={settings} onChange={save} />
      </div>
    </div>
  );
}

/** Settings → Sharing → Linked devices: your computers with the same projects. */
export function LinkedDevices() {
  const lib = useLibraryStore();
  const [code, setCode] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const main = getCurrentWebviewWindow().label === "main";
  const me = deviceId();

  const run = (fn: () => Promise<unknown>) => {
    setWorking(true);
    fn()
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setWorking(false));
  };
  const showCode = () =>
    run(async () => {
      if (!lib.link) await lib.create();
      const link = useLibraryStore.getState().link;
      if (link) setCode(await inviteCode(link));
    });

  return (
    <div className="space-y-3 border-t px-5 py-5">
      <div>
        <h3 className="font-medium text-sm">Link another device</h3>
        <p className="mt-1 text-muted-foreground text-xs">
          Keep the same projects, Planner lists, highlights and settings on all
          your computers.
        </p>
      </div>
      {!main ? (
        <p className="text-muted-foreground text-xs">
          Manage linked devices from the first Latex4All window.
        </p>
      ) : (
        <>
          {lib.link && (
            <div className="space-y-1 text-xs">
              {lib.devices.map((d) => (
                <div key={d.id} className="flex justify-between">
                  <span>
                    {d.name}
                    {d.id === me && " (this one)"}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(d.at).toLocaleDateString()}
                  </span>
                </div>
              ))}
              <LibraryProgress />
              <p className="text-muted-foreground">
                {lib.busy ??
                  (lib.status === "synced"
                    ? `${lib.here} of ${lib.projects} projects on this device`
                    : lib.status === "offline"
                      ? "Offline: syncs when you're back online"
                      : "Syncing…")}
              </p>
              {lib.error && <p className="text-destructive">{lib.error}</p>}
            </div>
          )}
          {code ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
              <span className="select-all font-mono text-sm tracking-wider">
                {code}
              </span>
              <span className="text-muted-foreground text-xs">
                Enter it on the other device within 24 hours.
              </span>
            </div>
          ) : (
            <Button size="sm" onClick={showCode} disabled={working}>
              Show a code for another device
            </Button>
          )}
          {!lib.link && (
            <div className="flex gap-1.5">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Code from another device"
                className="h-8 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={working || !text.trim()}
                onClick={() => run(() => lib.linkTo(text))}
              >
                Link
              </Button>
            </div>
          )}
          {lib.link && lib.leftovers.length > 0 && (
            <div className="space-y-1 rounded-md border px-2.5 py-2 text-xs">
              <p>Old copies, no longer used. You can delete them.</p>
              {lib.leftovers.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="block max-w-full truncate text-left text-primary hover:underline"
                  onClick={() => revealInFileManager(path)}
                  title="Show in folder"
                >
                  {path}
                </button>
              ))}
            </div>
          )}
          {lib.link && lib.list.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Projects on your devices
              </summary>
              <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto">
                {lib.list.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={!p.removed}
                      onChange={(e) => lib.setOnDevices(p.id, e.target.checked)}
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-muted-foreground">
                Unchecked projects stay off your other devices.
              </p>
            </details>
          )}
          {lib.link && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={working || lib.busy !== null}
                onClick={() => run(lib.syncNow)}
              >
                Sync now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={working}
                onClick={() => run(lib.unlink)}
              >
                Unlink this device
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={working}
                title="For a lost device. Link your other devices again with the new code."
                onClick={() => {
                  setCode(null);
                  run(lib.startOver);
                }}
              >
                Start a new library
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
