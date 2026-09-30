import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { diagnostics, useConnection } from "@/lib/collab/connection";
import { megabytes } from "@/lib/collab/sync-warnings";
import { cn } from "@/lib/utils";
import {
  type CollabPeer,
  PEER_COLORS,
  useCollabStore,
} from "@/stores/collab-store";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function PeerAvatar({ peer }: { peer: Pick<CollabPeer, "name" | "color"> }) {
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-full font-semibold text-[9px] text-white ring-2 ring-background"
      style={{ backgroundColor: peer.color }}
      title={peer.name}
    >
      {initials(peer.name)}
    </span>
  );
}

/** Your name and color, as others see them. */
function YouRow() {
  const displayName = useCollabStore((s) => s.displayName);
  const setDisplayName = useCollabStore((s) => s.setDisplayName);
  const color = useCollabStore((s) => s.color);
  const setColor = useCollabStore((s) => s.setColor);
  return (
    <div className="space-y-2">
      <Input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Your name"
        className="h-8 text-sm"
      />
      <div className="flex items-center justify-between gap-1">
        {PEER_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Use ${option}`}
            onClick={() => setColor(option)}
            className={cn(
              "size-5 rounded-full transition-transform hover:scale-110",
              option === color &&
                "ring-2 ring-foreground/40 ring-offset-2 ring-offset-background",
            )}
            style={{ backgroundColor: option }}
          />
        ))}
      </div>
    </div>
  );
}

const ago = (ms: number | null, now: number) => {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/**
 * The connection to the sync service, in detail: for working out what's
 * wrong when changes don't arrive, and a report to send.
 */
function ConnectionDetails() {
  const c = useConnection();
  const [now, setNow] = useState(Date.now());
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const state =
    c.state === "online"
      ? `Connected since ${ago(c.since, now)}`
      : c.state === "offline"
        ? c.outage === "service"
          ? "The sync service isn't answering"
          : c.outage === "internet"
            ? "No internet connection"
            : "Not connected; trying again"
        : "Connecting…";
  const rows: [string, string][] = [
    ["Last heard from the service", ago(c.lastHeard, now)],
    ...(c.pending > 0
      ? [["Changes not yet sent", String(c.pending)] as [string, string]]
      : []),
    ...(c.reconnects > 0
      ? [
          [
            "Reconnected",
            `${c.reconnects} time${c.reconnects === 1 ? "" : "s"}`,
          ] as [string, string],
        ]
      : []),
    ...(c.lastOffline
      ? [
          [
            "Last dropped",
            `${ago(c.lastOffline, now)}${c.lastReason ? `: ${c.lastReason}` : ""}`,
          ] as [string, string],
        ]
      : []),
    ...(c.health
      ? [
          [
            "Last check",
            `service ${c.health.relay.ok ? `ok, ${c.health.relay.ms} ms` : "down"} · internet ${c.health.internet.ok ? "ok" : "down"}`,
          ] as [string, string],
        ]
      : []),
  ];
  return (
    <details className="group rounded-md border border-border text-xs">
      <summary className="cursor-pointer select-none list-none px-2 py-1.5 text-muted-foreground hover:text-foreground">
        Connection · {state}
      </summary>
      <div className="space-y-1 border-border border-t px-2 py-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span className="ml-auto truncate text-right" title={value}>
              {value}
            </span>
          </div>
        ))}
        <div className="flex gap-1.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 text-xs"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              await c.check();
              setChecking(false);
            }}
          >
            {checking && <Loader2Icon className="size-3 animate-spin" />}
            Check now
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 text-xs"
            onClick={async () => {
              const version = await getVersion().catch(() => "?");
              await navigator.clipboard.writeText(diagnostics(version));
              toast.success("Diagnostics copied", {
                description: "Paste them into your message or bug report.",
              });
            }}
          >
            <CopyIcon className="size-3" />
            Copy diagnostics
          </Button>
        </div>
      </div>
    </details>
  );
}

const STATUS = {
  syncing: { label: "Updating…", dot: "animate-pulse bg-amber-500" },
  synced: { label: "Up to date", dot: "bg-green-500" },
  offline: {
    label: "Offline — changes sync when you reconnect",
    dot: "bg-muted-foreground",
  },
  gone: { label: "No longer shared", dot: "bg-red-500" },
  outdated: {
    label: "Update Latex4All to keep syncing — your changes are kept",
    dot: "bg-red-500",
  },
} as const;

export function CollabButton() {
  const status = useCollabStore((s) => s.status);
  const link = useCollabStore((s) => s.link);
  const peers = useCollabStore((s) => s.peers);
  const progress = useCollabStore((s) => s.progress);
  const share = useCollabStore((s) => s.share);
  const stopSyncing = useCollabStore((s) => s.stopSyncing);
  const warnings = useCollabStore((s) => s.warnings);
  const usage = useCollabStore((s) => s.usage);
  const [copied, setCopied] = useState(false);

  const shared = status !== "none";
  const failing = warnings.some((w) => w.level === "error");
  const warningColor = failing ? "text-red-500" : "text-amber-500";

  const handleShare = () => {
    share().catch((err) =>
      toast.error("Couldn't share this project", {
        description: err instanceof Error ? err.message : String(err),
      }),
    );
  };

  const handleCopy = () => {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={shared ? "secondary" : "ghost"}
          size="sm"
          className="h-6 shrink-0 gap-1.5 px-2 text-xs"
        >
          {shared && peers.length > 0 ? (
            <span className="flex -space-x-1.5">
              {peers.slice(0, 3).map((peer) => (
                <PeerAvatar key={peer.clientId} peer={peer} />
              ))}
            </span>
          ) : (
            <UsersIcon className="size-3.5" />
          )}
          {shared &&
            (warnings.length > 0 ? (
              <AlertTriangleIcon className={cn("size-3.5", warningColor)} />
            ) : (
              <span
                className={cn("size-1.5 rounded-full", STATUS[status].dot)}
              />
            ))}
          {shared ? "Shared" : "Share"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        {!shared ? (
          <>
            <YouRow />
            <Button
              className="w-full"
              size="sm"
              onClick={handleShare}
              disabled={progress !== null}
            >
              {progress && <Loader2Icon className="size-3.5 animate-spin" />}
              {progress ?? "Share project"}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  STATUS[status].dot,
                )}
              />
              <span className="text-muted-foreground">
                {STATUS[status].label}
              </span>
              {usage && (
                <span
                  className={cn(
                    "ml-auto shrink-0",
                    usage.projectBytes >= usage.maxProjectBytes * 0.8
                      ? warningColor
                      : "text-muted-foreground",
                  )}
                >
                  {megabytes(usage.projectBytes)} of{" "}
                  {megabytes(usage.maxProjectBytes)} MB
                </span>
              )}
            </div>
            {warnings.length > 0 && (
              <div className="space-y-1.5">
                {warnings.map((warning) => (
                  <div key={warning.id} className="flex gap-1.5 text-xs">
                    <AlertTriangleIcon
                      className={cn(
                        "mt-px size-3.5 shrink-0",
                        warning.level === "error"
                          ? "text-red-500"
                          : "text-amber-500",
                      )}
                    />
                    <span>{warning.text}</span>
                  </div>
                ))}
              </div>
            )}
            {link && (
              <div className="flex gap-1.5">
                <Input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 font-mono text-xs"
                  aria-label="Invite link"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={handleCopy}
                  aria-label="Copy invite link"
                >
                  {copied ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    <CopyIcon className="size-3.5" />
                  )}
                </Button>
              </div>
            )}
            {peers.length > 0 && (
              <div className="space-y-1.5">
                {peers.map((peer) => (
                  <div
                    key={peer.clientId}
                    className="flex min-w-0 items-center gap-2 text-sm"
                  >
                    <PeerAvatar peer={peer} />
                    <span className="truncate">{peer.name}</span>
                    {peer.file && (
                      <span className="ml-auto truncate text-muted-foreground text-xs">
                        {peer.file.split("/").pop()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <YouRow />
            <ConnectionDetails />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void stopSyncing()}
            >
              Stop syncing on this device
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
