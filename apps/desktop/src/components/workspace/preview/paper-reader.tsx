import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenIcon, MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReadingPaper } from "@/stores/reading-store";
import { useSettingsStore } from "@/stores/settings-store";
import { PdfViewer } from "./pdf-viewer";

/** Zoom per paper for this session, so coming back to one keeps its size. */
const zoomByPaper = new Map<string, number>();

/** A paper read at full size in a tab of the PDF pane. */
export function PaperReader({
  paper,
  visible,
}: {
  paper: ReadingPaper;
  /** Its tab is in front (hidden tabs stay mounted to keep their place). */
  visible: boolean;
}) {
  const theme = useSettingsStore((s) => s.pdfThemeReference);
  const setTheme = useSettingsStore((s) => s.setPdfThemeReference);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pageWidthRef = useRef<number | null>(null);
  const [scale, setScale] = useState(() => zoomByPaper.get(paper.id) || 1);

  const changeScale = useCallback(
    (next: number) => {
      const clamped = Math.max(0.25, Math.min(4, next));
      setScale(clamped);
      zoomByPaper.set(paper.id, clamped);
    },
    [paper.id],
  );

  // Fit the page to the pane's width the first time the paper is seen; a tab
  // opened in the background waits until it's shown and has a width.
  const fitIfNew = useCallback(() => {
    const width = wrapperRef.current?.clientWidth;
    if (zoomByPaper.has(paper.id) || !width || !pageWidthRef.current) return;
    changeScale((width - 40) / pageWidthRef.current);
  }, [paper.id, changeScale]);

  useEffect(() => {
    if (visible) fitIfNew();
  }, [visible, fitIfNew]);

  const count = paper.annotations?.length ?? 0;

  return (
    <div ref={wrapperRef} className="flex h-full min-w-0 flex-col bg-muted/50">
      <div className="flex h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] shrink-0 items-center gap-1.5 border-border border-b bg-background px-3 pt-[var(--titlebar-height)]">
        <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {paper.label}
        </span>
        {count > 0 && (
          <span className="shrink-0 text-muted-foreground text-xs">
            {count} highlight{count === 1 ? "" : "s"}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => changeScale(scale - 0.1)}
          disabled={scale <= 0.25}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <MinusIcon className="size-3.5" />
        </Button>
        <span className="w-10 text-center text-muted-foreground text-xs tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => changeScale(scale + 0.1)}
          disabled={scale >= 4}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
      <PdfViewer
        data={paper.data}
        scale={scale}
        rootFileId={paper.id}
        onScaleChange={changeScale}
        onFirstPageSize={(width) => {
          pageWidthRef.current = width;
          fitIfNew();
        }}
        annotations={paper.annotations}
        theme={theme}
        onThemeChange={setTheme}
      />
    </div>
  );
}
