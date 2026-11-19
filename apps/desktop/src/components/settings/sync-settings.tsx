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
  setSyncSettings,
  type SyncSettings,
} from "@/lib/tauri/sync-settings";
import { SettingRow, Toggle } from "./settings-parts";

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
        Latex4All uses a peer-to-peer service to sync, but to guarantee
        asynchronous functionality it needs a secure, always-on storage service.
        By default, this service is offered free of charge, with storage limits
        per project, but you can choose a cloud folder on any service you
        already use. Share that folder with your collaborators so their copies
        can sync through it too. Alternatively, you can set up Latex4All as its
        own server on your personal computer, as long as it's always on, or
        install this service on your own dedicated server. Everything is
        encrypted before it leaves your computer.
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
              Each shared project gets its own folder inside. Share it with your
              collaborators from your cloud service.
            </p>
          </div>,
        )}
        {option(
          "computer",
          "Use this computer as a server",
          "Only if it's always on. It keeps every shared project for the others, and stays in the menu bar when you close the window. Starts with the app's next launch.",
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

/** Settings → Sync. */
export function SyncSettingsSection() {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  useEffect(() => {
    getSyncSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);
  if (!settings) return null;
  const save = (next: SyncSettings) => {
    setSettings(next);
    void setSyncSettings(next);
  };
  return (
    <div>
      <SettingRow
        label="Peer-to-peer sync (beta)"
        detail="Shared projects also sync directly between computers. Takes effect when a project is opened."
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
