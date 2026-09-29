import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenIcon,
  CopyIcon,
  MessageSquarePlusIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { NoteInput } from "@/components/workspace/editor/annotation-card";
import {
  SelectionToolbar,
  type ToolbarAction,
} from "@/components/workspace/editor/selection-toolbar";
import { Button } from "@/components/ui/button";
import type { AnnotationColor } from "@/lib/annotations/types";
import {
  createZoteroHighlight,
  ZOTERO_HIGHLIGHT_COLORS,
} from "@/lib/zotero-api";
import { useClaudeChatStore } from "@/stores/claude-chat-store";
import { type ReadingPaper, useReadingStore } from "@/stores/reading-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { type PdfTextSelection, PdfViewer } from "./pdf-viewer";

/** The app's highlight swatches, in Zotero's own colors. */
const ZOTERO_COLOR: Record<AnnotationColor, string> = {
  yellow: ZOTERO_HIGHLIGHT_COLORS.yellow,
  green: ZOTERO_HIGHLIGHT_COLORS.green,
  blue: ZOTERO_HIGHLIGHT_COLORS.blue,
  pink: ZOTERO_HIGHLIGHT_COLORS.red,
  purple: ZOTERO_HIGHLIGHT_COLORS.purple,
  none: ZOTERO_HIGHLIGHT_COLORS.yellow,
};

/**
 * Saves a highlight (and optional comment) on a Zotero paper to the Zotero
 * library, and shows it on the page straight away.
 */
async function saveHighlight(
  paper: ReadingPaper,
  selection: PdfTextSelection,
  color: AnnotationColor,
  comment?: string,
) {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!paper.zotero || !apiKey || !userID) return;
  if (selection.rects.length === 0) {
    toast.error("Couldn't tell where that text is on the page.");
    return;
  }
  const hex = ZOTERO_COLOR[color];
  try {
    await createZoteroHighlight(
      apiKey,
      userID,
      paper.zotero.attachmentKey,
      {
        pageIndex: selection.pageNumber - 1,
        rects: selection.rects,
        text: selection.text,
        comment,
        color: hex,
      },
      selection.pageHeight,
    );
    useReadingStore.getState().addAnnotation(paper.id, {
      pageIndex: selection.pageNumber - 1,
      rects: selection.rects,
      color: hex,
      type: "highlight",
    });
    toast.success(
      comment ? "Note saved to Zotero" : "Highlight saved to Zotero",
    );
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
  }
}

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
  const zoteroConnected = useZoteroStore((s) => s.isAuthenticated);
  const canHighlight = Boolean(paper.zotero && zoteroConnected);
  const [selection, setSelection] = useState<PdfTextSelection | null>(null);
  const [noteFor, setNoteFor] = useState<PdfTextSelection | null>(null);

  const actions = useMemo<ToolbarAction[]>(
    () => [
      {
        id: "copy",
        label: "Copy",
        icon: <CopyIcon className="size-4" />,
        hint: "⌘C",
      },
      ...(canHighlight
        ? [
            {
              id: "note",
              label: "Add note",
              icon: <MessageSquarePlusIcon className="size-4" />,
            },
          ]
        : []),
    ],
    [canHighlight],
  );

  const dismiss = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

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
      {visible && selection && (
        <SelectionToolbar
          anchor={{ x: selection.position.left, y: selection.position.top }}
          contextLabel={paper.label}
          actions={actions}
          onDismiss={dismiss}
          onSendPrompt={(prompt) => {
            useClaudeChatStore.getState().sendPrompt(prompt, {
              label: paper.label,
              filePath: paper.label,
              selectedText: `[From “${paper.label}”, page ${selection.pageNumber}]\n${selection.text}`,
            });
            dismiss();
          }}
          onAction={(id) => {
            if (id === "copy") {
              navigator.clipboard
                .writeText(selection.text)
                .then(() => toast.success("Copied"))
                .catch(() => toast.error("Couldn't copy"));
              dismiss();
            } else if (id === "note") {
              setNoteFor(selection);
              setSelection(null);
            }
          }}
          onHighlight={
            canHighlight
              ? (color) => {
                  saveHighlight(paper, selection, color);
                  dismiss();
                }
              : undefined
          }
        />
      )}
      {noteFor && (
        <div
          className="fixed z-50 w-72 rounded-lg border border-border bg-background p-2.5 shadow-xl"
          style={{
            left: Math.min(noteFor.position.left, window.innerWidth - 300),
            top: Math.min(noteFor.position.top + 8, window.innerHeight - 180),
          }}
          onKeyDown={(e) => e.key === "Escape" && setNoteFor(null)}
        >
          <NoteInput
            placeholder="Your note, saved in Zotero…"
            autoFocus
            submitLabel="Save"
            onSubmit={(text) => {
              saveHighlight(paper, noteFor, "yellow", text.trim());
              setNoteFor(null);
              window.getSelection()?.removeAllRanges();
            }}
            onCancel={() => setNoteFor(null)}
          />
        </div>
      )}
      <PdfViewer
        onTextSelect={setSelection}
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
