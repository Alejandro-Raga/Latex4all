/**
 * Where a note goes when it's given a kind: the folder that kind keeps its
 * notes in. Papers and projects use their own settings; topics and ideas a
 * folder picked in Settings, or the one holding most of them now; your own
 * types, the folder you gave them; plain notes, a folder if one was picked.
 */
import {
  chosenKindFolders,
  useVaultStore,
  vaultStyle,
} from "@/stores/vault-store";
import { papersFolderOf } from "./add-paper";
import type { NoteKind, VaultIndex } from "./vault-index";

const DEFAULTS: Record<string, string> = { topic: "Topics", idea: "Ideas" };

/** The folder holding most notes of a kind, if any do. */
function mostOf(index: VaultIndex | null, kind: NoteKind): string | null {
  const counts = new Map<string, number>();
  for (const n of index?.list ?? []) {
    if (n.kind !== kind) continue;
    const dir = n.path.split("/").slice(0, -1).join("/");
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best: string | null = null;
  let most = 0;
  for (const [dir, count] of counts) {
    if (count > most) {
      best = dir;
      most = count;
    }
  }
  return best;
}

export function kindFolder(kind: NoteKind | null): string | null {
  if (!kind) return null;
  // Plain notes stay put unless a folder was picked for them.
  if (kind === "note") return chosenKindFolders().note || null;
  const { index, papersFolder, projectsFolder } = useVaultStore.getState();
  const custom = vaultStyle().types.find((t) => t.id === kind);
  if (custom) return custom.folder?.trim().replace(/^\/+|\/+$/g, "") || null;
  if (kind === "paper") return papersFolderOf(index, papersFolder);
  if (kind === "project") return projectsFolder || null;
  return (
    chosenKindFolders()[kind] ?? mostOf(index, kind) ?? DEFAULTS[kind] ?? null
  );
}

/** What a kind's folder would be if none were picked, for placeholders. */
export function detectedKindFolder(kind: NoteKind): string {
  const { index } = useVaultStore.getState();
  if (kind === "paper") return papersFolderOf(index, "");
  if (kind === "note") return "";
  return mostOf(index, kind) ?? DEFAULTS[kind] ?? "";
}
