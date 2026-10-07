import {
  readTextFile,
  writeTextFile,
  readDir,
  exists,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  remove,
  rename,
  stat,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("fs");

export type ProjectFileType =
  | "tex"
  | "image"
  | "pdf"
  | "bib"
  | "style"
  | "other";

export interface FsProjectFile {
  relativePath: string;
  absolutePath: string;
  type: ProjectFileType;
  fileSize: number;
}

/** Files larger than this (1 MB) are not auto-loaded into memory during project open. */
export const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".bmp",
  ".webp",
]);

const STYLE_EXTENSIONS = new Set([
  ".sty",
  ".cls",
  ".bst",
  ".def",
  ".cfg",
  ".fd",
  ".dtx",
  ".ins",
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "__pycache__",
  "venv",
  "env",
]);

const IGNORED_EXTENSIONS = new Set([
  // Ignore LaTeX build artifacts, but keep user-imported reference files visible.
  ".aux",
  ".log",
  ".out",
  ".toc",
  ".lof",
  ".lot",
  ".fls",
  ".fdb_latexmk",
  ".synctex.gz",
  ".synctex",
  ".blg",
  ".bbl",
  ".nav",
  ".snm",
  ".vrb",
  ".run.xml",
  ".bcf",
  // Compiled build artifacts (never user reference material)
  ".pyc",
  ".pyo",
  ".pyd",
  ".o",
  ".obj",
  ".so",
  ".dylib",
  ".dll",
]);

export function shouldSkipProjectDirectory(name: string): boolean {
  return (
    name.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(name.toLowerCase())
  );
}

export function getProjectFileType(name: string): ProjectFileType | null {
  const lower = name.toLowerCase();
  // Skip ignored file extensions (build artifacts, binary/non-text files)
  for (const ext of IGNORED_EXTENSIONS) {
    if (lower.endsWith(ext)) return null;
  }
  if (lower.endsWith(".tex") || lower.endsWith(".ltx")) return "tex";
  if (lower.endsWith(".bib")) return "bib";
  if (lower.endsWith(".pdf")) return "pdf";
  for (const ext of IMAGE_EXTENSIONS) {
    if (lower.endsWith(ext)) return "image";
  }
  for (const ext of STYLE_EXTENSIONS) {
    if (lower.endsWith(ext)) return "style";
  }
  // Show all other files (txt, md, sty downloaded packages, etc.)
  return "other";
}

export interface ScanResult {
  files: FsProjectFile[];
  folders: string[]; // relative paths of all directories
}

export async function scanProjectFolder(rootPath: string): Promise<ScanResult> {
  const files: FsProjectFile[] = [];
  const folders: string[] = [];

  async function walk(dir: string, prefix: string) {
    const entries = await readDir(dir);
    for (const entry of entries) {
      const entryPath = await join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory) {
        // Skip hidden directories and common non-project dirs
        if (shouldSkipProjectDirectory(entry.name)) {
          continue;
        }
        folders.push(relativePath);
        await walk(entryPath, relativePath);
      } else {
        const type = getProjectFileType(entry.name);
        if (type) {
          // Sized: images and others for the large-file threshold, PDFs so
          // a shared project can tell a changed one from the same one (with
          // no size every PDF looked changed, and was sent again and again).
          // tex/bib/style are loaded, and measured by their content.
          let fileSize = 0;
          if (type === "image" || type === "other" || type === "pdf") {
            try {
              const info = await stat(entryPath);
              fileSize = info.size;
            } catch {
              /* stat failed — treat as 0 */
            }
          }
          files.push({
            relativePath,
            absolutePath: entryPath,
            type,
            fileSize,
          });
        }
      }
    }
  }

  await walk(rootPath, "");
  log.info(`Scanned project: ${files.length} files, ${folders.length} folders`);
  return { files, folders };
}

export async function readTexFileContent(
  absolutePath: string,
): Promise<string> {
  return readTextFile(absolutePath);
}

/**
 * Whether an error is a file that another program has open, as Windows
 * reports it (Seafile syncing it, an antivirus scanning it, an editor).
 */
export function isLockedFileError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /os error (5|32|33)\b|being used by another process|access is denied|locked a portion/i.test(
    message,
  );
}

/**
 * Runs a file operation, trying again for a few seconds while the file is
 * locked by another program: such locks are usually brief.
 */
export async function whileLocked<T>(
  operation: () => Promise<T>,
  waits = [150, 300, 600, 1000, 1500],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (!isLockedFileError(err) || attempt >= waits.length) throw err;
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

export async function writeTexFileContent(
  absolutePath: string,
  content: string,
): Promise<void> {
  return whileLocked(() => writeTextFile(absolutePath, content));
}

export async function readImageAsDataUrl(
  absolutePath: string,
): Promise<string> {
  const data = await readFile(absolutePath);
  const ext = absolutePath.split(".").pop()?.toLowerCase() || "png";
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    webp: "image/webp",
  };
  const mime = mimeMap[ext] || "image/png";

  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
}

export function getAssetUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath);
}

