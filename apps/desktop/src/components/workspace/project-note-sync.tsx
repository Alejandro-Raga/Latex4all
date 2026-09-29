import { useEffect } from "react";
import { toast } from "sonner";
import { readProjectType } from "@/lib/project-meta";
import {
  mergeProjectNote,
  type ProjectNoteInput,
  projectNotePath,
} from "@/lib/vault/project-note";
import { useAnnotationsStore } from "@/stores/annotations-store";
import { useDocumentStore } from "@/stores/document-store";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";

/** How long after the last change the note is brought up to date. */
const SETTLE_MS = 6000;

const folderName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The same text, ignoring the date line (which alone isn't worth a write). */
const withoutDate = (text: string) =>
  text.replace(/^latex4all_updated: .*$/m, "");

/**
 * Writes the open project's note into the vault (see project-note.ts).
 * Returns the note's name, or null if the project isn't linked or the note's
 * markers were taken out.
 */
export async function syncProjectNote(): Promise<string | null> {
  const { projectRoot, files } = useDocumentStore.getState();
  const vault = useVaultStore.getState();
  if (!projectRoot || !vault.linkedProjects[projectRoot]) return null;
  await vault.ensureVault();
  const { source, index, projectsFolder } = useVaultStore.getState();
  if (!source) return null;

  // Main file (the one with \documentclass) first, then the rest in order.
  const texFiles = files
    .filter((f) => f.type === "tex" && typeof f.content === "string")
    .map((f) => ({ path: f.relativePath, content: f.content as string }))
    .sort(
      (a, b) =>
        Number(/\\documentclass/.test(b.content)) -
          Number(/\\documentclass/.test(a.content)) ||
        a.path.localeCompare(b.path),
    );
  const itemKeyByCitekey = new Map<string, string>();
  for (const info of Object.values(
    useZoteroStore.getState().syncedCollections[projectRoot] ?? {},
  )) {
    for (const [item, key] of Object.entries(info.keyMap)) {
      itemKeyByCitekey.set(key, item);
    }
  }
  const name = folderName(projectRoot);
  const input: ProjectNoteInput = {
    name,
    root: projectRoot,
    type: await readProjectType(projectRoot).catch(() => null),
    texFiles,
    annotations: useAnnotationsStore.getState().source?.listAll() ?? [],
    index,
    itemKeyByCitekey,
  };

  const path = projectNotePath(projectsFolder, name);
  const existing = await source.readNote(path).catch(() => null);
  const merged = mergeProjectNote(existing?.text ?? null, input);
  if (merged === null) return null;
  if (existing && withoutDate(existing.text) === withoutDate(merged)) {
    return name;
  }
  if (existing) await source.writeNote(path, merged, existing.version);
  else await source.createNote(path, merged);
  useVaultStore.getState().noteWritten(path, merged);
  return name;
}

/**
 * Keeps a linked project's vault note current: rewritten a few seconds after
 * the LaTeX, or its highlights and notes, stop changing.
 */
export function ProjectNoteSync() {
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const linked = useVaultStore((s) =>
    projectRoot ? Boolean(s.linkedProjects[projectRoot]) : false,
  );
  const files = useDocumentStore((s) => s.files);
  const notesVersion = useAnnotationsStore((s) => s.version);

  useEffect(() => {
    if (!linked) return;
    const timer = window.setTimeout(() => {
      syncProjectNote().catch((err) =>
        toast.error(
          `Couldn't update the project's vault note: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [linked, projectRoot, files, notesVersion]);

  return null;
}
