import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildCollectionTree,
  type ZoteroCollectionNode,
} from "@/lib/zotero-collection-tree";
import { useZoteroLibrary } from "@/lib/zotero-library";
import { projectTag } from "@/lib/zotero-upload";
import { useDocumentStore } from "@/stores/document-store";
import { useZoteroStore } from "@/stores/zotero-store";

/** Where new items go: a collection's key, or null for none (Unfiled). */
export interface ZoteroTarget {
  collection: string | null;
}

const LIBRARY = "\0library";

const useTargetDialog = create<{
  count: number;
  resolve: ((target: ZoteroTarget | null) => void) | null;
}>(() => ({ count: 0, resolve: null }));

/** Asks which collection `count` new items go into; null if cancelled. */
export function chooseZoteroTarget(
  count: number,
): Promise<ZoteroTarget | null> {
  useTargetDialog.getState().resolve?.(null);
  return new Promise((resolve) => useTargetDialog.setState({ count, resolve }));
}

const rememberKey = (root: string) => `zotero-upload-target:${root}`;

/** The last choice for this project, else the collection its .bib follows. */
function defaultChoice(root: string | null): string {
  if (!root) return LIBRARY;
  try {
    const saved = localStorage.getItem(rememberKey(root));
    if (saved !== null) return saved || LIBRARY;
  } catch {}
  const synced = Object.values(
    useZoteroStore.getState().syncedCollections[root] ?? {},
  ).find((c) => c.collectionKey);
  return synced?.collectionKey ?? LIBRARY;
}

function flatten(nodes: ZoteroCollectionNode[]): ZoteroCollectionNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

export function ZoteroTargetDialog() {
  const count = useTargetDialog((s) => s.count);
  const resolve = useTargetDialog((s) => s.resolve);
  const root = useDocumentStore((s) => s.projectRoot);
  const mirror = useZoteroLibrary((s) => s.mirror);
  const collections = useMemo(
    () => flatten(buildCollectionTree(mirror?.collections ?? [])),
    [mirror],
  );
  const [choice, setChoice] = useState(LIBRARY);
  useEffect(() => {
    if (!resolve) return;
    const wanted = defaultChoice(root);
    // A remembered collection that's since been deleted falls back.
    setChoice(
      wanted === LIBRARY || collections.some((c) => c.key === wanted)
        ? wanted
        : LIBRARY,
    );
  }, [resolve, root, collections]);

  const finish = (target: ZoteroTarget | null) => {
    resolve?.(target);
    useTargetDialog.setState({ resolve: null });
  };
  const confirm = () => {
    if (root) {
      try {
        localStorage.setItem(
          rememberKey(root),
          choice === LIBRARY ? "" : choice,
        );
      } catch {}
    }
    finish({ collection: choice === LIBRARY ? null : choice });
  };

  return (
    <Dialog open={resolve !== null} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Add {count === 1 ? "1 reference" : `${count} references`} to Zotero
          </DialogTitle>
          <DialogDescription>Tagged “{projectTag(root)}”.</DialogDescription>
        </DialogHeader>
        <Select value={choice} onValueChange={setChoice}>
          <SelectTrigger className="w-full" aria-label="Collection">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={LIBRARY}>My Library (no collection)</SelectItem>
            {collections.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                <span style={{ paddingLeft: c.depth * 12 }}>{c.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button onClick={confirm}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
