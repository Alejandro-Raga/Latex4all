import { useEffect, useRef } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  loadWorkspace,
  type SavedTab,
  savedTab,
  saveWorkspace,
} from "@/lib/workspace-memory";
import { downloadAttachmentFile, fetchAnnotations } from "@/lib/zotero-api";
import { useAnnotationsStore } from "@/stores/annotations-store";
import { useDockStore } from "@/stores/dock-store";
import { useDocumentStore } from "@/stores/document-store";
import { type ReadingPaper, useReadingStore } from "@/stores/reading-store";
import { useZoteroStore } from "@/stores/zotero-store";

const SAVE_DELAY_MS = 500;

/** Loads a saved tab's PDF again, from Zotero or from disk. */
async function reopen(tab: SavedTab): Promise<ReadingPaper | null> {
  if (tab.filePath) {
    const data = await readFile(tab.filePath);
    return {
      id: tab.id,
      label: tab.label,
      data: new Uint8Array(data),
      filePath: tab.filePath,
    };
  }
  if (tab.zotero) {
    const { apiKey, userID } = useZoteroStore.getState();
    if (!apiKey || !userID) return null;
    const [data, annotations] = await Promise.all([
      downloadAttachmentFile(apiKey, userID, tab.zotero.attachmentKey),
      fetchAnnotations(apiKey, userID, tab.zotero.attachmentKey).catch(
        () => [],
      ),
    ]);
    return {
      id: tab.id,
      label: tab.label,
      data,
      annotations,
      zotero: tab.zotero,
    };
  }
  return null;
}

function snapshot(root: string) {
  const dock = useDockStore.getState();
  const reading = useReadingStore.getState();
  saveWorkspace(root, {
    dock: {
      reference: dock.open.reference,
      vault: dock.open.vault,
      notes: useAnnotationsStore.getState().panelOpen,
    },
    collapsed: dock.collapsed,
    wide: dock.wide,
    tabs: reading.papers.map(savedTab).filter((t): t is SavedTab => t !== null),
    active: reading.active,
  });
}

/**
 * Remembers each project's side panels and PDF tabs, and brings them back
 * when the project is opened again. Tabs from one project don't follow you
 * into another.
 */
export function WorkspaceMemory() {
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const restoring = useRef(false);

  useEffect(() => {
    if (!projectRoot) return;
    restoring.current = true;
    useReadingStore.getState().reset();
    useDockStore.setState({ wide: null });
    const saved = loadWorkspace(projectRoot);
    if (!saved) {
      restoring.current = false;
      return;
    }
    useDockStore.setState({
      open: { reference: saved.dock.reference, vault: saved.dock.vault },
      collapsed: saved.collapsed,
    });
    useAnnotationsStore.getState().setPanelOpen(saved.dock.notes);

    let cancelled = false;
    (async () => {
      for (const tab of saved.tabs) {
        const paper = await reopen(tab).catch(() => null);
        if (cancelled) return;
        if (paper) useReadingStore.getState().open(paper);
      }
      if (saved.wide) useDockStore.getState().setWide(saved.wide);
      const reading = useReadingStore.getState();
      const exists =
        saved.active === "preview" ||
        (saved.active === "wide" && saved.wide) ||
        reading.papers.some((p) => p.id === saved.active);
      reading.activate(exists ? saved.active : "preview");
    })().finally(() => {
      if (!cancelled) restoring.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  useEffect(() => {
    if (!projectRoot) return;
    let timer: number | null = null;
    const schedule = () => {
      if (restoring.current) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => snapshot(projectRoot), SAVE_DELAY_MS);
    };
    const unsubscribe = [
      useDockStore.subscribe(schedule),
      useReadingStore.subscribe(schedule),
      useAnnotationsStore.subscribe((s, prev) => {
        if (s.panelOpen !== prev.panelOpen) schedule();
      }),
    ];
    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        if (!restoring.current) snapshot(projectRoot);
      }
      for (const u of unsubscribe) u();
    };
  }, [projectRoot]);

  return null;
}
