/**
 * Project card previews, kept as images: made once from a project's PDF and
 * reused until the PDF changes, so the home screen never compiles anything
 * and a project that doesn't build here still shows its pages. Each image is
 * kept in the app's data folder, and, for a project in the library, shared
 * with the linked devices (see `previewsMap` in the library).
 */

import { appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readFile,
  readTextFile,
  stat,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { writeTextSafely } from "@/lib/safe-write";

export interface StoredPreview {
  /** The PDF it was made from (size and time of change, where it was made). */
  fp: string;
  /** When it was made, and on which device. */
  at: number;
  by: string;
  aspectRatio: number;
  pages: number;
  /** The images' type, image/jpeg or image/png. */
  type: string;
  img: Uint8Array;
  /** A deck's second slide. */
  next?: Uint8Array;
  /** Kept here only: this device's PDF when it was kept, so a preview from
   * another device isn't replaced by one of an older PDF here. */
  seen?: string;
}

type StoredMeta = Omit<StoredPreview, "img" | "next"> & { hasNext: boolean };

function keyOf(projectPath: string) {
  const text = projectPath.normalize("NFC");
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

async function folder() {
  return join(await appDataDir(), "previews");
}

/** What a PDF is now, to tell whether a kept preview still matches it. */
export async function pdfFingerprint(pdfPath: string): Promise<string> {
  const info = (await stat(pdfPath)) as { size?: number; mtime?: unknown };
  const mtime =
    info.mtime instanceof Date
      ? info.mtime.getTime()
      : typeof info.mtime === "number"
        ? info.mtime
        : String(info.mtime ?? "");
  return `${info.size ?? "?"}:${mtime}`;
}

/** The preview kept on this device for a project, if any. */
export async function readKeptPreview(
  projectPath: string,
): Promise<StoredPreview | null> {
  try {
    const dir = await folder();
    const key = keyOf(projectPath);
    const metaPath = await join(dir, `${key}.json`);
    if (!(await exists(metaPath))) return null;
    const meta = JSON.parse(await readTextFile(metaPath)) as StoredMeta;
    const img = await readFile(await join(dir, `${key}.img`));
    const next = meta.hasNext
      ? await readFile(await join(dir, `${key}.next.img`)).catch(
          () => undefined,
        )
      : undefined;
    const { hasNext: _, ...rest } = meta;
    return { ...rest, img, next };
  } catch {
    return null;
  }
}

/** Keeps a project's preview on this device. */
export async function keepPreview(
  projectPath: string,
  preview: StoredPreview,
): Promise<void> {
  const dir = await folder();
  await mkdir(dir, { recursive: true }).catch(() => {});
  const key = keyOf(projectPath);
  await writeFile(await join(dir, `${key}.img`), preview.img);
  if (preview.next) {
    await writeFile(await join(dir, `${key}.next.img`), preview.next);
  }
  const { img: _i, next: _n, ...meta } = preview;
  // The description last: a preview is read only once it's whole.
  await writeTextSafely(
    await join(dir, `${key}.json`),
    JSON.stringify({ ...meta, hasNext: Boolean(preview.next) }),
  );
}

/**
 * A rendered page made small for keeping and sending (a JPEG of a few tens
 * of KB rather than a PNG several times that). The PNG if that fails.
 */
export async function compactImage(
  png: Uint8Array,
): Promise<{ bytes: Uint8Array; type: string }> {
  try {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(png)], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    // White under the page, as JPEG has no transparency.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.8,
    });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      type: "image/jpeg",
    };
  } catch {
    return { bytes: png, type: "image/png" };
  }
}

/** A preview's images as URLs for the card. */
export function previewUrls(preview: StoredPreview) {
  const url = (bytes: Uint8Array) =>
    URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: preview.type }),
    );
  return {
    url: url(preview.img),
    nextUrl: preview.next ? url(preview.next) : undefined,
  };
}
