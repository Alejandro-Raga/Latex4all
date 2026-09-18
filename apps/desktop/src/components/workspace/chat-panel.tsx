import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { ArrowUpIcon, ImageIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ChatImage, ChatMessage } from "@/lib/collab/chat";
import { cn } from "@/lib/utils";
import { currentAuthor, useAnnotationsStore } from "@/stores/annotations-store";
import { useChatStore } from "@/stores/chat-store";
import { useCollabStore } from "@/stores/collab-store";
import { SidePanelHeader } from "./side-panel-header";

/** Messages this close together from one person are shown as one group. */
const GROUP_MS = 5 * 60 * 1000;

function imageSrc(image: ChatImage) {
  return `data:${image.type};base64,${image.data}`;
}

function dayLabel(at: number) {
  if (isToday(at)) return "Today";
  if (isYesterday(at)) return "Yesterday";
  return format(at, "EEE d MMM");
}

function MessageItem({
  message,
  mine,
  showAuthor,
  onOpenImage,
}: {
  message: ChatMessage;
  mine: boolean;
  showAuthor: boolean;
  onOpenImage: (image: ChatImage) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        mine ? "items-end" : "items-start",
        showAuthor && "pt-2",
      )}
    >
      {showAuthor && (
        <div className="flex items-center gap-1.5 px-1 text-xs">
          {!mine && (
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: message.color }}
            />
          )}
          {!mine && <span className="font-medium">{message.author}</span>}
          <span className="text-muted-foreground">
            {format(message.at, "HH:mm")}
          </span>
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] space-y-1.5 rounded-lg px-2.5 py-1.5 text-sm",
          mine ? "bg-primary/10" : "bg-muted",
          message.seq === null && !message.failed && "opacity-60",
        )}
      >
        {message.image && (
          <button
            type="button"
            onClick={() => message.image && onOpenImage(message.image)}
            className="block overflow-hidden rounded"
          >
            <img
              src={imageSrc(message.image)}
              alt=""
              width={message.image.width}
              height={message.image.height}
              className="max-h-60 w-auto max-w-full object-contain"
            />
          </button>
        )}
        {message.text && (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}
      </div>
      {message.failed ? (
        <span className="px-1 text-destructive text-xs">Not sent</span>
      ) : (
        message.seq === null && (
          <span className="px-1 text-muted-foreground text-xs">Sending…</span>
        )
      )}
    </div>
  );
}

/** A shared project's chat, in the side panel. */
export function ChatPanel({ onClose }: { onClose: () => void }) {
  const messages = useChatStore((s) => s.messages);
  const days = useChatStore((s) => s.days);
  const send = useChatStore((s) => s.send);
  const markRead = useChatStore((s) => s.markRead);
  const offline = useCollabStore((s) => s.status !== "synced");
  const panelOpen = useAnnotationsStore((s) => s.panelOpen);
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [openImage, setOpenImage] = useState<ChatImage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  const me = currentAuthor().name;

  // Everything here has been seen while it's showing.
  useEffect(() => {
    if (panelOpen) markRead();
  }, [panelOpen, messages, markRead]);

  // New messages scroll into view, unless reading further up.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && nearBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!attachment) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(attachment);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const attach = (file: File | null | undefined) => {
    if (file?.type.startsWith("image/")) setAttachment(file);
  };

  const submit = async () => {
    if (sending || (!text.trim() && !attachment)) return;
    setSending(true);
    nearBottomRef.current = true;
    try {
      await send(text, attachment);
      setText("");
      setAttachment(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="flex h-full min-w-0 flex-col bg-background"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const file = e.dataTransfer.files[0];
        if (file?.type.startsWith("image/")) {
          e.preventDefault();
          attach(file);
        }
      }}
    >
      <SidePanelHeader onClose={onClose} />

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-2"
      >
        <p className="py-3 text-center text-muted-foreground text-xs">
          Messages are deleted after {days} days.
        </p>
        {messages.map((message, i) => {
          const previous = messages[i - 1];
          const newDay =
            !previous ||
            new Date(previous.at).toDateString() !==
              new Date(message.at).toDateString();
          const showAuthor =
            newDay ||
            previous.author !== message.author ||
            previous.color !== message.color ||
            message.at - previous.at > GROUP_MS;
          return (
            <div key={message.id}>
              {newDay && (
                <div className="py-2 text-center text-muted-foreground text-xs">
                  {dayLabel(message.at)}
                </div>
              )}
              <div className="pt-1">
                <MessageItem
                  message={message}
                  mine={message.author === me}
                  showAuthor={showAuthor}
                  onOpenImage={setOpenImage}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-border border-t p-2">
        {preview && (
          <div className="relative inline-block">
            <img
              src={preview}
              alt=""
              className="max-h-24 rounded border border-border"
            />
            <button
              type="button"
              aria-label="Remove image"
              onClick={() => setAttachment(null)}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              attach(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            title="Add an image"
            aria-label="Add an image"
            onClick={() => fileRef.current?.click()}
          >
            <ImageIcon className="size-4" />
          </Button>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder={offline ? "Message (sends when online)" : "Message"}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const file = [...e.clipboardData.files].find((f) =>
                f.type.startsWith("image/"),
              );
              if (file) {
                e.preventDefault();
                attach(file);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className="min-w-0 flex-1 resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <Button
            size="icon"
            className="size-8 shrink-0"
            aria-label="Send"
            disabled={sending || (!text.trim() && !attachment)}
            onClick={() => void submit()}
          >
            {sending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ArrowUpIcon className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <Dialog
        open={openImage !== null}
        onOpenChange={(open) => !open && setOpenImage(null)}
      >
        <DialogContent className="max-w-[90vw] p-2 sm:max-w-[90vw]">
          <DialogTitle className="sr-only">Image</DialogTitle>
          {openImage && (
            <img
              src={imageSrc(openImage)}
              alt=""
              className="max-h-[85vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
