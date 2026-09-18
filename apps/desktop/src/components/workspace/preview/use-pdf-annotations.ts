import { useEffect, useState } from "react";
import {
  type PageChar,
  type PdfMark,
  type SourceBox,
  lineAt,
  placeHighlight,
} from "@/lib/annotations/pdf-placement";
import { synctexView } from "@/lib/latex-compiler";
import { getMupdfClient } from "@/lib/mupdf/mupdf-client";
import { useAnnotationsStore } from "@/stores/annotations-store";
import { useDocumentStore } from "@/stores/document-store";
import { useSettingsStore } from "@/stores/settings-store";

const RECOMPUTE_DELAY_MS = 400;

/**
 * SyncTeX lookups and page characters only change when the PDF does, so they
 * are kept per opened document: typing moves highlights in the source, but
 * placing them again then costs no more trips to Rust or the worker.
 */
let cacheDocId = 0;
const boxesByLine = new Map<string, SourceBox[]>();
const charsByPage = new Map<number, PageChar[]>();

function resetCacheFor(docId: number) {
  if (docId !== cacheDocId) {
    cacheDocId = docId;
    boxesByLine.clear();
    charsByPage.clear();
  }
}

/** The project's highlights and notes, placed on the PDF open as `docId`. */
export function usePdfMarks({
  docId,
  projectRoot,
  enabled,
}: {
  docId: number;
  projectRoot: string | null;
  enabled: boolean;
}): PdfMark[] {
  const source = useAnnotationsStore((s) => s.source);
  const version = useAnnotationsStore((s) => s.version);
  const show = useSettingsStore((s) => s.showAnnotations);
  const [marks, setMarks] = useState<PdfMark[]>([]);

  useEffect(() => {
    if (!enabled || !show || !source || !projectRoot || docId <= 0) {
      setMarks([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      resetCacheFor(docId);
      const files = useDocumentStore.getState().files;
      const client = getMupdfClient();
      const byPath = new Map<string, ReturnType<typeof source.listAll>>();
      for (const item of source.listAll()) {
        // Suggested edits are about the source text; the notes bar has them.
        if (item.annotation.suggestion) continue;
        const list = byPath.get(item.path) ?? [];
        list.push(item);
        byPath.set(item.path, list);
      }

      const next: PdfMark[] = [];
      for (const [path, items] of byPath) {
        const content = files.find((f) => f.relativePath === path)?.content;
        if (content === undefined) continue;
        const spans = items.map(({ annotation }) => ({
          annotation,
          first: lineAt(content, annotation.from),
          last: lineAt(content, Math.max(annotation.from, annotation.to - 1)),
        }));

        const missing = new Set<number>();
        for (const span of spans) {
          for (let line = span.first; line <= span.last; line++) {
            if (!boxesByLine.has(`${path}:${line}`)) missing.add(line);
          }
        }
        if (missing.size > 0) {
          const boxes = await synctexView(projectRoot, path, [...missing]);
          if (cancelled) return;
          for (const line of missing) boxesByLine.set(`${path}:${line}`, []);
          for (const box of boxes)
            boxesByLine.get(`${path}:${box.line}`)?.push(box);
        }

        for (const { annotation, first, last } of spans) {
          const boxes: SourceBox[] = [];
          for (let line = first; line <= last; line++) {
            boxes.push(...(boxesByLine.get(`${path}:${line}`) ?? []));
          }
          if (boxes.length === 0) continue;
          for (const pageIndex of new Set(boxes.map((b) => b.page - 1))) {
            if (charsByPage.has(pageIndex)) continue;
            const chars = await client
              .getPageChars(docId, pageIndex)
              .catch(() => [] as PageChar[]);
            if (cancelled) return;
            charsByPage.set(pageIndex, chars);
          }
          const snippet = content.slice(annotation.from, annotation.to);
          for (const { pageIndex, rects } of placeHighlight(
            snippet,
            boxes,
            charsByPage,
          )) {
            next.push({
              id: annotation.id,
              pageIndex,
              rects,
              color: annotation.color,
              resolved: annotation.resolved,
              comments: annotation.comments,
            });
          }
        }
      }
      if (!cancelled) setMarks(next);
    }, RECOMPUTE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, show, source, version, projectRoot, docId]);

  return marks;
}

/** The mark under a point on a page, if any (the note glyph counts too). */
export function markAt(
  marks: PdfMark[],
  pageIndex: number,
  x: number,
  y: number,
): PdfMark | null {
  let best: PdfMark | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const mark of marks) {
    if (mark.pageIndex !== pageIndex) continue;
    const last = mark.rects[mark.rects.length - 1];
    const areas = [...mark.rects];
    if (mark.comments.length > 0 && last) {
      areas.push({ x: last.x + last.w, y: last.y - 4, w: 12, h: 12 });
    }
    for (const r of areas) {
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      const area = r.w * r.h;
      if (area < bestArea) {
        best = mark;
        bestArea = area;
      }
    }
  }
  return best;
}
