import type { ZoteroCollection } from "@/lib/zotero-api";

export interface ZoteroCollectionNode extends ZoteroCollection {
  children: ZoteroCollectionNode[];
  depth: number;
  /** itemCount for this collection plus every collection nested under it */
  totalItemCount: number;
}

/**
 * Builds a nested tree from Zotero's flat collection list.
 * Collections whose parentKey isn't present in the list (e.g. a partial
 * fetch) are treated as roots rather than dropped.
 */
export function buildCollectionTree(
  collections: ZoteroCollection[],
): ZoteroCollectionNode[] {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const childKeys = new Map<string, string[]>();
  for (const c of collections) {
    if (c.parentKey && byKey.has(c.parentKey)) {
      const arr = childKeys.get(c.parentKey) ?? [];
      arr.push(c.key);
      childKeys.set(c.parentKey, arr);
    }
  }

  function build(key: string, depth: number): ZoteroCollectionNode {
    const c = byKey.get(key);
    if (!c) throw new Error(`Collection ${key} not found`);
    const children = (childKeys.get(key) ?? [])
      .map((k) => build(k, depth + 1))
      .sort((a, b) => a.name.localeCompare(b.name));
    const totalItemCount =
      c.itemCount + children.reduce((sum, ch) => sum + ch.totalItemCount, 0);
    return { ...c, children, depth, totalItemCount };
  }

  const rootKeys = collections
    .filter((c) => !c.parentKey || !byKey.has(c.parentKey))
    .map((c) => c.key);

  return rootKeys
    .map((key) => build(key, 0))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns collectionKey plus every collection key nested under it, at any depth. */
export function collectSubtreeKeys(
  collections: ZoteroCollection[],
  collectionKey: string,
): string[] {
  const childKeys = new Map<string, string[]>();
  for (const c of collections) {
    if (c.parentKey) {
      const arr = childKeys.get(c.parentKey) ?? [];
      arr.push(c.key);
      childKeys.set(c.parentKey, arr);
    }
  }

  const result: string[] = [];
  const stack = [collectionKey];
  while (stack.length > 0) {
    const key = stack.pop();
    if (key === undefined) break;
    result.push(key);
    for (const child of childKeys.get(key) ?? []) stack.push(child);
  }
  return result;
}
