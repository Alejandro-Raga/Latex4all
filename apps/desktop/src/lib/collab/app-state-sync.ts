/**
 * Linked devices are replicas: everything the app keeps (settings,
 * favourites, home-screen folders and types, bookmarks, the dock, the
 * vault's and Zotero's settings, reading queue, per-project layouts…) is
 * the same on each, except what belongs to one computer (its identity, its
 * window size and zoom, where new projects go, which folders hold shared
 * projects here).
 *
 * Each saved store goes into the library's document as JSON, with paths
 * made portable: a project's folder becomes `@p:<project id>` (fetched
 * projects sit in different folders on each device), anything else under
 * the home folder becomes `@home/…` (so `~/Seafile/Vault` maps across).
 * On the way in they become this device's paths, with its separators; an
 * entry about a project this device doesn't have is left out. A store
 * changed here goes out; one changed on another device comes in, merged
 * over this one's (fields kept per device stay), and the store reloads.
 * If both changed since they last agreed, the later change wins.
 */

import * as Y from "yjs";
import { homeDir } from "@tauri-apps/api/path";
import { textHash } from "./project-doc";

/** The saved stores (zustand `persist` names, and plain keys). */
const KEYS = [
  "latex4all-settings",
  "latex4all-projects",
  "project-folders",
  "latex4all-bookmarks",
  "latex4all-dock",
  "latex4all-vault",
  "latex4all-zotero",
  "latex4all-ai-usage",
  "latex4all-agent-accounts",
  "planner-own-lists",
  "reading-queue",
  "latex4all-collab",
  "latex4all-vault-folds",
  "latex4all-vault-tab",
  "latex4all-project-ai",
  "latex4all-zotero-tag-registry",
  "latex4all-blended-themes",
];
/** Keys by prefix (one per project: its workspace layout). */
const PREFIXES = ["latex4all-workspace:"];

/** Fields of a store that stay as each device has them. */
const PER_DEVICE: Record<string, string[]> = {
  "latex4all-projects": ["lastProjectFolder", "sharedProjects"],
};

export interface PathMap {
  /** Project id → this device's folder for it. */
  roots: Record<string, string>;
  home: string;
  sep: "/" | "\\";
}

export async function pathMap(roots: Record<string, string>): Promise<PathMap> {
  const home = (await homeDir()).replace(/[\\/]+$/, "");
  return { roots, home, sep: home.includes("\\") ? "\\" : "/" };
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** A string with this device's paths made portable. */
export function portable(text: string, map: PathMap): string {
  const t = norm(text);
  // The longest folder first: a project inside another wins.
  const roots = Object.entries(map.roots)
    .map(([id, root]) => [id, norm(root)] as const)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [id, root] of roots) {
    const at = t.indexOf(root);
    if (at < 0) continue;
    const after = t.slice(at + root.length);
    if (after && !after.startsWith("/")) continue;
    return `${t.slice(0, at)}@p:${id}${after}`;
  }
  const home = norm(map.home);
  const at = home ? t.indexOf(home) : -1;
  if (at >= 0) {
    const after = t.slice(at + home.length);
    if (!after || after.startsWith("/"))
      return `${t.slice(0, at)}@home${after}`;
  }
  return text;
}

/** A portable string as this device's path; null if it names a project
 * this device doesn't have. */
export function local(text: string, map: PathMap): string | null {
  const m = /@p:([0-9a-f]{32})|@home/.exec(text);
  if (!m) return text;
  const base = m[1] ? map.roots[m[1]] : map.home;
  if (!base) return null;
  const rest = text.slice(m.index + m[0].length);
  const path = norm(base) + rest;
  return text.slice(0, m.index) + path.replace(/[\\/]/g, map.sep);
}

function mapValue(
  value: unknown,
  fn: (s: string) => string | null,
): unknown | undefined {
  if (typeof value === "string") {
    const r = fn(value);
    return r === null ? undefined : r;
  }
  if (Array.isArray(value)) {
    return value.map((v) => mapValue(v, fn)).filter((v) => v !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const key = fn(k);
      const mapped = mapValue(v, fn);
      if (key !== null && mapped !== undefined) out[key] = mapped;
    }
    return out;
  }
  return value;
}

/** A store's saved JSON, portable and without its per-device fields. */
export function exportStore(
  key: string,
  raw: string,
  map: PathMap,
): string | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Plain text (a tab's name, say).
    return JSON.stringify({ text: portable(raw, map) });
  }
  const drop = PER_DEVICE[key];
  if (drop && value && typeof value === "object" && "state" in value) {
    const state = { ...(value as { state: Record<string, unknown> }).state };
    for (const f of drop) delete state[f];
    value = { ...(value as object), state };
  }
  return JSON.stringify(mapValue(value, (s) => portable(s, map)));
}

