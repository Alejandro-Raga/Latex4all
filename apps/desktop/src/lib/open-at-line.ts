import { toast } from "sonner";
import { offsetOfLine } from "@/lib/deep-link";
import { useDocumentStore } from "@/stores/document-store";

/** Shows `file` (a project path) in the editor, at the start of 1-based `line`. */
export function openAtLine(file: string, line?: number) {
  const state = useDocumentStore.getState();
  const target = state.files.find((f) => f.relativePath === file);
  if (!target) {
    toast.error(`There's no ${file} in this project.`);
    return;
  }
  if (state.activeFileId !== target.id) state.setActiveFile(target.id);
  const offset = line ? offsetOfLine(target.content ?? "", line) : 0;
  // Give the editor a moment to show the file before moving into it.
  setTimeout(
    () => useDocumentStore.getState().requestJumpToPosition(offset),
    150,
  );
}
