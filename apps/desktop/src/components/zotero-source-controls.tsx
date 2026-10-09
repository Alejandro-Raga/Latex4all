import { useEffect, useState } from "react";
import { BookMarkedIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { zoteroFetch } from "@/lib/zotero-api";
import { useZoteroLibrary } from "@/lib/zotero-library";
import {
  forgetZoteroApp,
  isFallback,
  noteFailed,
  noteWebDown,
  type ZoteroAppMode,
  zoteroAppStatus,
  useZoteroConnection,
} from "@/lib/zotero-source";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useZoteroStore } from "@/stores/zotero-store";

/** Where Zotero data is coming from now, as a dot and a few words. */
export function useZoteroStatus(): { dot: string; label: string } {
  const { servedBy, failed } = useZoteroConnection();
  const mode = useSettingsStore((s) => s.zoteroAppMode);
  if (failed) return { dot: "bg-red-500", label: "Can't reach Zotero" };
  if (servedBy === "database") {
    return { dot: "bg-amber-500", label: "Zotero's database (read only)" };
  }
  if (servedBy === "local") {
    return mode === "always"
      ? { dot: "bg-blue-500", label: "Zotero app" }
      : { dot: "bg-amber-500", label: "Zotero app (zotero.org is down)" };
  }
  if (servedBy === "web") return { dot: "bg-green-500", label: "zotero.org" };
  return { dot: "bg-muted-foreground/50", label: "Not used yet" };
}

const MODES: { value: ZoteroAppMode; label: string; detail: string }[] = [
  { value: "off", label: "Off", detail: "Only zotero.org is used." },
  {
    value: "fallback",
    label: "As fallback",
    detail:
      "zotero.org first; the Zotero app or its files when zotero.org can't be reached.",
  },
  {
    value: "always",
    label: "Always",
    detail:
      "The Zotero app whenever it's open, and its files on this computer; zotero.org otherwise.",
  },
];

const APP_STATUS = {
  on: "Zotero is open and lets Latex4All in.",
  off: "Zotero is open but doesn't let other apps in. In Zotero, open Settings → Advanced and turn on “Allow other applications on this computer to communicate with Zotero”.",
  closed: "Zotero isn't open. Its files on this computer can still be read.",
};

/**
 * Where Zotero data comes from: the Zotero app, and Zotero's database as a
 * last resort. Changes apply to the next request; nothing needs a restart.
 */
export function ZoteroSourceControls() {
  const mode = useSettingsStore((s) => s.zoteroAppMode);
  const setMode = useSettingsStore((s) => s.setZoteroAppMode);
  const database = useSettingsStore((s) => s.zoteroDatabaseFallback);
  const setDatabase = useSettingsStore((s) => s.setZoteroDatabaseFallback);
  const apiKey = useZoteroStore((s) => s.apiKey);
  const userID = useZoteroStore((s) => s.userID);
  const app = useZoteroConnection((s) => s.app);
  const status = useZoteroStatus();
  const [checking, setChecking] = useState(false);

  /** Asks zotero.org and the app afresh, and shows what answers. */
  const check = async () => {
    setChecking(true);
    forgetZoteroApp();
    await zoteroAppStatus(true);
    if (apiKey) {
      try {
        await zoteroFetch(apiKey, "/keys/current", undefined, "web");
      } catch {
        noteWebDown();
        if (useSettingsStore.getState().zoteroAppMode !== "off") {
          const app = await zoteroAppStatus();
          useZoteroConnection.setState({
            servedBy: app === "on" ? "local" : null,
            failed: app !== "on" && !database,
          });
        } else if (!database) {
          noteFailed();
        }
      }
    }
    setChecking(false);
  };

  useEffect(() => {
    zoteroAppStatus(true);
  }, []);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", status.dot)} />
        <span className="text-muted-foreground">Using {status.label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs"
          onClick={check}
          disabled={checking}
        >
          {checking && <Loader2Icon className="size-3 animate-spin" />}
          Check now
        </Button>
      </div>

      <div className="space-y-1.5">
        <div className="font-medium text-foreground text-sm">
          Zotero on this computer
        </div>
        <div className="flex rounded-md border p-0.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              onClick={() => {
                setMode(m.value);
                forgetZoteroApp();
                zoteroAppStatus(true);
              }}
              className={cn(
                "flex-1 rounded px-2 py-1 transition-colors",
                mode === m.value
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground">
          {MODES.find((m) => m.value === mode)?.detail}
        </p>
        {mode !== "off" && app && (
          <p
            className={cn(
              app === "off"
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            {APP_STATUS[app]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={database}
            onChange={(e) => {
              const on = e.target.checked;
              setDatabase(on);
              // BibTeX is kept with the library from now on: fetch it all.
              if (on && apiKey && userID) {
                useZoteroLibrary.getState().refetch(apiKey, userID);
              }
            }}
          />
          <span className="font-medium text-foreground text-sm">
            Zotero's database as a last resort
          </span>
        </label>
        <p className="text-muted-foreground">
          When neither the Zotero app nor zotero.org can be reached.
        </p>
        {database && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-amber-700 dark:text-amber-400">
            Latex4All then reads a copy of Zotero's database on this computer.
            You can browse, search and open papers with their highlights, but
            nothing is saved to Zotero and .bib files aren't updated until
            Zotero or zotero.org is back. BibTeX is as of the last library
            update.
          </p>
        )}
      </div>
      <p className="text-muted-foreground">Changes apply right away.</p>
    </div>
  );
}

/** The toolbar's Zotero button: where data comes from, and the controls. */
export function ZoteroButton() {
  const connected = useZoteroStore((s) => Boolean(s.apiKey));
  const status = useZoteroStatus();
  const servedBy = useZoteroConnection((s) => s.servedBy);
  const failed = useZoteroConnection((s) => s.failed);
  if (!connected) return null;
  const warn = failed || isFallback(servedBy);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={warn ? "secondary" : "ghost"}
          size="sm"
          className="h-6 shrink-0 gap-1.5 px-2 text-xs"
          title={`Zotero: ${status.label}`}
          aria-label={`Zotero: ${status.label}`}
        >
          <BookMarkedIcon className="size-3.5" />
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          Zotero
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <ZoteroSourceControls />
      </PopoverContent>
    </Popover>
  );
}
