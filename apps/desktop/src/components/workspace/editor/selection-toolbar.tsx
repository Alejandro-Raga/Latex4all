import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpIcon } from "lucide-react";
import { useViewportAnchoredPosition } from "./use-viewport-anchored-position";
import type { AnnotationColor } from "@/lib/annotations/types";
import { ColorSwatches } from "./annotation-card";

export interface ToolbarAction {
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string; // e.g. "Double-click also works"
}

interface SelectionToolbarProps {
  /** Viewport-relative point (e.g. below the text selection) to anchor near. */
  anchor: { x: number; y: number; aboveY?: number };
  contextLabel: string;
  actions: ToolbarAction[];
  onSendPrompt: (prompt: string) => void;
  onAction: (actionId: string) => void;
  onDismiss: () => void;
  /** Highlights the selection in the chosen color. */
  onHighlight?: (color: AnnotationColor) => void;
  /** Takes highlights off the selection. */
  onClearHighlight?: () => void;
  /** One-click AI requests about the selection ("Shorten", "Explain"…). */
  quickActions?: { id: string; label: string; title: string }[];
  onQuickAction?: (id: string) => void;
}

const TOOLBAR_WIDTH = 256;

export function SelectionToolbar({
  anchor,
  contextLabel,
  actions,
  onSendPrompt,
  onAction,
  onDismiss,
  onHighlight,
  onClearHighlight,
  quickActions,
  onQuickAction,
}: SelectionToolbarProps) {
  const [input, setInput] = useState("");
  const { ref: toolbarRef, coords } = useViewportAnchoredPosition(anchor);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput("");
    onSendPrompt(trimmed);
  }, [input, onSendPrompt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    },
    [handleSend, onDismiss],
  );

  // Dismiss on click outside or Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        onDismiss();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    // Delay attaching to avoid dismissing on the same click that created the selection
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("keydown", handleKeyDown);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss, toolbarRef]);

  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 rounded-lg border border-border bg-background shadow-xl"
      style={{
        width: TOOLBAR_WIDTH,
        top: coords ? coords.top : anchor.y,
        left: coords ? coords.left : anchor.x,
        visibility: coords ? "visible" : "hidden",
      }}
    >
      {/* Prompt input */}
      <div className="flex items-center gap-1 border-border border-b px-2 py-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter prompt..."
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          aria-label="Send prompt"
          onClick={handleSend}
          disabled={!input.trim()}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
        >
          <ArrowUpIcon className="size-3.5" />
        </button>
      </div>

      {quickActions && quickActions.length > 0 && (
        <div className="flex flex-wrap gap-1 border-border border-b px-2 py-1.5">
          {quickActions.map((a) => (
            <button
              key={a.id}
              type="button"
              title={a.title}
              onClick={() => onQuickAction?.(a.id)}
              className="rounded-md border border-border px-1.5 py-0.5 text-xs hover:bg-muted"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {onHighlight && (
        <div className="flex items-center justify-between border-border border-b px-3 py-1.5">
          <span className="text-muted-foreground text-xs">Highlight</span>
          <ColorSwatches onPick={onHighlight} onClear={onClearHighlight} />
        </div>
      )}

      {/* Action buttons */}
      {/* Many actions sit two to a row, so the toolbar stays small enough
          not to cover what's around the selection. */}
      {actions.length > 0 && (
        <div
          className={
            actions.length > 4
              ? "grid grid-cols-2 gap-x-1 p-1"
              : "flex flex-col py-1"
          }
        >
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => onAction(action.id)}
              title={
                actions.length > 4 && action.hint
                  ? `${action.label} (${action.hint})`
                  : undefined
              }
              className={
                actions.length > 4
                  ? "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground text-xs transition-colors hover:bg-muted"
                  : "flex items-center gap-2.5 px-3 py-1.5 text-left text-foreground text-sm transition-colors hover:bg-muted"
              }
            >
              <span className="size-4 text-muted-foreground">
                {action.icon}
              </span>
              <span className="truncate">{action.label}</span>
              {action.hint && actions.length <= 4 && (
                <span className="ml-auto text-muted-foreground text-xs">
                  {action.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Context label */}
      <div className="border-border border-t px-3 py-1.5">
        <span className="font-mono text-muted-foreground text-xs">
          {contextLabel}
        </span>
      </div>
    </div>,
    document.body,
  );
}
