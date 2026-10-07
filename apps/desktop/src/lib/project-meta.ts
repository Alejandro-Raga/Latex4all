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
  readDir,
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

/**
 * The type menu: the suggestions, then every other type already in use.
 *
 * A type typed in once should be one click away on the next project, so custom
 * types join the list rather than living only on the project they were made
 * for. Matching is case-insensitive so "Grant proposal" does not come back a
 * second time as "grant proposal".
 */
export function typeMenuOptions(
  typesInUse: Iterable<string | null | undefined>,
): string[] {
  const seen = new Set<string>(
    PROJECT_TYPE_SUGGESTIONS.map((s) => s.toLowerCase()),
  );
  const custom: string[] = [];
  for (const raw of typesInUse) {
    if (!raw) continue;
    const type = normalizeType(raw);
    if (type.length === 0) continue;
    const key = type.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    custom.push(type);
  }
  custom.sort((a, b) => a.localeCompare(b));
  return [...PROJECT_TYPE_SUGGESTIONS, ...custom];
}

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
  /** Stable across renames and moves; names the project's vault note. */
  id?: string;
  /** Other settings kept with the project (see compiled-copy.ts). */
  [key: string]: unknown;
}

/** Everything in the project's metadata ({} when there's none). */
export async function readProjectMeta(
  projectPath: string,
): Promise<ProjectMeta> {
  try {
    const path = metaPath(projectPath);
    if (!(await exists(path))) return {};
    return JSON.parse(await readTextFile(path)) as ProjectMeta;
  } catch {
    return {};
  }
}

/** Sets fields of the project's metadata (undefined removes one). */
export async function updateProjectMeta(
  projectPath: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const meta = await readProjectMeta(projectPath);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete meta[key];
    else meta[key] = value;
  }
  const dir = `${projectPath}/${META_DIR}`;
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  await writeTextFile(
    metaPath(projectPath),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
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
    if (await exists(path)) {
      const meta = JSON.parse(await readTextFile(path)) as ProjectMeta;
      const type =
        typeof meta.type === "string" ? normalizeType(meta.type) : "";
      if (type.length > 0) return type;
    }
    // None chosen: what the document's class says it is.
    return await guessProjectType(projectPath);
  } catch (err) {
    log.warn(`Could not read project type for ${projectPath}: ${String(err)}`);
    return null;
  }
}

/** A project's type from its document class (\documentclass{beamer}…). */
export function typeOfDocumentClass(source: string): string | null {
  const m = source.match(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/);
  if (!m) return null;
  const cls = m[1].trim().toLowerCase();
  if (cls === "beamer") return "Presentation";
  if (/poster|tikzposter|baposter/.test(cls)) return "Poster";
  if (/^(moderncv|altacv|awesome-cv|res|curve|europasscv|resume)/.test(cls)) {
    return "CV";
  }
  if (/^(letter|scrlttr2|newlfm|lettre)/.test(cls)) return "Letter";
  if (/thesis|dissertation/.test(cls)) return "Thesis";
  if (/^(book|scrbook|memoir)$/.test(cls)) return "Book";
  if (/^(report|scrreprt)$/.test(cls)) return "Report";
  if (
    /^(article|scrartcl|elsarticle|revtex|ieeetran|amsart|llncs|acmart|apa|aea|jss|sn-jnl|svjour|mdpi|elife|interact|aastex)/.test(
      cls,
    )
  ) {
    return "Article";
  }
  return null;
}

/** The type the project's main .tex file (its document class) points to. */
async function guessProjectType(projectPath: string): Promise<string | null> {
  const entries = await readDir(projectPath).catch(() => []);
  const tex = entries
    .filter((e) => e.isFile && e.name.toLowerCase().endsWith(".tex"))
    .map((e) => e.name)
    // main.tex first, as LaTeX projects usually name it.
    .sort((a, b) => Number(b === "main.tex") - Number(a === "main.tex"));
  for (const name of tex.slice(0, 5)) {
    const source = await readTextFile(`${projectPath}/${name}`).catch(() => "");
    const type = typeOfDocumentClass(source.slice(0, 4000));
    if (type) return type;
  }
  return null;
}

/**
 * The project's id: made the first time it's asked for and kept in its
 * metadata, so the project is known by it whatever its folder is called.
 */
export async function readProjectId(projectPath: string): Promise<string> {
  const dir = `${projectPath}/${META_DIR}`;
  const path = metaPath(projectPath);
  let meta: ProjectMeta = {};
  try {
    if (await exists(path)) {
      meta = JSON.parse(await readTextFile(path)) as ProjectMeta;
    }
  } catch {
    meta = {};
  }
  if (typeof meta.id === "string" && meta.id) return meta.id;
  meta.id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  await writeTextFile(path, `${JSON.stringify(meta, null, 2)}\n`);
  return meta.id;
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
