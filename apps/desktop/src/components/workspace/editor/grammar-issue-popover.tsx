import { createPortal } from "react-dom";
import { useEffect } from "react";
import { AlertTriangleIcon, XIcon } from "lucide-react";
import { useViewportAnchoredPosition } from "./use-viewport-anchored-position";
import type { GrammarIssue } from "./grammar-check-extension";

interface GrammarIssuePopoverProps {
  issue: GrammarIssue;
  /** The exact flagged text — needed since ignoring targets the word, not the issue. */
  flaggedText: string;
  /** Viewport-relative point (e.g. the right-click location) to anchor near. */
  anchor: { x: number; y: number };
  onReplace: (replacement: string) => void;
  /** Called (spelling-type issues only) to mark `flaggedText` as not-a-typo. */
  onIgnore: (word: string) => void;
  onDismiss: () => void;
}

const POPOVER_WIDTH = 320;

export function GrammarIssuePopover({
  issue,
  flaggedText,
  anchor,
  onReplace,
  onIgnore,
  onDismiss,
}: GrammarIssuePopoverProps) {
  const { ref: popoverRef, coords } = useViewportAnchoredPosition(anchor);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onDismiss();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("keydown", handleKeyDown);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss, popoverRef]);

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg border border-border bg-background shadow-xl"
      style={{
        width: POPOVER_WIDTH,
        top: coords ? coords.top : anchor.y,
        left: coords ? coords.left : anchor.x,
        visibility: coords ? "visible" : "hidden",
      }}
    >
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <AlertTriangleIcon
          className={`size-3.5 shrink-0 ${issue.isSpelling ? "text-destructive" : "text-blue-500"}`}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {issue.category || "Grammar"}
        </span>
        {issue.isSpelling && (
          <button
            onClick={() => onIgnore(flaggedText)}
            className="shrink-0 text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
          >
            Ignore
          </button>
        )}
        <button
          aria-label="Close"
          onClick={onDismiss}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 text-sm leading-relaxed">
        <p className="text-foreground">{issue.message}</p>

        {issue.replacements.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {issue.replacements.map((replacement) =>
              issue.isSpelling ? (
                <button
                  key={replacement}
                  onClick={() => onReplace(replacement)}
                  className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-destructive text-xs transition-colors hover:bg-destructive hover:text-primary-foreground"
                >
                  {replacement || "(remove)"}
                </button>
              ) : (
                <button
                  key={replacement}
                  onClick={() => onReplace(replacement)}
                  className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-blue-600 text-xs transition-colors hover:bg-blue-500 hover:text-primary-foreground dark:text-blue-400"
                >
                  {replacement || "(remove)"}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
