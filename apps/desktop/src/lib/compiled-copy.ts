/**
 * A copy of the compiled PDF under a name and in a folder of your choosing
 * ("Raga - Proposal.pdf" in Deliverables), written after every compile. Kept
 * in the project's .latex4all/project.json, so it stays with the project.
 */
import { exists, mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { readProjectMeta, updateProjectMeta } from "@/lib/project-meta";

export interface CompiledCopy {
  /** The main .tex file it's the PDF of, relative to the project. */
  source: string;
  /** Where it goes: relative to the project when inside it, else absolute. */
  path: string;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** `path` as kept: relative to the project when it's inside it. */
export function keptPath(projectRoot: string, path: string): string {
  const root = `${norm(projectRoot)}/`;
  const p = norm(path);
  return p.toLowerCase().startsWith(root.toLowerCase())
    ? p.slice(root.length)
    : p;
}

/** The full path of a kept one. */
export function fullPath(projectRoot: string, path: string): string {
  return /^([a-z]:)?\//i.test(norm(path))
    ? norm(path)
    : `${norm(projectRoot)}/${norm(path)}`;
}

const cache = new Map<string, CompiledCopy | null>();

export async function readCompiledCopy(
  projectRoot: string,
): Promise<CompiledCopy | null> {
  if (cache.has(projectRoot)) return cache.get(projectRoot) ?? null;
  const meta = await readProjectMeta(projectRoot);
  const raw = meta.compiledCopy as Partial<CompiledCopy> | undefined;
  const copy =
    raw && typeof raw.source === "string" && typeof raw.path === "string"
      ? { source: raw.source, path: raw.path }
      : null;
  cache.set(projectRoot, copy);
  return copy;
}

export async function setCompiledCopy(
  projectRoot: string,
  copy: CompiledCopy | null,
) {
  await updateProjectMeta(projectRoot, { compiledCopy: copy ?? undefined });
  cache.set(projectRoot, copy);
}

/** Writes the copy after a compile of `source`, if the project keeps one. */
export async function saveCompiledCopy(
  projectRoot: string,
  source: string,
  pdf: Uint8Array,
) {
  const copy = await readCompiledCopy(projectRoot).catch(() => null);
  if (!copy || norm(copy.source) !== norm(source)) return;
  const path = fullPath(projectRoot, copy.path);
  const folder = path.slice(0, path.lastIndexOf("/"));
  try {
    // A folder inside the project is made; one elsewhere that isn't there
    // (another computer's) is left alone.
    if (!(await exists(folder))) {
      const inside = !/^([a-z]:)?\//i.test(norm(copy.path));
      if (!inside) return;
      await mkdir(folder, { recursive: true });
    }
    await writeFile(path, pdf);
  } catch (err) {
    toast.error(`Couldn't save the PDF as ${path.split("/").pop()}`, {
      description: err instanceof Error ? err.message : String(err),
    });
  }
}
