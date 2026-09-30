import { useEffect } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { toast } from "sonner";
import { parseLatex4AllLink } from "@/lib/deep-link";
import { openAtLine } from "@/lib/open-at-line";
import { useDocumentStore } from "@/stores/document-store";
import { useProjectStore } from "@/stores/project-store";

async function follow(url: string) {
  const link = parseLatex4AllLink(url);
  if (!link) return;
  const docs = useDocumentStore.getState();
  if (docs.projectRoot !== link.project) {
    try {
      await docs.openProject(link.project);
      useProjectStore.getState().addRecentProject(link.project);
    } catch {
      toast.error(`Couldn't open ${link.project}`);
      return;
    }
  }
  if (link.file) openAtLine(link.file, link.line);
}

/** Opens latex4all:// links: the one the app was started with, and later ones. */
export function useDeepLinks() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrent()
      .then((urls) => urls?.forEach((u) => void follow(u)))
      .catch(() => {});
    onOpenUrl((urls) => urls.forEach((u) => void follow(u)))
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);
}
