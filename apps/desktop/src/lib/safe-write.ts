/**
 * Writes a file whole or not at all: the text goes to a file beside it,
 * which then takes its place. A crash or a full disk midway leaves the old
 * version, never a file cut short. For the app's own files (lists,
 * highlights, where you left off).
 */
import { remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";

export async function writeTextSafely(path: string, text: string) {
  const temporary = `${path}.saving`;
  try {
    await writeTextFile(temporary, text);
    await rename(temporary, path);
  } catch (err) {
    await remove(temporary).catch(() => {});
    throw err;
  }
}
