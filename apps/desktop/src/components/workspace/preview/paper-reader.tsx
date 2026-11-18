import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { noteBookmark, notePage, noteReading } from "@/lib/plan/reading-sync";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useReaderFull } from "@/stores/reader-full-store";
import { getMupdfClient } from "@/lib/mupdf/mupdf-client";
import { getOrOpenDocument } from "@/lib/mupdf/pdf-doc-cache";
import {
  loadPdfNotes,
  localKey,
  pdfVersion,
  savePdfNotes,
} from "@/lib/pdf-notes";
import { reanchor } from "@/lib/pdf-reanchor";
import { onFlush } from "@/lib/flush";
import { addPdfPassageToNote } from "@/lib/vault/pdf-passage";
import { ReadingStatusButton } from "./reading-status";
import { addPassageToNote } from "@/lib/vault/add-passage";
import { useDockStore } from "@/stores/dock-store";
import { filedToast, NotePicker } from "./group-picker";
import { notesByHighlight, openInVault } from "../highlight-quote";
import { useVaultStore } from "@/stores/vault-store";
import {
  removePassageEverywhere,
  updatePassageComment,
} from "@/lib/vault/passage-edits";
import { addPaperToVault } from "@/lib/vault/add-paper";
import { mergeLineRects } from "@/lib/pdf-line-rects";
import {
  BookmarkIcon,
  BookOpenIcon,
  CopyIcon,
  MessageSquarePlusIcon,
  MinusIcon,
  PlusIcon,
  NotebookPenIcon,
  Link2Icon,
  PanelRightIcon,
  HistoryIcon,
  Trash2Icon,
} from "lucide-react";
import { useLibraryPreview } from "@/components/zotero-pdf-dialog";
import { toast } from "sonner";
import { NoteInput } from "@/components/workspace/editor/annotation-card";
import {
  SelectionToolbar,
  type ToolbarAction,
} from "@/components/workspace/editor/selection-toolbar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AnnotationColor } from "@/lib/annotations/types";
import {
  createZoteroHighlight,
  deleteZoteroItem,
  updateZoteroAnnotation,
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
import { FullWindowButton } from "./full-window-button";

/** The app's highlight swatches, in Zotero's own colors. */
const ZOTERO_COLOR: Record<AnnotationColor, string> = {
  yellow: ZOTERO_HIGHLIGHT_COLORS.yellow,
  green: ZOTERO_HIGHLIGHT_COLORS.green,
  blue: ZOTERO_HIGHLIGHT_COLORS.blue,
  pink: ZOTERO_HIGHLIGHT_COLORS.red,
  purple: ZOTERO_HIGHLIGHT_COLORS.purple,
  none: ZOTERO_HIGHLIGHT_COLORS.yellow,
};

/** The colors a highlight can be changed to, as Zotero shows them. */
const SWATCHES: Partial<Record<AnnotationColor, string>> = {
  yellow: ZOTERO_HIGHLIGHT_COLORS.yellow,
  green: ZOTERO_HIGHLIGHT_COLORS.green,
  blue: ZOTERO_HIGHLIGHT_COLORS.blue,
  pink: ZOTERO_HIGHLIGHT_COLORS.red,
  purple: ZOTERO_HIGHLIGHT_COLORS.purple,
};

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

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
  if (selection.rects.length === 0) {
    toast.error("Couldn't tell where that text is on the page.");
    return null;
  }
  const hex = ZOTERO_COLOR[color];
  // Saved as one band per line, as Zotero makes them, not a piece per word.
  const rects = mergeLineRects(selection.rects);
  // A PDF of your own (not in Zotero): kept on this computer.
  if (!paper.zotero && paper.filePath) {
    const key = localKey();
    onAdded({
      key,
      pageIndex: selection.pageNumber - 1,
      rects,
      color: hex,
      type: "highlight",
      text: selection.text,
      comment,
    });
    if (!quiet) toast.success(comment ? "Comment saved" : "Highlight saved");
    return key;
  }
  if (!paper.zotero || !apiKey || !userID) return null;
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
    // Highlighted, on the reading lists it's on.
    void noteReading(paper.zotero.itemKey, "highlighted");
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

/** Quotes a highlight already made in a vault note. */
async function fileExisting(
  paper: ReadingPaper,
  annotation: PdfAnnotationRect,
  name: string,
) {
  // A PDF of your own: quoted with a link back to it, at the highlight.
  if (!paper.zotero && paper.filePath && annotation.key) {
    try {
      filedToast(
        await addPdfPassageToNote(name, {
          path: paper.filePath,
          key: annotation.key,
          text: annotation.text ?? "",
          comment: annotation.comment,
          page: annotation.pageIndex + 1,
        }),
      );
    } catch (err) {
      toast.error(
        `Couldn't add it to the note: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }
  if (!paper.zotero || !annotation.key) return;
  try {
    const note = await addPassageToNote(name, {
      itemKey: paper.zotero.itemKey,
      attachmentKey: paper.zotero.attachmentKey,
      annotationKey: annotation.key,
      text: annotation.text ?? "",
      comment: annotation.comment,
      pageLabel: annotation.pageLabel,
      pageIndex: annotation.pageIndex,
    });
    filedToast(note);
  } catch (err) {
    toast.error(
      `Couldn't add it to the note: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Highlights the selection and quotes the passage in a vault note. */
async function fileHighlight(
  paper: ReadingPaper,
  selection: PdfTextSelection,
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
  if (key && !paper.zotero && paper.filePath) {
    try {
      filedToast(
        await addPdfPassageToNote(name, {
          path: paper.filePath,
          key,
          text: selection.text,
          page: selection.pageNumber,
        }),
      );
    } catch (err) {
      toast.error(
        `Highlighted, but not added to the note: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }
  if (!key || !paper.zotero) return;
  try {
    const note = await addPassageToNote(name, {
      itemKey: paper.zotero.itemKey,
      attachmentKey: paper.zotero.attachmentKey,
      annotationKey: key,
      text: selection.text,
      pageIndex: selection.pageNumber - 1,
    });
    filedToast(note);
  } catch (err) {
    toast.error(
      `Highlighted in Zotero, but not added to the note: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * A comment written straight after highlighting (or with "Add comment"):
 * the text, and the color, in one small box. Enter saves; Esc or a click
 * elsewhere closes it, keeping what's been typed.
 */
function QuickComment({
  at,
  color: initialColor,
  placeholder,
  onSave,
  onClose,
}: {
  at: { left: number; top: number };
  color: AnnotationColor;
  placeholder: string;
  onSave: (text: string, color: AnnotationColor) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [color, setColor] = useState(initialColor);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ text, color });
  latest.current = { text, color };
  const done = useRef(false);
  const finish = useCallback(
    (save: boolean) => {
      if (done.current) return;
      done.current = true;
      if (save) onSave(latest.current.text.trim(), latest.current.color);
      onClose();
    },
    [onSave, onClose],
  );
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      // Typed something, or changed the color: kept. Otherwise just gone.
      finish(
        !!latest.current.text.trim() || latest.current.color !== initialColor,
      );
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [finish, initialColor]);
  return (
    <div
      ref={box}
      className="fixed z-50 w-72 rounded-lg border border-border bg-background p-2 shadow-xl"
      style={{
        left: Math.min(at.left, window.innerWidth - 300),
        top: Math.min(at.top + 8, window.innerHeight - 150),
      }}
    >
      <textarea
        // biome-ignore lint/a11y/noAutofocus: it's opened to be typed in
        autoFocus
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish(true);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
        placeholder={placeholder}
        aria-label="Comment"
        className="w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1.5 px-1 pt-1">
        {(Object.keys(SWATCHES) as AnnotationColor[]).map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`Highlight ${c}`}
            aria-pressed={c === color}
            onClick={() => setColor(c)}
            className={cn(
              "size-4 rounded-full ring-offset-1 ring-offset-background hover:ring-2 hover:ring-ring",
              c === color && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: SWATCHES[c] }}
          />
        ))}
        <span className="flex-1" />
        <span className="text-[10px] text-muted-foreground">Enter to save</span>
      </div>
    </div>
  );
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

  // In the Library, going full window and back: once the reader has its
  // new size, the page is fitted to its width again (it zooms with the
  // room, rather than gaining margin), on the page it was on.
  const readerFull = useReaderFull((st) => st.on);
  const refit = useRef<{ page?: number; width: number } | null>(null);
  const pageRef = useRef<number | undefined>(undefined);
  const firstSwitch = useRef(true);
  useEffect(() => {
    if (firstSwitch.current) {
      firstSwitch.current = false;
      return;
    }
    if (!inline) return;
    refit.current = {
      page: pageRef.current,
      width: wrapperRef.current?.clientWidth ?? 0,
    };
    // Nothing changed size after all: forget it.
    const timer = setTimeout(() => {
      refit.current = null;
    }, 1500);
    return () => clearTimeout(timer);
  }, [readerFull, inline]);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const seen = new ResizeObserver(() => {
      const asked = refit.current;
      const width = el.clientWidth;
      if (!asked || !pageWidthRef.current || Math.abs(width - asked.width) < 8)
        return;
      refit.current = null;
      changeScale((width - 40) / pageWidthRef.current);
      const page = asked.page;
      if (page) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => scrollToPageRef.current?.(page)),
        );
      }
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [changeScale]);

  // Opened: among the recently opened. It's only "reading" on its lists
  // once you move through it (a look isn't reading), and the last page is
  // kept there once it has stayed put a moment.
  const itemKey = paper.zotero?.itemKey;
  useEffect(() => {
    if (!visible || !itemKey) return;
    useBookmarkStore.getState().opened(itemKey, paper.label);
  }, [visible, itemKey, paper.label]);
  const firstPage = useRef<number | undefined>(undefined);
  const [pageCount, setPageCount] = useState<number | undefined>();
  const [readingPage, setReadingPage] = useState<number | undefined>();
  pageRef.current = readingPage;
  const placeKey = itemKey ?? paper.id;
  const bookmark = useBookmarkStore((s) => s.places[placeKey]?.bookmark);
  useEffect(() => {
    if (!visible || !readingPage) return;
    firstPage.current ??= readingPage;
    const timer = setTimeout(() => {
      useBookmarkStore.getState().setLast(placeKey, readingPage);
      // Opened where it was: not read further yet.
      if (itemKey && readingPage !== firstPage.current) {
        void notePage(itemKey, readingPage, pageCount);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [visible, itemKey, placeKey, readingPage, pageCount]);
  const toggleBookmark = () => {
    const page = readingPage ?? 1;
    const next = bookmark === page ? undefined : page;
    useBookmarkStore.getState().setBookmark(placeKey, next);
    if (itemKey) void noteBookmark(itemKey, next, pageCount);
    toast(next ? `Bookmarked page ${next}` : "Bookmark removed");
  };

  // Highlights made here show at once; the open tab of this paper, if any,
  // gets them too.
  const [added, setAdded] = useState<PdfAnnotationRect[]>([]);
  // Highlights recolored, noted or deleted here, until the paper's reloaded.
  const [changed, setChanged] = useState<
    Record<string, Partial<PdfAnnotationRect> | null>
  >({});
  // A PDF of your own: its highlights from this computer, kept as they change.
  const local = !paper.zotero && !!paper.filePath;
  const [localNotes, setLocalNotes] = useState<PdfAnnotationRect[] | null>(
    null,
  );
  // Which build of the PDF they're placed on.
  const versionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!local || !paper.filePath) return;
    const path = paper.filePath;
    let live = true;
    void (async () => {
      let kept: Awaited<ReturnType<typeof loadPdfNotes>>;
      try {
        kept = await loadPdfNotes(path);
      } catch (err) {
        // Unreadable: highlighting stays off for it (localNotes stays null,
        // so nothing is saved over them), and it says so.
        console.warn("Couldn't read this PDF's highlights", err);
        toast.error(
          "Couldn't read this PDF's highlights. They're left as they were.",
        );
        return;
      }
      const { notes, version } = kept;
      const now = pdfVersion(paper.data);
      versionRef.current = now;
      if (notes.length === 0 || version === now) {
        if (live) setLocalNotes(notes);
        return;
      }
      // Rebuilt since: each highlight found again by its words.
      try {
        const { docId, pageSizes } = await getOrOpenDocument(paper.data);
        const client = getMupdfClient();
        const placed = await reanchor(notes, {
          count: pageSizes.length,
          height: (i) => pageSizes[i]?.height ?? 0,
          chars: (i) => client.getPageChars(docId, i),
        });
        if (!live) return;
        setLocalNotes(placed);
        await savePdfNotes(path, placed, now);
      } catch {
        // Couldn't read the pages: shown where they were.
        if (live) setLocalNotes(notes);
      }
    })();
    return () => {
      live = false;
    };
  }, [local, paper.filePath, paper.data]);
  const base = local ? (localNotes ?? []) : (paper.annotations ?? []);
  const annotations = useMemo(() => {
    const known = new Set(base.map((a) => a.key));
    return [
      ...base,
      ...added.filter((a) => !a.key || !known.has(a.key)),
    ].flatMap((a) => {
      const change = a.key ? changed[a.key] : undefined;
      if (change === null) return [];
      return change ? [{ ...a, ...change }] : [a];
    });
  }, [paper.annotations, localNotes, local, added, changed]);
  // Saved whenever they change (after the first load).
  // What's waiting to be saved: written a moment after the last change,
  // or at once when the reader closes or the app quits. One at a time.
  const pendingSave = useRef<(() => Promise<void>) | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const saveNow = useCallback(() => {
    const save = pendingSave.current;
    pendingSave.current = null;
    if (!save) return saving.current;
    saving.current = saving.current.then(save);
    return saving.current;
  }, []);
  useEffect(() => {
    if (!local || !paper.filePath || localNotes === null) return;
    const path = paper.filePath;
    const notes = annotations;
    pendingSave.current = () =>
      savePdfNotes(path, notes, versionRef.current).catch((err) => {
        toast.error(`Couldn't save the highlights: ${errorText(err)}`);
      });
    const timer = setTimeout(() => void saveNow(), 300);
    return () => clearTimeout(timer);
  }, [local, paper.filePath, localNotes, annotations, saveNow]);
  useEffect(() => {
    const off = onFlush(saveNow);
    return () => {
      off();
      void saveNow();
    };
  }, [saveNow]);
  const change = useCallback(
    (key: string, next: Partial<PdfAnnotationRect> | null) => {
      setChanged((c) => ({ ...c, [key]: next }));
      useReadingStore.getState().changeAnnotation(paper.id, key, next);
    },
    [paper.id],
  );
  const onAdded = useCallback(
    (annotation: PdfAnnotationRect) => {
      setAdded((list) => [...list, annotation]);
      useReadingStore.getState().addAnnotation(paper.id, annotation);
    },
    [paper.id],
  );
  // On the page: the ones this version of the PDF still has the words of.
  const shown = useMemo(
    () => annotations.filter((a) => !a.stale),
    [annotations],
  );
  const earlier = useMemo(
    () => annotations.filter((a) => a.stale),
    [annotations],
  );
  const count = shown.length;

  // Brought to the highlight (or page) a link asked for, once the pages
  // are there, and again for each new request.
  const scrollToPageRef = useRef<((page: number) => void) | null>(null);
  const focusAnnotationRef = useRef<((key: string) => boolean) | null>(null);
  const [loaded, setLoaded] = useState(false);
  const focus = paper.focus;
  // Opened where it was left: at its bookmark, or the page last open.
  const reopened = useRef(false);
  useEffect(() => {
    if (!loaded || focus || reopened.current) return;
    reopened.current = true;
    const place = useBookmarkStore.getState().places[placeKey];
    const page = place?.bookmark ?? place?.last;
    if (!page || page <= 1) return;
    const timer = setTimeout(() => scrollToPageRef.current?.(page), 60);
    return () => clearTimeout(timer);
  }, [loaded, focus, placeKey]);
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
  // A PDF of your own: only once its highlights are read (unreadable, a new
  // one couldn't be saved without losing the others).
  const canHighlight = Boolean(
    (paper.zotero && zoteroConnected) || (local && localNotes !== null),
  );
  const [selection, setSelection] = useState<PdfTextSelection | null>(null);
  const [noteFor, setNoteFor] = useState<PdfTextSelection | null>(null);
  // Just highlighted: a comment on it, if you like, without another click.
  const [justMade, setJustMade] = useState<{
    annotation: PdfAnnotationRect;
    color: AnnotationColor;
    at: { left: number; top: number };
  } | null>(null);
  const [filing, setFiling] = useState<PdfTextSelection | null>(null);
  // A highlight right-clicked: its menu, then the idea or topic picker.
  const [highlightMenu, setHighlightMenu] = useState<{
    annotation: PdfAnnotationRect;
    at: { left: number; top: number };
    /** Picking the note it goes in. */
    picking?: boolean;
    confirmDelete?: boolean;
  } | null>(null);
  // The vault notes quoting each highlight, for its menu.
  const vaultIndex = useVaultStore((s) => s.index);
  const quotedIn = useMemo(() => notesByHighlight(vaultIndex), [vaultIndex]);
  // A highlight's note being written or changed.
  const [editingNote, setEditingNote] = useState<{
    annotation: PdfAnnotationRect;
    at: { left: number; top: number };
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
              label: "Comment",
              icon: <MessageSquarePlusIcon className="size-4" />,
            },
            {
              id: "file",
              label: "Add to note…",
              icon: <NotebookPenIcon className="size-4" />,
            },
          ]
        : []),
    ],
    [canHighlight, local],
  );

  const recolor = async (a: PdfAnnotationRect, color: AnnotationColor) => {
    if (local && a.key) {
      change(a.key, { color: ZOTERO_COLOR[color] });
      return;
    }
    const { apiKey, userID } = useZoteroStore.getState();
    if (!a.key || !apiKey || !userID) return;
    const before = a.color;
    const hex = ZOTERO_COLOR[color];
    change(a.key, { color: hex });
    try {
      await updateZoteroAnnotation(apiKey, userID, a.key, { color: hex });
    } catch (err) {
      change(a.key, { color: before });
      toast.error(`Couldn't change it in Zotero: ${errorText(err)}`);
    }
  };

  const renote = async (a: PdfAnnotationRect, comment: string) => {
    if (local && a.key) {
      if (comment === (a.comment ?? "")) return;
      change(a.key, { comment });
      toast.success(comment ? "Comment saved" : "Comment removed");
      // The notes quoting it show the new comment too.
      void updatePassageComment(a.key, a.comment, comment).catch(() => []);
      return;
    }
    const { apiKey, userID } = useZoteroStore.getState();
    if (!a.key || !apiKey || !userID) return;
    if (comment === (a.comment ?? "")) return;
    change(a.key, { comment });
    try {
      await updateZoteroAnnotation(apiKey, userID, a.key, { comment });
      await updatePassageComment(a.key, a.comment, comment).catch(() => []);
      toast.success(comment ? "Note saved to Zotero" : "Note removed");
    } catch (err) {
      change(a.key, { comment: a.comment });
      toast.error(`Couldn't save it in Zotero: ${errorText(err)}`);
    }
  };

  const removeHighlight = async (a: PdfAnnotationRect) => {
    if (local && a.key) {
      change(a.key, null);
      // Its passage leaves the notes it was added to.
      const notes = await removePassageEverywhere(a.key, a.comment).catch(
        () => [] as string[],
      );
      toast.success(
        notes.length
          ? `Highlight deleted, and its passage from ${notes.map((n) => `“${n}”`).join(", ")}`
          : "Highlight deleted",
      );
      return;
    }
    const { apiKey, userID } = useZoteroStore.getState();
    if (!a.key || !apiKey || !userID) return;
    change(a.key, null);
    try {
      await deleteZoteroItem(apiKey, userID, a.key);
    } catch (err) {
      change(a.key, {});
      toast.error(`Couldn't delete it in Zotero: ${errorText(err)}`);
      return;
    }
    // Its passage leaves the ideas and topics it was added to.
    const notes = await removePassageEverywhere(a.key, a.comment).catch(
      () => [] as string[],
    );
    toast.success(
      notes.length
        ? `Highlight deleted, and its passage from ${notes.map((n) => `“${n}”`).join(", ")}`
        : "Highlight deleted",
    );
    // The paper's own note lists its highlights.
    if (paper.zotero)
      void addPaperToVault(paper.zotero.itemKey).catch(() => {});
  };

  // Esc closes the highlight's menu and the note box too.
  const anyOpen = Boolean(
    noteFor || editingNote || (highlightMenu && !highlightMenu.picking),
  );
  useEffect(() => {
    if (!anyOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setNoteFor(null);
      setEditingNote(null);
      setHighlightMenu((m) => (m && !m.picking ? null : m));
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
        {earlier.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1 px-2 text-muted-foreground text-xs"
                title="Highlights whose text isn't in this version of the PDF"
              >
                <HistoryIcon className="size-3.5" />
                {earlier.length} from earlier versions
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <p className="border-b px-3 py-2 text-muted-foreground text-xs">
                Not in this version of the PDF
              </p>
              <ul className="max-h-80 overflow-y-auto py-1">
                {earlier.map((a) => (
                  <li
                    key={a.key}
                    className="group flex items-start gap-2 px-3 py-1.5"
                  >
                    <span
                      className="mt-1 size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: a.color }}
                    />
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="line-clamp-3">{a.text}</span>
                      {a.comment && (
                        <span className="mt-0.5 line-clamp-2 block text-muted-foreground">
                          {a.comment}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                      title="Delete"
                      aria-label="Delete"
                      onClick={() => void removeHighlight(a)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
        {itemKey && <ReadingStatusButton itemKey={itemKey} />}
        {bookmark && readingPage !== bookmark && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => scrollToPageRef.current?.(bookmark)}
            title="Go to the bookmark"
          >
            <BookmarkIcon className="size-3.5" />
            p. {bookmark}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={toggleBookmark}
          title={
            bookmark === (readingPage ?? 1)
              ? "Remove the bookmark"
              : "Bookmark this page"
          }
          aria-label={
            bookmark === (readingPage ?? 1)
              ? "Remove the bookmark"
              : "Bookmark this page"
          }
        >
          <BookmarkIcon
            className="size-3.5"
            fill={bookmark === (readingPage ?? 1) ? "currentColor" : "none"}
          />
        </Button>
        {headerActions}
        {!inline && <FullWindowButton />}
        {!inline && paper.zotero && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => {
              const { itemKey } = paper.zotero ?? {};
              if (!itemKey) return;
              // To the Reference panel's preview, beside the editor.
              useDockStore.getState().setOpen("reference", true);
              useLibraryPreview.getState().ask({ itemKey, label: paper.label });
              useReadingStore.getState().close(paper.id);
            }}
            title="Move to the side panel"
            aria-label="Move to the side panel"
          >
            <PanelRightIcon className="size-3.5" />
          </Button>
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
          anchor={{
            x: selection.position.left,
            y: selection.position.top,
            aboveY: selection.firstTop,
          }}
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
            } else if (id === "file") {
              setFiling(selection);
              setSelection(null);
            }
          }}
          onHighlight={
            canHighlight
              ? (color) => {
                  const at = selection.position;
                  const made = selection;
                  dismiss();
                  void saveHighlight(
                    paper,
                    made,
                    color,
                    undefined,
                    true,
                    onAdded,
                  ).then((key) => {
                    if (!key) return;
                    setJustMade({
                      annotation: {
                        key,
                        pageIndex: made.pageNumber - 1,
                        rects: [],
                        color: ZOTERO_COLOR[color],
                        type: "highlight",
                        text: made.text,
                      },
                      color,
                      at,
                    });
                  });
                }
              : undefined
          }
        />
      )}
      {highlightMenu && !highlightMenu.picking && (
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
            className="glass fixed z-50 w-52 rounded-md border border-border bg-popover p-1 text-sm shadow-lg"
            style={{
              left: Math.min(highlightMenu.at.left, window.innerWidth - 220),
              top: Math.min(highlightMenu.at.top, window.innerHeight - 200),
            }}
          >
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              {(Object.keys(SWATCHES) as AnnotationColor[]).map((color) => (
                <button
                  key={color}
                  type="button"
                  title={`Make it ${color}`}
                  aria-label={`Make it ${color}`}
                  onClick={() => {
                    void recolor(highlightMenu.annotation, color);
                    setHighlightMenu(null);
                  }}
                  className="size-4 rounded-full ring-offset-1 ring-offset-popover hover:ring-2 hover:ring-ring"
                  style={{ backgroundColor: SWATCHES[color] }}
                />
              ))}
            </div>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                setEditingNote({
                  annotation: highlightMenu.annotation,
                  at: highlightMenu.at,
                });
                setHighlightMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <MessageSquarePlusIcon className="size-3.5" />
              {highlightMenu.annotation.comment
                ? "Edit comment"
                : "Add comment"}
            </button>
            {
              <button
                type="button"
                onClick={() =>
                  setHighlightMenu({ ...highlightMenu, picking: true })
                }
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <NotebookPenIcon className="size-3.5" />
                Add to note…
              </button>
            }
            {(() => {
              const quoting = highlightMenu.annotation.key
                ? (quotedIn.get(highlightMenu.annotation.key) ?? []).filter(
                    (n) => n.kind !== "paper",
                  )
                : [];
              return quoting.length > 0 ? (
                <>
                  <div className="my-1 h-px bg-border" />
                  <div className="px-2 py-1 text-muted-foreground text-xs">
                    In your vault
                  </div>
                  {quoting.map((n) => (
                    <button
                      key={n.path}
                      type="button"
                      onClick={() => {
                        openInVault(n.name);
                        setHighlightMenu(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      <Link2Icon className="size-3.5 shrink-0" />
                      <span className="truncate">{n.title}</span>
                    </button>
                  ))}
                </>
              ) : null;
            })()}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                if (!highlightMenu.confirmDelete) {
                  setHighlightMenu({ ...highlightMenu, confirmDelete: true });
                  return;
                }
                void removeHighlight(highlightMenu.annotation);
                setHighlightMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-destructive text-xs hover:bg-destructive/10"
            >
              <Trash2Icon className="size-3.5" />
              {highlightMenu.confirmDelete
                ? local
                  ? "Delete it"
                  : "Delete it, here and in Zotero"
                : "Delete highlight"}
            </button>
          </div>
        </>
      )}
      {highlightMenu?.picking && (
        <NotePicker
          anchor={highlightMenu.at}
          marker={
            highlightMenu.annotation.key
              ? `annotation=${highlightMenu.annotation.key}`
              : undefined
          }
          onCancel={() => setHighlightMenu(null)}
          onPick={(name) => fileExisting(paper, highlightMenu.annotation, name)}
        />
      )}
      {filing && (
        <NotePicker
          anchor={filing.position}
          onCancel={() => setFiling(null)}
          onPick={async (name) => {
            window.getSelection()?.removeAllRanges();
            await fileHighlight(paper, filing, name, onAdded);
          }}
        />
      )}
      {editingNote && (
        <div
          className="fixed z-50 w-72 rounded-lg border border-border bg-background p-2.5 shadow-xl"
          style={{
            left: Math.min(editingNote.at.left, window.innerWidth - 300),
            top: Math.min(editingNote.at.top + 8, window.innerHeight - 180),
          }}
        >
          <NoteInput
            placeholder="Your comment, saved in Zotero…"
            initial={editingNote.annotation.comment ?? ""}
            autoFocus
            submitLabel="Save"
            onSubmit={(text) => {
              void renote(editingNote.annotation, text.trim());
              setEditingNote(null);
            }}
            onCancel={() => setEditingNote(null)}
          />
        </div>
      )}
      {noteFor && (
        <QuickComment
          at={noteFor.position}
          color="yellow"
          placeholder={
            local ? "Your comment…" : "Your comment, saved in Zotero…"
          }
          onSave={(text, color) => {
            if (!text) return;
            void saveHighlight(paper, noteFor, color, text, false, onAdded);
            window.getSelection()?.removeAllRanges();
          }}
          onClose={() => setNoteFor(null)}
        />
      )}
      {justMade && (
        <QuickComment
          key={justMade.annotation.key}
          at={justMade.at}
          color={justMade.color}
          placeholder="Add a comment (optional)"
          onSave={(text, color) => {
            const a = justMade.annotation;
            if (color !== justMade.color) void recolor(a, color);
            if (text) void renote(a, text);
          }}
          onClose={() => setJustMade(null)}
        />
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
        onLoadSuccess={(pages) => {
          setLoaded(true);
          setPageCount(pages);
        }}
        onCurrentPageChange={setReadingPage}
        onFirstPageSize={(width) => {
          pageWidthRef.current = width;
          fitIfNew();
        }}
        annotations={shown}
        theme={theme}
        onThemeChange={setTheme}
      />
    </div>
  );
}
