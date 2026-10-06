import { useEffect, useRef, useState } from "react";
import { Loader2Icon, PanelRightOpenIcon } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type PdfAnnotationRect,
  PdfViewer,
} from "@/components/workspace/preview/pdf-viewer";
import { toast } from "sonner";
import {
  fetchAnnotations,
  fetchAttachmentParent,
  findPdfAttachment,
} from "@/lib/zotero-api";
import { pdfOf, useZoteroLibrary } from "@/lib/zotero-library";
import { zoteroPdfBytes } from "@/lib/zotero-pdf-cache";
import { useDocumentStore } from "@/stores/document-store";
import { type PaperFocus, useReadingStore } from "@/stores/reading-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useZoteroStore } from "@/stores/zotero-store";

interface Target {
  attachmentKey: string;
  /** 1-based, as zotero:// links give it. */
  page: number | null;
  /** The highlight the link is about, to bring into view. */
  annotationKey: string | null;
  label: string;
}

/** Opens a Zotero PDF at a page, from anywhere (a note's "p. 4" link). */
export const useZoteroPdf = create<{
  target: Target | null;
  show: (target: Target) => void;
  close: () => void;
}>((set) => ({
  target: null,
  show: (target) => set({ target }),
  close: () => set({ target: null }),
}));

/** A paper the Library's own preview is asked to show (no project open). */
export const useLibraryPreview = create<{
  /** Whether a Library page is there to show it. */
  listening: number;
  request: { itemKey: string; label: string; focus?: PaperFocus } | null;
  ask: (request: {
    itemKey: string;
    label: string;
    focus?: PaperFocus;
  }) => void;
  done: () => void;
}>((set) => ({
  listening: 0,
  request: null,
  ask: (request) => set({ request }),
  done: () => set({ request: null }),
}));

/** The paper (Zotero item) a PDF attachment belongs to. */
async function paperOf(attachmentKey: string): Promise<string | null> {
  const known = useZoteroLibrary.getState().mirror?.attachments[attachmentKey];
  if (known) return known.parent;
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) return null;
  return fetchAttachmentParent(apiKey, userID, attachmentKey).catch(() => null);
}

/**
 * Opens a note's highlight link ("p. 4") where the paper can be read and
 * worked on: in a tab of the PDF pane with a project open, in the
 * Library's preview without one, at the highlight. Elsewhere, a window.
 */
export async function openZoteroPdf(target: Target) {
  const { apiKey, userID } = useZoteroStore.getState();
  const projectOpen = Boolean(useDocumentStore.getState().projectRoot);
  const library = useLibraryPreview.getState();
  if (!apiKey || !userID || (!projectOpen && !library.listening)) {
    useZoteroPdf.getState().show(target);
    return;
  }
  const focus: PaperFocus = {
    annotationKey: target.annotationKey,
    page: target.page,
    at: Date.now(),
  };
  const itemKey = await paperOf(target.attachmentKey);
  if (!projectOpen) {
    if (itemKey) library.ask({ itemKey, label: target.label, focus });
    else useZoteroPdf.getState().show(target);
    return;
  }
  const opening = toast.loading(`Opening ${target.label}…`);
  try {
    const [data, annotations] = await Promise.all([
      zoteroPdfBytes(apiKey, userID, { key: target.attachmentKey }),
      fetchAnnotations(apiKey, userID, target.attachmentKey).catch(
        () => [] as PdfAnnotationRect[],
      ),
    ]);
    useReadingStore.getState().open({
      // The same tab the Library opens for this paper.
      id: itemKey ? `zotero:${itemKey}` : `zotero-att:${target.attachmentKey}`,
      label: target.label,
      data,
      annotations,
      zotero: itemKey
        ? { itemKey, attachmentKey: target.attachmentKey }
        : undefined,
      focus,
    });
  } catch {
    useZoteroPdf.getState().show(target);
  } finally {
    toast.dismiss(opening);
  }
}

/**
 * Opens a Zotero paper in a tab of the big PDF pane, with its highlights.
 * False when it has no PDF to open there (then the side preview says why).
 */
export async function openPaperInTab(
  itemKey: string,
  label: string,
): Promise<boolean> {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) return false;
  const mirror = useZoteroLibrary.getState().mirror;
  const opening = toast.loading(`Opening ${label}…`);
  try {
    const attachment =
      (mirror && pdfOf(mirror, itemKey)) ??
      (await findPdfAttachment(apiKey, userID, itemKey));
    if (!attachment?.downloadable) return false;
    const [data, annotations] = await Promise.all([
      zoteroPdfBytes(apiKey, userID, attachment),
      fetchAnnotations(apiKey, userID, attachment.key).catch(
        () => [] as PdfAnnotationRect[],
      ),
    ]);
    useReadingStore.getState().open({
      id: `zotero:${itemKey}`,
      label,
      data,
      annotations,
      zotero: { itemKey, attachmentKey: attachment.key },
    });
    return true;
  } catch {
    return false;
  } finally {
    toast.dismiss(opening);
  }
}

