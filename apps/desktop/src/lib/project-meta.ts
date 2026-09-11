/**
 * Per-project metadata, stored inside the project itself.
 *
 * The type lives in `.latex4all/project.json` rather than in app settings so it
 * travels with the folder: move the project, copy it to another machine, or
 * re-import it after the recents list has forgotten it, and it is still a
 * thesis. `.latex4all/` is already the app's own directory in a project — the
 * generated CLAUDE.md tells Claude not to touch it — so nothing else will
 * disturb the file.
 */

import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("project-meta");

const META_DIR = ".latex4all";
const META_FILE = "project.json";

/**
 * Offered in the type menu. Not a closed set — anything can be typed in — so
 * these are suggestions rather than an enum, and a project's type is stored as
 * the label itself. That keeps a custom type and a suggested one the same kind
 * of thing everywhere downstream.
 */
export const PROJECT_TYPE_SUGGESTIONS = [
  "Article",
  "Book chapter",
  "Thesis",
  "Presentation",
  "Poster",
  "Report",
  "Book",
  "CV",
  "Letter",
] as const;

/** Shown where a project has no type, and sorted last. */
export const UNTYPED_LABEL = "No type";

/** Maps a template's subcategory onto a type, so creating from a template
 *  fills this in rather than asking. Subcategories with no sensible answer
 *  (`blank`) are absent and leave the project untyped. */
const TEMPLATE_SUBCATEGORY_TYPES: Record<string, string> = {
  papers: "Article",
  theses: "Thesis",
  presentations: "Presentation",
  posters: "Poster",
  cv: "CV",
  letters: "Letter",
  reports: "Report",
  books: "Book",
  newsletters: "Report",
};

export function typeForTemplateSubcategory(
  subcategory: string | undefined,
): string | null {
  if (!subcategory) return null;
  return TEMPLATE_SUBCATEGORY_TYPES[subcategory] ?? null;
}

/** Trim and collapse whitespace so "  Book  chapter " and "Book chapter" are
 *  the same type rather than two groups that look identical. */
export function normalizeType(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

interface ProjectMeta {
  type?: string;
}

function metaPath(projectPath: string): string {
  return `${projectPath}/${META_DIR}/${META_FILE}`;
}

/** The project's type, or null when it has none or cannot be read. A missing
 *  file is the normal case for every project that predates this feature, so it
 *  is not logged. */
export async function readProjectType(
  projectPath: string,
): Promise<string | null> {
  try {
    const path = metaPath(projectPath);
    if (!(await exists(path))) return null;
    const meta = JSON.parse(await readTextFile(path)) as ProjectMeta;
    const type = typeof meta.type === "string" ? normalizeType(meta.type) : "";
    return type.length > 0 ? type : null;
  } catch (err) {
    log.warn(`Could not read project type for ${projectPath}: ${String(err)}`);
    return null;
  }
}

/**
 * Write the type, or clear it with `null`.
 *
 * Reads and rewrites the whole file rather than replacing it, so a future key
 * added by something else is not silently dropped by this one.
 */
export async function writeProjectType(
  projectPath: string,
  type: string | null,
): Promise<void> {
  const dir = `${projectPath}/${META_DIR}`;
  const path = metaPath(projectPath);

  let meta: ProjectMeta = {};
  try {
    if (await exists(path)) {
      meta = JSON.parse(await readTextFile(path)) as ProjectMeta;
    }
  } catch {
    // Unreadable or corrupt: start clean rather than refusing to set a type.
  }

  if (type === null) {
    delete meta.type;
  } else {
    meta.type = normalizeType(type);
  }

  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  await writeTextFile(path, `${JSON.stringify(meta, null, 2)}\n`);
}
