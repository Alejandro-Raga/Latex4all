import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useZoteroStore } from "@/stores/zotero-store";

/**
 * Connects Zotero with a personal API key.
 *
 * This is the fallback whenever OAuth isn't available — most importantly in
 * builds made without `ZOTERO_CONSUMER_KEY`/`ZOTERO_CONSUMER_SECRET`, where
 * the OAuth handshake can't start at all. An API key needs no registered
 * application, so it always works.
 */
export function ZoteroApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const connect = useZoteroStore((s) => s.connectWithApiKey);
  const isValidating = useZoteroStore((s) => s.isValidating);
  const error = useZoteroStore((s) => s.error);

  const handleConnect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    const success = await connect(key);
    if (success) {
      onOpenChange(false);
      setApiKey("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect to Zotero</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <p className="text-muted-foreground text-sm">
            Enter your Zotero API key.
          </p>
          <Input
            type="password"
            placeholder="Zotero API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
            autoFocus
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <p className="text-muted-foreground text-xs">
            Create a key at{" "}
            <a
              href="https://www.zotero.org/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              zotero.org/settings/keys
            </a>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConnect}
            disabled={!apiKey.trim() || isValidating}
          >
            {isValidating ? "Validating..." : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
