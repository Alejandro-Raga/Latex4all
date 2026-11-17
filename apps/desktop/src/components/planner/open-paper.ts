/**
 * Opening a paper from a reading list, to read: in the Zotero library's
 * reader, beside the writing when a project is open, else on the Library
 * & Vault page.
 */
import { toast } from "sonner";
import { useLibraryPreview } from "@/components/zotero-pdf-dialog";
import { useDockStore } from "@/stores/dock-store";
import { inProject } from "@/stores/nav-store";

export function openToRead(itemKey: string | undefined, label: string) {
  if (!itemKey) {
    toast.info("This one isn't in your Zotero library.");
    return;
  }
  useLibraryPreview.getState().ask({ itemKey, label });
  // The library shows it once it's there to: the dock's panel in a project;
  // without one, the start page turns to Library & Vault (it listens).
  if (inProject()) {
    useDockStore.getState().setOpen("reference", true);
  }
}
