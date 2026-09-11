import {
  RocketIcon,
  FlaskConicalIcon,
  Loader2Icon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore, type UpdateChannel } from "@/stores/settings-store";
import { useUpdater } from "@/hooks/use-updater";

const CHANNELS: Array<{
  value: UpdateChannel;
  label: string;
  blurb: string;
  icon: typeof RocketIcon;
}> = [
  {
    value: "release",
    label: "Release",
    blurb: "Official tagged releases only.",
    icon: RocketIcon,
  },
  {
    value: "test",
    label: "Test",
    blurb: "Every build pushed to the testing branch.",
    icon: FlaskConicalIcon,
  },
];

/** Channel + auto-check controls, shown under Settings → Updates. */
export function UpdateSettings({ appVersion }: { appVersion?: string }) {
  const channel = useSettingsStore((s) => s.updateChannel);
  const setChannel = useSettingsStore((s) => s.setUpdateChannel);
  const autoCheck = useSettingsStore((s) => s.autoCheckForUpdates);
  const setAutoCheck = useSettingsStore((s) => s.setAutoCheckForUpdates);

  const { status, checkForUpdate, rollBack } = useUpdater();

  return (
    <div className="space-y-5 p-5">
      <div className="space-y-2.5">
        <div>
          <span className="font-medium text-sm">Update channel</span>
          <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
            Try the test channel whenever you like — you can return to Release
            at any point and install the current release over the test build.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHANNELS.map(({ value, label, blurb, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setChannel(value)}
              className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all ${
                channel === value
                  ? "border-primary/60 bg-primary/5"
                  : "border-border/60 bg-card/30 hover:bg-muted/40"
              }`}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium text-sm">{label}</div>
                <div className="mt-0.5 text-muted-foreground text-xs leading-snug">
                  {blurb}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {channel === "release" && (
        <div className="rounded-xl border border-border/60 bg-card/30 p-3">
          <div className="font-medium text-sm">
            Coming back from a test build?
          </div>
          <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
            Test builds are numbered above the newest release, so a normal check
            finds nothing and leaves you on the test build. This installs the
            current release over it instead. Your projects are untouched;
            settings added by a newer build may be reset.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => rollBack()}
            disabled={status.state === "checking"}
            className="mt-2.5 gap-1.5"
          >
            {status.state === "checking" ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RotateCcwIcon className="size-3.5" />
            )}
            Return to the latest release
          </Button>
        </div>
      )}

      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={autoCheck}
          onChange={(e) => setAutoCheck(e.target.checked)}
          className="size-3.5 accent-primary"
        />
        <span className="text-sm">Check for updates on launch</span>
      </label>

      <div className="flex items-center gap-3 border-border/60 border-t pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => checkForUpdate()}
          disabled={!channel || status.state === "checking"}
          className="gap-1.5"
        >
          {status.state === "checking" && (
            <Loader2Icon className="size-3.5 animate-spin" />
          )}
          Check now
        </Button>
        <span className="text-muted-foreground text-xs">
          {appVersion ? `Current version ${appVersion}` : null}
          {status.state === "up-to-date" && " — up to date"}
          {status.state === "error" && " — check failed"}
        </span>
      </div>
    </div>
  );
}
