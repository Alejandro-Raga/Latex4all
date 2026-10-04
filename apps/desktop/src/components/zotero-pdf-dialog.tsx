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
import { fetchAnnotations } from "@/lib/zotero-api";
import { zoteroPdfBytes } from "@/lib/zotero-pdf-cache";
import { useDocumentStore } from "@/stores/document-store";
import { useReadingStore } from "@/stores/reading-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useZoteroStore } from "@/stores/zotero-store";

interface Target {
  attachmentKey: string;
  /** 1-based, as zotero:// links give it. */
  page: number | null;
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
  return {
    attachmentKey: m[1],
    page: Number.isFinite(page) && page > 0 ? page : null,
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

  const openInTab = () => {
    if (!target || state.kind !== "ready") return;
    useReadingStore.getState().open({
      id: `zotero-att:${target.attachmentKey}`,
      label: target.label,
      data: state.data,
      annotations: state.annotations,
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
              onClick={openInTab}
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
              onLoadSuccess={() => {
                // Once the pages are laid out, to the highlight's page.
                // Pages appear as they're laid out: try again shortly after.
                const page = target?.page;
                if (page) {
                  for (const wait of [80, 400, 1000]) {
                    setTimeout(() => scrollToPageRef.current?.(page), wait);
                  }
                }
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
