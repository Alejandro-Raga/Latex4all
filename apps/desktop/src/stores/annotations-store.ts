import { create } from "zustand";
import {
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type * as Y from "yjs";
import {
  type AnnotationFile,
  LocalAnnotations,
  type ProjectText,
  type StoredAnnotation,
} from "@/lib/annotations/local-annotations";
import { SharedAnnotations } from "@/lib/annotations/shared-annotations";
import type { AnnotationSource, Author } from "@/lib/annotations/types";
import {
  getCollabAwareness,
  getSharedDoc,
  peerColor,
  useCollabStore,
} from "@/stores/collab-store";
import { useDocumentStore } from "@/stores/document-store";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("annotations");

interface AnnotationsState {
  /** Where the open project's highlights and notes are kept. */
  source: AnnotationSource | null;
  /** Bumped whenever any of them change. */
  version: number;
  /** The side panel: notes, or a shared project's chat. */
  panelOpen: boolean;
  panelTab: "notes" | "chat";
  setPanelOpen: (open: boolean) => void;
  /** Opens the side panel on `tab`, or closes it if it's already showing. */
  togglePanel: (tab: "notes" | "chat") => void;
}

export const useAnnotationsStore = create<AnnotationsState>((set) => ({
  source: null,
  version: 0,
  panelOpen: false,
  panelTab: "notes",
  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: (tab) =>
    set((s) =>
      s.panelOpen && s.panelTab === tab
        ? { panelOpen: false }
        : { panelOpen: true, panelTab: tab },
    ),
}));

let current: {
  key: string;
  source: AnnotationSource;
  unsubscribe: () => void;
} | null = null;

function install(key: string, source: AnnotationSource) {
  uninstall();
  current = {
    key,
    source,
    unsubscribe: source.subscribe(() =>
      useAnnotationsStore.setState((s) => ({ version: s.version + 1 })),
    ),
  };
  useAnnotationsStore.setState((s) => ({ source, version: s.version + 1 }));
}

function uninstall() {
  if (!current) return;
  current.unsubscribe();
  current.source.destroy();
  current = null;
  useAnnotationsStore.setState((s) => ({
    source: null,
    version: s.version + 1,
  }));
}

function annotationFile(root: string): AnnotationFile {
  const dir = `${root}/.latex4all`;
  const path = `${dir}/annotations.json`;
  return {
    read: async () => ((await exists(path)) ? readTextFile(path) : null),
    write: async (json) => {
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      await writeTextFile(path, json);
    },
  };
}

function projectText(): ProjectText {
  const files = () => useDocumentStore.getState().files;
  return {
    contentOf: (path) => files().find((f) => f.relativePath === path)?.content,
    write: (path, content) =>
      useDocumentStore.getState().updateFileContent(path, content),
    paths: () => files().map((f) => f.relativePath),
    subscribe: (listener) =>
      useDocumentStore.subscribe((state, prev) => {
        if (state.files !== prev.files) listener();
      }),
  };
}

/** Who new notes are from: your name, in your color. */
export function currentAuthor(): Author {
  const { displayName, color } = useCollabStore.getState();
  const name = displayName.trim() || "Me";
  if (color) return { name, color };
  const shared = getCollabAwareness()?.getLocalState()?.user?.color;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { name, color: typeof shared === "string" ? shared : peerColor(hash) };
}

let following: Promise<void> = Promise.resolve();

/** Uses the shared document's annotations while a project is shared, the local file otherwise. */
export function followAnnotations() {
  const follow = () => {
    following = following.then(async () => {
      const root = useDocumentStore.getState().projectRoot;
      const doc = root ? getSharedDoc(root) : null;
      const key = !root ? null : doc ? `shared:${root}` : `local:${root}`;
      if (key === (current?.key ?? null)) return;
      if (!root || !key) {
        uninstall();
        return;
      }
      if (doc) {
        install(key, new SharedAnnotations(doc));
        return;
      }
      try {
        const local = await LocalAnnotations.load(
          annotationFile(root),
          projectText(),
        );
        if (
          useDocumentStore.getState().projectRoot === root &&
          !getSharedDoc(root)
        ) {
          install(key, local);
        } else {
          local.destroy();
        }
      } catch (err) {
        log.warn("Couldn't load annotations", { error: String(err) });
      }
    });
  };
  follow();
  const unsubscribeDocs = useDocumentStore.subscribe((state, prev) => {
    if (state.projectRoot !== prev.projectRoot) follow();
  });
  const unsubscribeCollab = useCollabStore.subscribe((state, prev) => {
    if (state.status !== prev.status || state.revision !== prev.revision)
      follow();
  });
  return () => {
    unsubscribeDocs();
    unsubscribeCollab();
    uninstall();
  };
}

/** Before sharing: the project's local annotations, saved first. */
export async function takeLocalAnnotations(
  root: string,
): Promise<StoredAnnotation[]> {
  if (
    current?.source instanceof LocalAnnotations &&
    current.key === `local:${root}`
  ) {
    await current.source.flush();
  }
  const local = await LocalAnnotations.load(
    annotationFile(root),
    projectText(),
  );
  const items = local.all();
  local.destroy();
  return items;
}

/** Once shared: move them into the document, and drop the local file. */
export async function moveAnnotationsIntoShared(
  doc: Y.Doc,
  root: string,
  items: StoredAnnotation[],
) {
  if (items.length === 0) return;
  const shared = new SharedAnnotations(doc);
  shared.importLocal(items);
  shared.destroy();
  const path = `${root}/.latex4all/annotations.json`;
  if (await exists(path)) await remove(path);
}

/** When this device stops syncing: keep the annotations, in the local file. */
export async function moveAnnotationsOutOfShared(doc: Y.Doc, root: string) {
  const shared = new SharedAnnotations(doc);
  const text = projectText();
  const items = shared.exportLocal((path) => text.contentOf(path));
  shared.destroy();
  if (items.length === 0) return;
  await annotationFile(root).write(
    JSON.stringify({ version: 1, annotations: items }, null, 2),
  );
}
