import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ImagePlusIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { prepareImage } from "@/lib/collab/chat";
import { type SystemInfo, useLogStore } from "@/lib/debug/log-store";
import { providerLabel, useClaudeChatStore } from "@/stores/claude-chat-store";
import { useDocumentStore } from "@/stores/document-store";
import { useSettingsStore } from "@/stores/settings-store";

/** Opens the "Report a bug" window from anywhere. */
export const useBugReport = create<{ open: boolean; show: () => void }>(
  (set) => ({ open: false, show: () => set({ open: true }) }),
);

const MAX_IMAGES = 6;

interface Shot {
  id: string;
  type: string;
  data: string;
  url: string;
}

/** The app's details and its recent warnings and errors, as sent. */
async function appDetails(): Promise<{
  app: Record<string, string>;
  log: string;
}> {
  const info = await invoke<SystemInfo>("get_system_info").catch(() => null);
  const chat = useClaudeChatStore.getState();
  const tab = chat.tabs.find((t) => t.id === chat.activeTabId);
  const app: Record<string, string> = {
    version: info?.app_version ?? "",
    os: info
      ? `${info.os} ${info.os_version} (${info.arch})`
      : navigator.userAgent,
    channel: useSettingsStore.getState().updateChannel ?? "",
    project: useDocumentStore.getState().projectRoot ? "open" : "none",
    ai: providerLabel(tab?.providerKey ?? null),
    screen: `${window.innerWidth}×${window.innerHeight}`,
  };
  // Only what's known.
  for (const [k, v] of Object.entries(app)) if (!v) delete app[k];
  const log = useLogStore
    .getState()
    .getEntries()
    .filter((e) => e.level === "warn" || e.level === "error")
    .slice(-60)
    .map(
      (e) =>
        `${new Date(e.timestamp).toISOString()} ${e.level} [${e.source}] ${e.message}${
          e.data ? ` ${JSON.stringify(e.data).slice(0, 400)}` : ""
        }`,
    )
    .join("\n");
  return { app, log };
}

/**
 * "Report a bug": what happened, screenshots (pasted, dropped or picked),
 * an address for a reply if wanted, and the app's details, which can be
 * looked at before sending, or left out.
 */
export function BugReportDialog() {
  const open = useBugReport((s) => s.open);
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [withDetails, setWithDetails] = useState(true);
  const [details, setDetails] = useState<{
    app: Record<string, string>;
    log: string;
  } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) void appDetails().then(setDetails);
  }, [open]);

  const close = () => {
    useBugReport.setState({ open: false });
    setShowDetails(false);
  };

  const addImages = async (files: Blob[]) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const image = await prepareImage(file);
        setShots((prev) =>
          prev.length >= MAX_IMAGES
            ? prev
            : [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  type: image.type,
                  data: image.data,
                  url: `data:${image.type};base64,${image.data}`,
                },
              ],
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const report = {
        text: text.trim(),
        contact: contact.trim(),
        ...(withDetails && details ? details : {}),
        images: shots.map(({ type, data }) => ({ type, data })),
      };
      await invoke<string>("send_bug_report", { report });
      toast.success("Report sent. Thank you!");
      setText("");
      setContact("");
      setShots([]);
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="sm:max-w-lg"
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void addImages(files);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addImages([...e.dataTransfer.files]);
        }}
      >
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            What happened, and what you expected. Screenshots help: paste or
            drop them here.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="When I… the app…"
          aria-label="What happened"
          rows={6}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
        />

        <div className="flex flex-wrap items-center gap-2">
          {shots.map((shot) => (
            <div key={shot.id} className="group relative">
              <img
                src={shot.url}
                alt="Screenshot"
                className="h-16 w-24 rounded border border-border object-cover"
              />
              <button
                type="button"
                onClick={() =>
                  setShots((prev) => prev.filter((s) => s.id !== shot.id))
                }
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 group-hover:opacity-100"
                aria-label="Remove image"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
          {shots.length < MAX_IMAGES && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-16 w-24 flex-col gap-1 text-xs"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlusIcon className="size-4" />
              Add image
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addImages([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>

        <Input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Email, if you'd like a reply (optional)"
          aria-label="Email for a reply"
        />

        <div className="text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={withDetails}
              onChange={(e) => setWithDetails(e.target.checked)}
              className="accent-primary"
            />
            Include app details and recent errors
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="text-primary underline underline-offset-2"
            >
              {showDetails ? "Hide" : "See what's sent"}
            </button>
          </label>
          {showDetails && details && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/40 p-2 text-[11px]">
              {Object.entries(details.app)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n")}
              {details.log ? `\n\n${details.log}` : "\n\nNo recent errors."}
            </pre>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => void send()}
            disabled={!text.trim() || sending}
          >
            {sending && <Loader2Icon className="size-3.5 animate-spin" />}
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
