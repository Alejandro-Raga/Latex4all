import { PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib/utils";

/**
 * What lies between two resizable panes: a hairline and nothing more at
 * rest; a target wider than it looks; a grip that shows on pointing at it
 * and takes the accent while dragging.
 *
 * `gutter`: between the editor, the PDF and the side column. In the gradient
 * background the panes are cards with a gap of frame between them, so
 * there the line goes and only the gap shows.
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
        "group/handle relative z-10 flex shrink-0 items-center justify-center bg-border outline-none",
        vertical ? "w-px" : "h-px",
        gutter && "resize-gutter",
        // A wider target than the line.
        "after:absolute after:content-['']",
        vertical
          ? "after:-inset-x-1.5 after:inset-y-0"
          : "after:inset-x-0 after:-inset-y-1.5",
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute rounded-full bg-muted-foreground/45 opacity-0 transition-all duration-150",
          "group-hover/handle:opacity-100 group-data-[resize-handle-state=hover]/handle:opacity-100",
          "group-data-[resize-handle-state=drag]/handle:bg-primary group-data-[resize-handle-state=drag]/handle:opacity-100",
          vertical
            ? "h-8 w-[3px] group-data-[resize-handle-state=drag]/handle:h-12"
            : "h-[3px] w-8 group-data-[resize-handle-state=drag]/handle:w-12",
        )}
      />
    </PanelResizeHandle>
  );
}