/** Another device's store, as this device saves it: its per-device fields
 * kept from what's here. */
export function importStore(
  key: string,
  json: string,
  current: string | null,
  map: PathMap,
): string | null {
  let value: unknown;
  try {
    value = mapValue(JSON.parse(json), (s) => local(s, map));
  } catch {
    return null;
  }
  if (value && typeof value === "object" && "text" in value) {
    const keys = Object.keys(value);
    if (keys.length === 1) return String((value as { text: string }).text);
  }
  const keep = PER_DEVICE[key];
  if (
    keep &&
    current &&
    value &&
    typeof value === "object" &&
    "state" in value
  ) {
    try {
      const mine = JSON.parse(current)?.state ?? {};
      const state = { ...(value as { state: Record<string, unknown> }).state };
      for (const f of keep) if (f in mine) state[f] = mine[f];
      if (key === "latex4all-projects") mergeProjects(state, mine);
      value = { ...(value as object), state };
    } catch {
      // Nothing of this device's to keep.
    }
  }
  return JSON.stringify(value);
}

/**
 * The project list is put together, not replaced: projects only this
 * device has (not yet in the library) stay on its home screen, and go to
 * the library from there.
 */
function mergeProjects(
  state: Record<string, unknown>,
  mine: Record<string, unknown>,
) {
  type Recent = { path: string };
  const theirs = (state.recentProjects as Recent[] | undefined) ?? [];
  const here = (mine.recentProjects as Recent[] | undefined) ?? [];
  const paths = new Set(theirs.map((p) => p.path));
  state.recentProjects = [...theirs, ...here.filter((p) => !paths.has(p.path))];
  for (const f of ["addedAt", "createdAt", "projectTypes"]) {
    state[f] = {
      ...((mine[f] as object | undefined) ?? {}),
      ...((state[f] as object | undefined) ?? {}),
    };
  }
}

function syncedKeys(): string[] {
  const keys = new Set(KEYS);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && PREFIXES.some((p) => k.startsWith(p))) keys.add(k);
    }
  } catch {
    // None.
  }
  return [...keys];
}

interface Shared {
  json: string;
  at: number;
}

export function appState(doc: Y.Doc) {
  return doc.getMap<Shared>("appState");
}

/** What each store was (its portable hash) when last in step. */
export type StateKnown = Record<string, string>;

/**
 * One pass. Returns what's known afterwards, and whether anything came in
 * (then the stores reload).
 */
export function syncAppState(
  doc: Y.Doc,
  known: StateKnown,
  map: PathMap,
): { known: StateKnown; changed: string[] } {
  const shared = appState(doc);
  const next: StateKnown = { ...known };
  const changed: string[] = [];
  // Keys stored portably (a workspace key holds a path in its name).
  const keys = new Set(syncedKeys().map((k) => portable(k, map)));
  for (const k of shared.keys()) keys.add(k);
  for (const pkey of keys) {
    const key = local(pkey, map);
    if (key === null) continue;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      continue;
    }
    const mine = raw === null ? null : exportStore(key, raw, map);
    const mineHash = mine === null ? null : textHash(mine);
    const theirs = shared.get(pkey);
    const theirsHash = theirs ? textHash(theirs.json) : null;
    const was = known[pkey];
    if (mine !== null && mineHash !== was) {
      // Changed here since they agreed (or new here); changed on both, this
      // one goes out and the other device takes it.
      if (theirs && was === undefined && theirsHash !== mineHash) {
        // Both had it before they met: the library's version stands (the
        // device that linked first), so nothing here is pushed over it.
        applyTheirs(key, pkey, theirs, raw, map, next, changed);
        continue;
      }
      if (theirsHash !== mineHash) {
        shared.set(pkey, { json: mine, at: Date.now() });
      }
      next[pkey] = mineHash as string;
    } else if (theirs && theirsHash !== was) {
      applyTheirs(key, pkey, theirs, raw, map, next, changed);
    }
  }
  return { known: next, changed };
}

function applyTheirs(
  key: string,
  pkey: string,
  theirs: Shared,
  raw: string | null,
  map: PathMap,
  next: StateKnown,
  changed: string[],
) {
  const value = importStore(key, theirs.json, raw, map);
  if (value === null) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
  // What it now reads as, from here (fields kept per device aside).
  const mine = exportStore(key, value, map);
  next[pkey] = mine === null ? textHash(theirs.json) : textHash(mine);
  changed.push(key);
}