export async function createFileOnDisk(
  rootPath: string,
  name: string,
  content: string,
): Promise<string> {
  const fullPath = await join(rootPath, name);
  // Ensure parent directory exists
  const lastSep = Math.max(
    fullPath.lastIndexOf("/"),
    fullPath.lastIndexOf("\\"),
  );
  const parentDir = lastSep > 0 ? fullPath.substring(0, lastSep) : "";
  if (parentDir && !(await exists(parentDir))) {
    await mkdir(parentDir, { recursive: true });
  }
  await writeTextFile(fullPath, content);
  return fullPath;
}

/**
 * Generate a unique filename by appending (1), (2), etc. if the target already exists.
 * Returns the deduplicated relative path (e.g., "attachments/paper (1).pdf").
 */
export async function getUniqueTargetName(
  rootPath: string,
  targetName: string,
): Promise<string> {
  const fullPath = await join(rootPath, targetName);
  if (!(await exists(fullPath))) return targetName;

  // Split into base and extension: "attachments/paper.pdf" → ["attachments/paper", ".pdf"]
  const dotIndex = targetName.lastIndexOf(".");
  const slashIndex = targetName.lastIndexOf("/");
  const hasExt = dotIndex > slashIndex + 1;
  const baseName = hasExt ? targetName.slice(0, dotIndex) : targetName;
  const ext = hasExt ? targetName.slice(dotIndex) : "";

  for (let i = 1; i < 100; i++) {
    const candidate = `${baseName} (${i})${ext}`;
    const candidatePath = await join(rootPath, candidate);
    if (!(await exists(candidatePath))) return candidate;
  }
  // Fallback — should never reach here
  return `${baseName} (${Date.now()})${ext}`;
}

/**
 * The name under which these bytes are already in the project (the target
 * name or a numbered one), so adding the same paper again reuses it rather
 * than making "paper (2).pdf".
 */
async function sameFileIn(
  rootPath: string,
  targetName: string,
  data: Uint8Array,
): Promise<string | null> {
  const dotIndex = targetName.lastIndexOf(".");
  const slashIndex = targetName.lastIndexOf("/");
  const hasExt = dotIndex > slashIndex + 1;
  const baseName = hasExt ? targetName.slice(0, dotIndex) : targetName;
  const ext = hasExt ? targetName.slice(dotIndex) : "";
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? targetName : `${baseName} (${i})${ext}`;
    const path = await join(rootPath, candidate);
    if (!(await exists(path))) {
      if (i > 1) return null;
      continue;
    }
    const existing = await readFile(path).catch(() => null);
    if (
      existing &&
      existing.length === data.length &&
      existing.every((b, k) => b === data[k])
    ) {
      return candidate;
    }
  }
  return null;
}

export async function copyFileToProject(
  rootPath: string,
  sourcePath: string,
  targetName: string,
): Promise<string> {
  const source = await readFile(sourcePath).catch(() => null);
  const already = source && (await sameFileIn(rootPath, targetName, source));
  if (already) return already;
  // Auto-deduplicate filename
  const uniqueName = await getUniqueTargetName(rootPath, targetName);
  const fullPath = await join(rootPath, uniqueName);
  // Ensure parent directory exists (e.g., attachments/)
  const lastSlash = Math.max(
    fullPath.lastIndexOf("/"),
    fullPath.lastIndexOf("\\"),
  );
  if (lastSlash > 0) {
    const parentDir = fullPath.substring(0, lastSlash);
    if (!(await exists(parentDir))) {
      await mkdir(parentDir, { recursive: true });
    }
  }
  await copyFile(sourcePath, fullPath);
  return uniqueName;
}

/** Same as `copyFileToProject`, for bytes that are already in memory. */
export async function writeBytesToProject(
  rootPath: string,
  targetName: string,
  data: Uint8Array,
): Promise<string> {
  const already = await sameFileIn(rootPath, targetName, data);
  if (already) return already;
  const uniqueName = await getUniqueTargetName(rootPath, targetName);
  const fullPath = await join(rootPath, uniqueName);
  const lastSlash = Math.max(
    fullPath.lastIndexOf("/"),
    fullPath.lastIndexOf("\\"),
  );
  if (lastSlash > 0) {
    const parentDir = fullPath.substring(0, lastSlash);
    if (!(await exists(parentDir))) {
      await mkdir(parentDir, { recursive: true });
    }
  }
  await writeFile(fullPath, data);
  return uniqueName;
}

export async function deleteFileFromDisk(absolutePath: string): Promise<void> {
  log.debug(`Deleting file: ${absolutePath}`);
  await whileLocked(() => remove(absolutePath));
}

export async function deleteFolderFromDisk(
  absolutePath: string,
): Promise<void> {
  log.debug(`Deleting folder: ${absolutePath}`);
  await remove(absolutePath, { recursive: true });
}

export async function renameFileOnDisk(
  oldPath: string,
  newPath: string,
): Promise<void> {
  log.debug(`Renaming: ${oldPath} → ${newPath}`);
  await whileLocked(() => rename(oldPath, newPath));
}

export async function createDirectory(absolutePath: string): Promise<void> {
  await mkdir(absolutePath, { recursive: true });
}

export { exists, join };
