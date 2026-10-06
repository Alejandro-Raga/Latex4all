import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { addPassage, type PassageGroup } from "@/lib/vault/add-passage";
import { useDockStore } from "@/stores/dock-store";
import { useVaultStore } from "@/stores/vault-store";
import { GroupPicker } from "./group-picker";
import { mergeLineRects } from "@/lib/pdf-line-rects";
import {
  BookOpenIcon,
  CopyIcon,
  MessageSquarePlusIcon,
  MinusIcon,
  PlusIcon,
  LightbulbIcon,
  TagIcon,
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
import {
  type PdfAnnotationRect,
  type PdfTextSelection,
  PdfViewer,
} from "./pdf-viewer";

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
  comment: string | undefined,
  quiet: boolean,
  onAdded: (annotation: PdfAnnotationRect) => void,
): Promise<string | null> {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!paper.zotero || !apiKey || !userID) return null;
  if (selection.rects.length === 0) {
    toast.error("Couldn't tell where that text is on the page.");
    return null;
  }
  const hex = ZOTERO_COLOR[color];
  // Saved as one band per line, as Zotero makes them, not a piece per word.
  const rects = mergeLineRects(selection.rects);
  try {
    const key = await createZoteroHighlight(
      apiKey,
      userID,
      paper.zotero.attachmentKey,
      {
        pageIndex: selection.pageNumber - 1,
        rects,
        text: selection.text,
        comment,
        color: hex,
      },
      selection.pageHeight,
    );
    onAdded({
      key,
      pageIndex: selection.pageNumber - 1,
      rects,
      color: hex,
      type: "highlight",
      text: selection.text,
      comment,
    });
    if (!quiet) {
      toast.success(
        comment ? "Note saved to Zotero" : "Highlight saved to Zotero",
      );
    }
    return key;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Files a highlight already made under an idea or topic. */
async function fileExisting(
  paper: ReadingPaper,
  annotation: PdfAnnotationRect,
  group: PassageGroup,
  name: string,
) {
  if (!paper.zotero || !annotation.key) return;
  try {
    const note = await addPassage(group, name, {
      itemKey: paper.zotero.itemKey,
      attachmentKey: paper.zotero.attachmentKey,
      annotationKey: annotation.key,
      text: annotation.text ?? "",
      comment: annotation.comment,
      pageLabel: annotation.pageLabel,
      pageIndex: annotation.pageIndex,
    });
    filedToast(group, note);
  } catch (err) {
    toast.error(
      `Couldn't add it to the ${group}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function filedToast(group: PassageGroup, note: string) {
  toast.success(
    `Added to ${group === "idea" ? "the idea" : "the topic"} “${note}”`,
    {
      action: {
        label: "Open",
        onClick: () => {
          useDockStore.getState().setOpen("vault", true);
          useVaultStore.getState().open(note);
        },
      },
    },
  );
}

/** Highlights the selection and files the passage under an idea or topic. */
async function fileHighlight(
  paper: ReadingPaper,
  selection: PdfTextSelection,
  group: PassageGroup,
  name: string,
  onAdded: (annotation: PdfAnnotationRect) => void,
) {
  const key = await saveHighlight(
    paper,
    selection,
    "yellow",
    undefined,
    true,
    onAdded,
  );
  if (!key || !paper.zotero) return;
  try {
    const note = await addPassage(group, name, {
      itemKey: paper.zotero.itemKey,
      attachmentKey: paper.zotero.attachmentKey,
      annotationKey: key,
      text: selection.text,
      pageIndex: selection.pageNumber - 1,
    });
    filedToast(group, note);
  } catch (err) {
    toast.error(
      `Highlighted in Zotero, but not added to the ${group}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Zoom per paper for this session, so coming back to one keeps its size. */
const zoomByPaper = new Map<string, number>();

/** A paper read at full size in a tab of the PDF pane. */
export function PaperReader({
  paper,
  visible,
  inline = false,
  status,
  actions: headerActions,
}: {
  paper: ReadingPaper;
  /** Its tab is in front (hidden tabs stay mounted to keep their place). */
  visible: boolean;
  /** Shown inside a panel (the Library's preview), under its own title. */
  inline?: boolean;
  /** In place of the highlight count (an error loading them, say). */
  status?: ReactNode;
  /** Buttons for the header, before the zoom. */
  actions?: ReactNode;
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

  // Highlights made here show at once; the open tab of this paper, if any,
  // gets them too.
  const [added, setAdded] = useState<PdfAnnotationRect[]>([]);
  const annotations = useMemo(() => {
    const known = new Set((paper.annotations ?? []).map((a) => a.key));
    return [
      ...(paper.annotations ?? []),
      ...added.filter((a) => !a.key || !known.has(a.key)),
    ];
  }, [paper.annotations, added]);
  const onAdded = useCallback(
    (annotation: PdfAnnotationRect) => {
      setAdded((list) => [...list, annotation]);
      useReadingStore.getState().addAnnotation(paper.id, annotation);
    },
    [paper.id],
  );
  const count = annotations.length;

  // Brought to the highlight (or page) a link asked for, once the pages
  // are there, and again for each new request.
  const scrollToPageRef = useRef<((page: number) => void) | null>(null);
  const focusAnnotationRef = useRef<((key: string) => boolean) | null>(null);
  const [loaded, setLoaded] = useState(false);
  const focus = paper.focus;
  useEffect(() => {
    if (!loaded || !focus) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      tries++;
      const key = focus.annotationKey;
      if (key && focusAnnotationRef.current?.(key)) return;
      if (key && tries < 30) {
        timer = setTimeout(attempt, 100);
        return;
      }
      if (focus.page) scrollToPageRef.current?.(focus.page);
    };
    timer = setTimeout(attempt, 60);
    return () => clearTimeout(timer);
  }, [loaded, focus]);
  const zoteroConnected = useZoteroStore((s) => s.isAuthenticated);
  const canHighlight = Boolean(paper.zotero && zoteroConnected);
  const [selection, setSelection] = useState<PdfTextSelection | null>(null);
  const [noteFor, setNoteFor] = useState<PdfTextSelection | null>(null);
  const [filing, setFiling] = useState<{
    group: PassageGroup;
    selection: PdfTextSelection;
  } | null>(null);
  // A highlight right-clicked: its menu, then the idea or topic picker.
  const [highlightMenu, setHighlightMenu] = useState<{
    annotation: PdfAnnotationRect;
    at: { left: number; top: number };
    group?: PassageGroup;
  } | null>(null);

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
            {
              id: "idea",
              label: "Add to idea…",
              icon: <LightbulbIcon className="size-4" />,
            },
            {
              id: "topic",
              label: "Add to topic…",
              icon: <TagIcon className="size-4" />,
            },
          ]
        : []),
    ],
    [canHighlight],
  );

  // Esc closes the highlight's menu and the note box too.
  const anyOpen = Boolean(noteFor || (highlightMenu && !highlightMenu.group));
  useEffect(() => {
    if (!anyOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setNoteFor(null);
      setHighlightMenu((m) => (m && !m.group ? null : m));
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [anyOpen]);

  const dismiss = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div ref={wrapperRef} className="flex h-full min-w-0 flex-col bg-muted/50">
      <div
        className={
          inline
            ? "flex h-8 shrink-0 items-center gap-1 border-b bg-background px-2"
            : "pane-header flex h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] shrink-0 items-center gap-1.5 border-b px-3 pt-[var(--titlebar-height)]"
        }
      >
        {!inline && (
          <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {!inline && (
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {paper.label}
          </span>
        )}
        {status ??
          (count > 0 && (
            <span
              className={
                inline
                  ? "min-w-0 flex-1 truncate text-muted-foreground text-xs"
                  : "shrink-0 text-muted-foreground text-xs"
              }
            >
              {count} highlight{count === 1 ? "" : "s"}
            </span>
          ))}
        {inline && !status && count === 0 && <span className="flex-1" />}
        {headerActions}
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
            } else if (id === "idea" || id === "topic") {
              setFiling({ group: id, selection });
              setSelection(null);
            }
          }}
          onHighlight={
            canHighlight
              ? (color) => {
                  saveHighlight(
                    paper,
                    selection,
                    color,
                    undefined,
                    false,
                    onAdded,
                  );
                  dismiss();
                }
              : undefined
          }
        />
      )}
      {highlightMenu && !highlightMenu.group && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setHighlightMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setHighlightMenu(null);
            }}
          />
          <div
            className="fixed z-50 w-48 rounded-md border border-border bg-popover p-1 text-sm shadow-lg"
            style={{
              left: Math.min(highlightMenu.at.left, window.innerWidth - 200),
              top: Math.min(highlightMenu.at.top, window.innerHeight - 90),
            }}
          >
            {(["idea", "topic"] as const).map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => setHighlightMenu({ ...highlightMenu, group })}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                {group === "idea" ? (
                  <LightbulbIcon className="size-3.5" />
                ) : (
                  <TagIcon className="size-3.5" />
                )}
                Add to {group}…
              </button>
            ))}
          </div>
        </>
      )}
      {highlightMenu?.group && (
        <GroupPicker
          group={highlightMenu.group}
          anchor={highlightMenu.at}
          onCancel={() => setHighlightMenu(null)}
          onPick={async (name) => {
            const { annotation, group } = highlightMenu;
            if (group) await fileExisting(paper, annotation, group, name);
            setHighlightMenu(null);
          }}
        />
      )}
      {filing && (
        <GroupPicker
          group={filing.group}
          anchor={filing.selection.position}
          onCancel={() => setFiling(null)}
          onPick={async (name) => {
            await fileHighlight(
              paper,
              filing.selection,
              filing.group,
              name,
              onAdded,
            );
            setFiling(null);
            window.getSelection()?.removeAllRanges();
          }}
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
              saveHighlight(
                paper,
                noteFor,
                "yellow",
                text.trim(),
                false,
                onAdded,
              );
              setNoteFor(null);
              window.getSelection()?.removeAllRanges();
            }}
            onCancel={() => setNoteFor(null)}
          />
        </div>
      )}
      <PdfViewer
        onTextSelect={setSelection}
        onAnnotationContextMenu={
          canHighlight
            ? (annotation, at) => setHighlightMenu({ annotation, at })
            : undefined
        }
        data={paper.data}
        scale={scale}
        rootFileId={paper.id}
        onScaleChange={changeScale}
        scrollToPageRef={scrollToPageRef}
        focusAnnotationRef={focusAnnotationRef}
        onLoadSuccess={() => setLoaded(true)}
        onFirstPageSize={(width) => {
          pageWidthRef.current = width;
          fitIfNew();
        }}
        annotations={annotations}
        theme={theme}
        onThemeChange={setTheme}
      />
    </div>
  );
}
