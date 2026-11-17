/**
 * Highlights and comments on a PDF that isn't in Zotero (a draft in one of
 * your projects, rebuilt often): kept on this computer, one small file per
 * PDF in the app's folder, by the PDF's path. Each keeps the text it
 * covered, so a highlight on a draft that changed still says what it was.
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { PdfAnnotationRect } from "@/components/workspace/preview/pdf-viewer";
import { md5 } from "./md5";

async function fileFor(pdfPath: string): Promise<string> {
  const dir = await join(await appDataDir(), "pdf-notes");
  await mkdir(dir, { recursive: true }).catch(() => {});
  return join(dir, `${md5(new TextEncoder().encode(pdfPath))}.json`);
}

export interface PdfNotes {
  notes: PdfAnnotationRect[];
  /** Which build of the PDF they were placed on (its md5), if known. */
  version?: string;
}

export async function loadPdfNotes(pdfPath: string): Promise<PdfNotes> {
  try {
    const data = JSON.parse(await readTextFile(await fileFor(pdfPath)));
    return {
      notes: Array.isArray(data?.notes) ? data.notes : [],
      ...(typeof data?.version === "string" ? { version: data.version } : {}),
    };
  } catch {
    return { notes: [] };
  }
}

/** A PDF's version, to tell a rebuilt one from the same one. */
export const pdfVersion = (data: Uint8Array) => md5(data);

export async function savePdfNotes(
  pdfPath: string,
  notes: PdfAnnotationRect[],
  version?: string,
): Promise<void> {
  await writeTextFile(
    await fileFor(pdfPath),
    JSON.stringify({ path: pdfPath, version, notes }, null, 1),
  );
}

/** A new highlight's key: apart from Zotero's (eight letters and digits). */
export const localKey = () =>
  `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
