import { useEffect, useRef, useState, useCallback, memo } from "react";
import { getMupdfClient } from "@/lib/mupdf/mupdf-client";
import { createLogger } from "@/lib/debug/logger";
import { APP_VISIBILITY_RESTORED } from "@/lib/debug/log-store";
import type { StructuredTextData, LinkData } from "@/lib/mupdf/types";
import type { PdfAnnotationRect } from "./pdf-viewer";

const log = createLogger("mupdf-page");
const RENDER_SCALE_DEBOUNCE_MS = 260;

interface MupdfPageProps {
  docId: number;
  pageIndex: number;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  isVisible: boolean;
  annotations?: PdfAnnotationRect[];
}

/** Check if a canvas appears blank (GPU context was silently invalidated).
 *  Uses a single getImageData call covering a small center region. */
function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return true; // context fully lost
  // Sample a 2x2 region from the center in one GPU readback
  const cx = Math.max(0, Math.floor(canvas.width / 2) - 1);
  const cy = Math.max(0, Math.floor(canvas.height / 2) - 1);
  const data = ctx.getImageData(cx, cy, 2, 2).data;
  // If all sampled pixels have zero alpha, canvas is blank
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

export const MupdfPage = memo(function MupdfPage({
  docId,
  pageIndex,
  scale,
  pageWidth,
  pageHeight,
  isVisible,
  annotations,
}: MupdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [textData, setTextData] = useState<StructuredTextData | null>(null);
  const [links, setLinks] = useState<LinkData[]>([]);
  const [renderScale, setRenderScale] = useState(scale);
  const renderGenRef = useRef(0);

  const cssW = pageWidth * scale;
  const cssH = pageHeight * scale;

  useEffect(() => {
    setRenderScale(scale);
  }, [docId, pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isVisible || docId <= 0) return;
    const timeout = window.setTimeout(
      () => setRenderScale(scale),
      RENDER_SCALE_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [docId, isVisible, scale]);

  /** Re-render the page onto the canvas via MuPDF worker. */
  const renderPage = useCallback(() => {
    if (!isVisible || docId <= 0) return;

    const gen = ++renderGenRef.current;
    const client = getMupdfClient();
    const dpr = window.devicePixelRatio || 1;
    const dpi = renderScale * 72 * dpr;

    client
      .drawPage(docId, pageIndex, dpi)
      .then(async (imageData) => {
        if (gen !== renderGenRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const bitmap = await createImageBitmap(imageData);
        if (gen !== renderGenRef.current) {
          bitmap.close();
          return;
        }
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      })
      .catch((err) => {
        if (gen !== renderGenRef.current) return;
        log.error(`Render error page ${pageIndex}`, { error: String(err) });
      });
  }, [docId, pageIndex, renderScale, isVisible]);

  // Render the canvas immediately on load, then at debounced high-quality zoom.
  useEffect(() => {
    if (!isVisible || docId <= 0) return;
    renderPage();
  }, [docId, pageIndex, renderScale, isVisible, renderPage]);

  // Text and link layers do not need to be refetched for every zoom change.
  useEffect(() => {
    if (!isVisible || docId <= 0) return;
    let cancelled = false;

    const client = getMupdfClient();

    client
      .getPageText(docId, pageIndex)
      .then((data) => {
        if (cancelled) return;
        setTextData(data);
      })
      .catch(() => {});

    client
      .getPageLinks(docId, pageIndex)
      .then((data) => {
        if (cancelled) return;
        setLinks(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [docId, pageIndex, isVisible]);

  // Re-render canvas when returning from background if content was lost
  useEffect(() => {
    const handleVisibilityRestored = () => {
      const canvas = canvasRef.current;
      if (!canvas || !isVisible || docId <= 0) return;
      if (isCanvasBlank(canvas)) {
        log.warn(
          `Canvas blank after visibility restore, re-rendering page ${pageIndex}`,
        );
        renderPage();
      }
    };

    window.addEventListener(APP_VISIBILITY_RESTORED, handleVisibilityRestored);
    return () =>
      window.removeEventListener(
        APP_VISIBILITY_RESTORED,
        handleVisibilityRestored,
      );
  }, [docId, pageIndex, scale, isVisible, renderPage]);

  return (
    <div
      className="mupdf-page relative mb-4 shadow-lg"
      data-page-number={pageIndex + 1}
      style={{ width: cssW, height: cssH }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: cssW, height: cssH, display: "block" }}
      />

      {/* Text layer for selection */}
      {textData && (
        <svg
          className="mupdf-text-layer"
          viewBox={`0 0 ${pageWidth} ${pageHeight}`}
          preserveAspectRatio="none"
          style={{ width: cssW, height: cssH }}
        >
          {textData.blocks.map(
            (block, bi) =>
              block.type === "text" &&
              block.lines.map((line, li) => (
                <text
                  key={`${bi}-${li}`}
                  x={line.bbox.x}
                  y={line.y}
                  fontSize={line.font.size}
                  fontFamily={line.font.family || line.font.name || "serif"}
                  textLength={line.bbox.w > 0 ? line.bbox.w : undefined}
                  lengthAdjust="spacingAndGlyphs"
                >
                  {line.text}
                </text>
              )),
          )}
        </svg>
      )}

      {/* Link layer */}
      {links.length > 0 && (
        <div className="mupdf-link-layer">
          {links.map((link, i) => (
            <a
              key={i}
              href={link.href}
              data-external={link.isExternal ? "true" : undefined}
              style={{
                left: `${(link.x / pageWidth) * 100}%`,
                top: `${(link.y / pageHeight) * 100}%`,
                width: `${(link.w / pageWidth) * 100}%`,
                height: `${(link.h / pageHeight) * 100}%`,
              }}
            >
              <span className="sr-only">Link</span>
            </a>
          ))}
        </div>
      )}

      {/* Annotation layer — imported highlights/underlines (e.g. from Zotero).
          Rects arrive in raw PDF space (origin bottom-left, y up); flip to the
          top-left/y-down convention the other layers already use. Coordinates
          are normalized (min/max) rather than assumed pre-ordered, since a
          reversed pair would otherwise produce a negative — and so invisible
          — width/height. */}
      {annotations && annotations.length > 0 && (
        <div className="mupdf-annotation-layer">
          {(() => {
            log.info(
              `Annotation layer: page ${pageIndex}, pageSize ${pageWidth.toFixed(1)}x${pageHeight.toFixed(1)}, ${annotations.length} marks (${annotations.map((a) => a.type).join(",")})`,
            );
            return null;
          })()}
          {annotations.map((ann, ai) =>
            ann.rects.map((rect, ri) => {
              const x1 = Math.min(rect[0], rect[2]);
              const x2 = Math.max(rect[0], rect[2]);
              const y1 = Math.min(rect[1], rect[3]);
              const y2 = Math.max(rect[1], rect[3]);
              const left = (x1 / pageWidth) * 100;
              const top = ((pageHeight - y2) / pageHeight) * 100;
              const width = ((x2 - x1) / pageWidth) * 100;
              const fullHeight = ((y2 - y1) / pageHeight) * 100;
              const isUnderline = ann.type === "underline";
              const style = {
                left: `${left}%`,
                top: isUnderline ? `${top + fullHeight * 0.92}%` : `${top}%`,
                width: `${width}%`,
                height: isUnderline
                  ? `${Math.max(fullHeight * 0.08, 0.3)}%`
                  : `${fullHeight}%`,
                backgroundColor: ann.color,
              };
              if (ai === 0 && ri === 0) {
                log.info(
                  `Mark geometry: page ${pageIndex}, rawRect [${rect.join(", ")}], color ${ann.color}, style left=${style.left} top=${style.top} width=${style.width} height=${style.height}`,
                );
              }
              return (
                <div
                  key={`${ai}-${ri}`}
                  className={
                    isUnderline
                      ? "mupdf-annotation-underline"
                      : "mupdf-annotation-highlight"
                  }
                  style={style}
                />
              );
            }),
          )}
        </div>
      )}
    </div>
  );
});
