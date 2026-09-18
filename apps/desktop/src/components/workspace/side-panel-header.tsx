import { MessageSquareIcon, MessagesSquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAnnotationsStore } from "@/stores/annotations-store";
import { useChatStore } from "@/stores/chat-store";

/**
 * The top of the side panel: its title, or a switch between notes and chat
 * when the project is shared.
 */
export function SidePanelHeader({ onClose }: { onClose: () => void }) {
  const tab = useAnnotationsStore((s) => s.panelTab);
  const togglePanel = useAnnotationsStore((s) => s.togglePanel);
  const chatDays = useChatStore((s) => s.days);
  const unread = useChatStore((s) => s.unread);
  const showing = chatDays > 0 ? tab : "notes";

  return (
    <div className="flex h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] shrink-0 items-center gap-2 border-border border-b px-3 pt-[var(--titlebar-height)]">
      {chatDays > 0 ? (
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          {(
            [
              ["notes", "Notes", MessageSquareIcon],
              ["chat", "Chat", MessagesSquareIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => showing !== value && togglePanel(value)}
              className={cn(
                "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm transition-colors",
                showing === value
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
              {value === "chat" && unread > 0 && showing !== "chat" && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {unread}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <>
          <MessageSquareIcon className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            Notes
          </span>
        </>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onClose}
        title="Close"
        aria-label="Close"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