/**
 * A zotero://open-pdf link (what paper notes link highlights with), as a
 * target to open here: Latex4All can't hand it to Zotero's own app.
 */
export function zoteroPdfTarget(href: string, label = "Paper"): Target | null {
  const m = href.match(
    /^zotero:\/\/open-pdf\/(?:library|groups\/\d+)\/items\/([A-Z0-9]{8})(?:\?(.*))?$/,
  );
  if (!m) return null;
  const params = new URLSearchParams(m[2] ?? "");
  const page = Number(params.get("page"));
  const annotation = params.get("annotation");
  return {
    attachmentKey: m[1],
    page: Number.isFinite(page) && page > 0 ? page : null,
    annotationKey:
      annotation && /^[A-Z0-9]{8}$/i.test(annotation) ? annotation : null,
    label,
  };
}

/** The PDF a note's highlight link points at, at that page. */
export function ZoteroPdfDialog() {
  const target = useZoteroPdf((s) => s.target);
  const apiKey = useZoteroStore((s) => s.apiKey);
  const userID = useZoteroStore((s) => s.userID);
  const projectOpen = useDocumentStore((s) => Boolean(s.projectRoot));
  const theme = useSettingsStore((s) => s.pdfThemeReference);
  const setTheme = useSettingsStore((s) => s.setPdfThemeReference);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: Uint8Array; annotations: PdfAnnotationRect[] }
  >({ kind: "loading" });
  const [scale, setScale] = useState(1);
  const scrollToPageRef = useRef<((page: number) => void) | null>(null);
  const focusRef = useRef<((key: string) => boolean) | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setState({ kind: "loading" });
    if (!apiKey || !userID) {
      setState({
        kind: "error",
        message: "Connect Zotero in Settings to open its PDFs here.",
      });
      return;
    }
    void Promise.all([
      zoteroPdfBytes(apiKey, userID, { key: target.attachmentKey }),
      fetchAnnotations(apiKey, userID, target.attachmentKey).catch(
        () => [] as PdfAnnotationRect[],
      ),
    ])
      .then(([data, annotations]) => {
        if (!cancelled) setState({ kind: "ready", data, annotations });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: `Couldn't open the PDF. ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target, apiKey, userID]);

  const openInTab = async () => {
    if (!target || state.kind !== "ready") return;
    // With its paper, so highlights, notes and ideas work there too.
    const itemKey = await paperOf(target.attachmentKey);
    useReadingStore.getState().open({
      id: itemKey ? `zotero:${itemKey}` : `zotero-att:${target.attachmentKey}`,
      label: target.label,
      data: state.data,
      annotations: state.annotations,
      zotero: itemKey
        ? { itemKey, attachmentKey: target.attachmentKey }
        : undefined,
      focus: {
        annotationKey: target.annotationKey,
        page: target.page,
        at: Date.now(),
      },
    });
    useZoteroPdf.getState().close();
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => !o && useZoteroPdf.getState().close()}
    >
      <DialogContent className="flex h-[88vh] max-w-[min(92vw,1100px)] flex-col gap-2 p-3 sm:max-w-[min(92vw,1100px)]">
        <div className="flex items-center gap-2 pr-8">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm">
            {target?.label}
            {target?.page ? ` · p. ${target.page}` : ""}
          </DialogTitle>
          <DialogDescription className="sr-only">
            The PDF from Zotero
          </DialogDescription>
          {projectOpen && state.kind === "ready" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => void openInTab()}
            >
              <PanelRightOpenIcon className="size-3.5" />
              Open in a tab
            </Button>
          )}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded border border-border">
          {state.kind === "loading" && (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Opening…
            </div>
          )}
          {state.kind === "error" && (
            <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
              {state.message}
            </div>
          )}
          {state.kind === "ready" && (
            <PdfViewer
              data={state.data}
              scale={scale}
              rootFileId={`zotero-att:${target?.attachmentKey}`}
              annotations={state.annotations}
              onScaleChange={setScale}
              theme={theme}
              onThemeChange={setTheme}
              scrollToPageRef={scrollToPageRef}
              focusAnnotationRef={focusRef}
              onLoadSuccess={() => {
                // Pages appear as they're laid out: keep trying until the
                // highlight's page is there, then bring the highlight into
                // view (its page, if the highlight isn't found).
                const key = target?.annotationKey;
                const page = target?.page;
                let tries = 0;
                const attempt = () => {
                  tries++;
                  if (key && focusRef.current?.(key)) return;
                  if (key && tries < 30) return void setTimeout(attempt, 100);
                  if (page) scrollToPageRef.current?.(page);
                };
                setTimeout(attempt, 60);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
