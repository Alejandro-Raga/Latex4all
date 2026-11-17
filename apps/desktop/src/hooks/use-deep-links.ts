import { useEffect } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { toast } from "sonner";
import { parseLatex4AllLink } from "@/lib/deep-link";
import { openAtLine } from "@/lib/open-at-line";
import { useDocumentStore } from "@/stores/document-store";
import { useLibraryPreview } from "@/components/zotero-pdf-dialog";
import { useDockStore } from "@/stores/dock-store";
import { inProject, useNav } from "@/stores/nav-store";
import { useProjectStore } from "@/stores/project-store";

/** Opens a latex4all:// link's project, at its file and line. */
export async function followLatex4AllLink(url: string) {
  return follow(url);
}

async function follow(url: string) {
  const link = parseLatex4AllLink(url);
  if (!link) return;
  // A PDF (a highlight in it): read in the Library, the project left as is.
  if (link.file && /\.pdf$/i.test(link.file)) {
    const path = `${link.project.replace(/[\\/]+$/, "")}/${link.file}`;
    if (inProject()) useDockStore.getState().setOpen("reference", true);
    else useNav.getState().goHome("library");
    useLibraryPreview.getState().askFile({
      path,
      label: link.file.replace(/\.pdf$/i, ""),
      focus: {
        annotationKey: link.annotation ?? null,
        page: link.page ?? null,
        at: Date.now(),
      },
    });
    return;
  }
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
