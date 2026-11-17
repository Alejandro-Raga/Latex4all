import { PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib/utils";

/**
 * What lies between two resizable panes: a hairline, an easy target wider
 * than it looks, and a grip that shows on pointing at it and takes the
 * accent while dragging.
 *
 * `gutter`: a few pixels of the window's frame between the panes (the editor
 * and the PDF, so two documents never read as one page). In the gradient
 * background the line goes and the frame's color shows through the gap.
 */
export function ResizeHandle({
  direction = "vertical",
  gutter = false,
  className,
}: {
  /** "vertical": a line between panes side by side; "horizontal": stacked. */
  direction?: "vertical" | "horizontal";
  gutter?: boolean;
  className?: string;
}) {
  const vertical = direction === "vertical";
  return (
    <PanelResizeHandle
      className={cn(
        "group/handle relative flex shrink-0 items-center justify-center outline-none",
        vertical ? (gutter ? "w-1.5" : "w-px") : gutter ? "h-1.5" : "h-px",
        gutter ? "bg-frame" : "bg-border",
        // A wider target than the line.
        "after:absolute after:content-['']",
        vertical
          ? "after:-inset-x-1.5 after:inset-y-0"
          : "after:inset-x-0 after:-inset-y-1.5",
        className,
      )}
    >
      {gutter && (
        <span
          className={cn(
            "resize-line pointer-events-none absolute bg-border",
            vertical
              ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
              : "inset-x-0 top-1/2 h-px -translate-y-1/2",
          )}
        />
      )}
      <span
        className={cn(
          "pointer-events-none relative z-10 rounded-full bg-muted-foreground/40 opacity-0 transition-all duration-150",
          "group-hover/handle:opacity-100 group-data-[resize-handle-state=hover]/handle:opacity-100",
          "group-data-[resize-handle-state=drag]/handle:bg-primary group-data-[resize-handle-state=drag]/handle:opacity-100",
          vertical
            ? "h-8 w-1 group-data-[resize-handle-state=drag]/handle:h-12"
            : "h-1 w-8 group-data-[resize-handle-state=drag]/handle:w-12",
        )}
      />
    </PanelResizeHandle>
  );
}
