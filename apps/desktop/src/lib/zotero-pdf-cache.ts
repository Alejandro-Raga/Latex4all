/**
 * Zotero PDFs kept on this computer, when the user asks for it (Settings →
 * Zotero): opened once, they open again instantly, and offline. Each file is
 * named after its attachment and its checksum, so a PDF changed in Zotero is
 * fetched again rather than served stale.
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  stat,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { useSettingsStore } from "@/stores/settings-store";
import { downloadAttachmentFile } from "./zotero-api";

async function cacheDir() {
  const dir = await join(await appDataDir(), "zotero", "pdfs");
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return dir;
}

const fileName = (key: string, md5: string | null | undefined) =>
  `${key}-${md5 || "0"}.pdf`;

/** A cached copy of an attachment: this version if `md5` is known, else any. */
async function cached(key: string, md5?: string | null) {
  const dir = await cacheDir();
  if (md5) {
    const path = await join(dir, fileName(key, md5));
    return (await exists(path)) ? path : null;
  }
  const entry = (await readDir(dir)).find((e) => e.name.startsWith(`${key}-`));
  return entry ? join(dir, entry.name) : null;
}

/**
 * The bytes of a Zotero PDF: from the cache when it's on and has this
 * version, otherwise downloaded (and cached, when it's on). Offline, any
 * cached version is better than none.
 */
export async function zoteroPdfBytes(
  apiKey: string,
  userID: string,
  attachment: { key: string; md5?: string | null },
): Promise<Uint8Array> {
  const keep = useSettingsStore.getState().keepZoteroPdfs;
  if (keep) {
    try {
      const path = await cached(attachment.key, attachment.md5);
      if (path) return await readFile(path);
    } catch {
      // Fall through to downloading it.
    }
  }
  let bytes: Uint8Array;
  try {
    bytes = await downloadAttachmentFile(apiKey, userID, attachment.key);
  } catch (err) {
    const stale = keep ? await cached(attachment.key).catch(() => null) : null;
    if (stale) return readFile(stale);
    throw err;
  }
  if (keep) {
    try {
      const dir = await cacheDir();
      for (const e of await readDir(dir)) {
        if (e.name.startsWith(`${attachment.key}-`))
          await remove(await join(dir, e.name));
      }
      await writeFile(
        await join(dir, fileName(attachment.key, attachment.md5)),
        bytes,
      );
    } catch {
      // Not cached this time; it still opens.
    }
  }
  return bytes;
}

/** How many PDFs are kept, and how much space they take. */
export async function pdfCacheSize(): Promise<{
  files: number;
  bytes: number;
}> {
  try {
    const dir = await cacheDir();
    let files = 0;
    let bytes = 0;
    for (const e of await readDir(dir)) {
      if (!e.name.endsWith(".pdf")) continue;
      files++;
      bytes += (await stat(await join(dir, e.name))).size;
    }
    return { files, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

export async function clearPdfCache() {
  const dir = await cacheDir();
  for (const e of await readDir(dir)) {
    if (e.name.endsWith(".pdf")) await remove(await join(dir, e.name));
  }
}
