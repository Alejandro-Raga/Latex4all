import { useCallback, useEffect } from "react";
import {
  CheckCircle2Icon,
  CircleIcon,
  DownloadIcon,
  Loader2Icon,
  MonitorIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useLanguagePacksStore,
  type LanguagePack,
} from "@/stores/language-packs-store";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";

function formatSize(bytes: number): string {
  return bytes >= 1_048_576
    ? `${Math.round(bytes / 1_048_576)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** Lists what a pack brings, so "download" is not a leap of faith. */
function contents(pack: LanguagePack, installed: boolean): string {
  const parts = ["spelling"];
  if (installed ? pack.hasThesaurus : pack.offersThesaurus)
    parts.push("synonyms");
  if (installed ? pack.hasDefinitions : pack.offersDefinitions)
    parts.push("definitions");
  // "spelling, synonyms and definitions"
  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
    : parts[0];
}

/** What a language can do right now, in the order that matters to the user. */
function describe(pack: LanguagePack): string {
  if (pack.installed) {
    const listed = contents(pack, true);
    return `${listed.charAt(0).toUpperCase()}${listed.slice(1)}, downloaded`;
  }
  if (
    pack.systemSupported &&
    !pack.offersDefinitions &&
    !pack.offersThesaurus
  ) {
    return "Spelling handled by your system";
  }
  const extras = pack.systemSupported
    ? `Your system handles spelling — adds ${contents(pack, false)
        .replace(/^spelling(, )?/, "")
        .replace(/^and /, "")}`
    : `Not checked — adds ${contents(pack, false)}`;
  return `${extras} (${formatSize(pack.approxBytes)})`;
}

/**
 * Settings -> Languages. The system spell checkers disagree about what they
 * cover — macOS ships every language here, Windows only the ones added as a
 * Windows language pack, Linux none — so a document could be checked on one
 * machine and silently unchecked on another. This is where that gets fixed.
 */
export function LanguagePacksSettings() {
  const packs = useLanguagePacksStore((s) => s.packs);
  const loading = useLanguagePacksStore((s) => s.loading);
  const installing = useLanguagePacksStore((s) => s.installing);
  const progress = useLanguagePacksStore((s) => s.progress);
  const error = useLanguagePacksStore((s) => s.error);
  const refresh = useLanguagePacksStore((s) => s.refresh);
  const install = useLanguagePacksStore((s) => s.install);
  const remove = useLanguagePacksStore((s) => s.remove);
  const checkLanguage = useSettingsStore((s) => s.checkLanguage);
  // CC BY-SA obliges the app to credit the sources it ships data from.
  const attributions = [
    ...new Set(
      packs
        .map((pack) => pack.attribution)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleInstall = useCallback(
    (pack: LanguagePack) => {
      install(pack.code)
        .then(() => toast.success(`${pack.label} is ready.`))
        .catch((err) => toast.error(`Could not install ${pack.label}: ${err}`));
    },
    [install],
  );

  const handleRemove = useCallback(
    (pack: LanguagePack) => {
      remove(pack.code)
        .then(() => toast.success(`Removed the ${pack.label} download.`))
        .catch((err) => toast.error(`Could not remove ${pack.label}: ${err}`));
    },
    [remove],
  );

  return (
    <div className="space-y-4 p-5">
      <div>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Spell checking uses your system's dictionaries where it has them.
          Download a language to check the ones it doesn't — and, outside
          English, to get synonyms when you right-click a word. Definitions stay
          English-only; no free database offers them for the rest.
        </p>
      </div>

      {loading && packs.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
          <Loader2Icon className="size-3.5 animate-spin" />
          Checking what's installed…
        </div>
      ) : (
        <div className="divide-y divide-border/60 rounded-lg border border-border/60">
          {packs.map((pack) => {
            const isInstalling = installing === pack.code;
            const isCurrent = pack.code === checkLanguage;
            const ready = pack.installed || pack.systemSupported;

            return (
              <div
                key={pack.code}
                className="flex min-h-14 items-center gap-3 px-3 py-2.5"
              >
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border",
                    ready
                      ? "border-green-500/20 bg-green-500/10 text-green-600"
                      : "border-border/70 bg-muted/30 text-muted-foreground",
                  )}
                >
                  {pack.installed ? (
                    <CheckCircle2Icon className="size-3.5" />
                  ) : pack.systemSupported ? (
                    <MonitorIcon className="size-3.5" />
                  ) : (
                    <CircleIcon className="size-3.5" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-sm">
                      {pack.label}
                    </span>
                    {isCurrent && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        In use
                      </span>
                    )}
                  </div>
                  <p className="truncate text-muted-foreground text-xs">
                    {isInstalling
                      ? (progress?.message ?? "Downloading…")
                      : describe(pack)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {isInstalling ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled
                      className="h-7 rounded-md px-2.5 text-xs"
                    >
                      <Loader2Icon className="mr-1 size-3 animate-spin" />
                      {progress?.percent != null
                        ? `${progress.percent}%`
                        : "Installing"}
                    </Button>
                  ) : pack.installed ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-md px-2.5 text-xs"
                        onClick={() => handleInstall(pack)}
                        disabled={installing !== null}
                      >
                        <RefreshCwIcon className="mr-1 size-3" />
                        Update
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-md px-2.5 text-destructive text-xs hover:text-destructive"
                        onClick={() => handleRemove(pack)}
                        disabled={installing !== null}
                        title={
                          pack.systemSupported
                            ? "Your system dictionary takes over again"
                            : `${pack.label} will stop being checked`
                        }
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-md px-2.5 text-xs"
                      onClick={() => handleInstall(pack)}
                      disabled={installing !== null}
                    >
                      <DownloadIcon className="mr-1 size-3" />
                      {pack.systemSupported ? "Download anyway" : "Download"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {attributions.length > 0 && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {attributions.join(" · ")}. Spelling and thesaurus data from the
          LibreOffice dictionaries.
        </p>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
