import { useState } from "react";
import { CheckIcon, CopyIcon, Loader2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCollabStore, type CollabPeer } from "@/stores/collab-store";
import { cn } from "@/lib/utils";

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

export function CollabButton() {
  const role = useCollabStore((s) => s.role);
  const status = useCollabStore((s) => s.status);
  const invite = useCollabStore((s) => s.invite);
  const peers = useCollabStore((s) => s.peers);
  const displayName = useCollabStore((s) => s.displayName);
  const setDisplayName = useCollabStore((s) => s.setDisplayName);
  const shareOver = useCollabStore((s) => s.shareOver);
  const setShareOver = useCollabStore((s) => s.setShareOver);
  const startSharing = useCollabStore((s) => s.startSharing);
  const stop = useCollabStore((s) => s.stop);
  const [copied, setCopied] = useState(false);

  const live = status === "live";

  const handleStart = () => {
    startSharing().catch((err) =>
      toast.error("Couldn't start sharing", {
        description: err instanceof Error ? err.message : String(err),
      }),
    );
  };

  const handleCopy = () => {
    if (!invite) return;
    navigator.clipboard.writeText(invite).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={live ? "secondary" : "ghost"}
          size="sm"
          className="h-6 shrink-0 gap-1.5 px-2 text-xs"
        >
          {live && peers.length > 0 ? (
            <span className="flex -space-x-1.5">
              {peers.slice(0, 3).map((peer) => (
                <PeerAvatar key={peer.clientId} peer={peer} />
              ))}
            </span>
          ) : (
            <UsersIcon className="size-3.5" />
          )}
          {live ? (role === "host" ? "Sharing" : "Shared") : "Share"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        {!live ? (
          <>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="h-8 text-sm"
            />
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
              {(
                [
                  ["internet", "Internet"],
                  ["network", "Local network"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setShareOver(value)}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    shareOver === value
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              className="w-full"
              size="sm"
              onClick={handleStart}
              disabled={status === "connecting"}
            >
              {status === "connecting" && (
                <Loader2Icon className="size-3.5 animate-spin" />
              )}
              Start sharing
            </Button>
          </>
        ) : (
          <>
            {role === "host" && invite && (
              <div className="space-y-1">
                <p className="font-medium text-xs">Invite code</p>
                <div className="flex gap-1.5">
                  <Input
                    readOnly
                    value={invite}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-8 font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={handleCopy}
                    aria-label="Copy invite code"
                  >
                    {copied ? (
                      <CheckIcon className="size-3.5" />
                    ) : (
                      <CopyIcon className="size-3.5" />
                    )}
                  </Button>
                </div>
                {!invite.includes("://") && (
                  <p className="text-muted-foreground text-xs">
                    Works on the same network.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <p className="font-medium text-xs">
                {peers.length === 0 ? "No one else here yet" : "Editing now"}
              </p>
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
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={stop}
            >
              {role === "host" ? "Stop sharing" : "Leave"}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
