import { useCallback, useRef, useState } from "react";
import { ArrowLeftIcon, BookOpenIcon, MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReadingStore } from "@/stores/reading-store";
import { useSettingsStore } from "@/stores/settings-store";
import { PdfViewer } from "./pdf-viewer";

/** Zoom per paper for this session, so going back to one keeps its size. */
const zoomByPaper = new Map<string, number>();

/** A paper from the Reference panel, read in the PDF pane at full size. */
export function PaperReader() {
  const paper = useReadingStore((s) => s.paper);
  const close = useReadingStore((s) => s.close);
  const theme = useSettingsStore((s) => s.pdfThemeReference);
  const setTheme = useSettingsStore((s) => s.setPdfThemeReference);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(
    () => (paper && zoomByPaper.get(paper.id)) || 1,
  );

  const changeScale = useCallback(
    (next: number) => {
      const clamped = Math.max(0.25, Math.min(4, next));
      setScale(clamped);
      if (paper) zoomByPaper.set(paper.id, clamped);
    },
    [paper],
  );

  // First time a paper is opened, fit its page to the pane's width.
  const fitWidth = useCallback(
    (pageWidth: number) => {
      if (!paper || zoomByPaper.has(paper.id)) return;
      const width = wrapperRef.current?.clientWidth;
      if (width) changeScale((width - 40) / pageWidth);
    },
    [paper, changeScale],
  );

  if (!paper) return null;
  const count = paper.annotations?.length ?? 0;

  return (
    <div ref={wrapperRef} className="flex h-full min-w-0 flex-col bg-muted/50">
      <div className="flex h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] shrink-0 items-center gap-1.5 border-border border-b bg-background px-2 pt-[var(--titlebar-height)]">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={close}
          title="Back to your document"
        >
          <ArrowLeftIcon className="size-3.5" />
          My document
        </Button>
        <BookOpenIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
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
        key={paper.id}
        data={paper.data}
        scale={scale}
        rootFileId={paper.id}
        onScaleChange={changeScale}
        onFirstPageSize={fitWidth}
        annotations={paper.annotations}
        theme={theme}
        onThemeChange={setTheme}
      />
    </div>
  );
}
