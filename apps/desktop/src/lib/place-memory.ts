/**
 * Where you left off, kept in a small file in the app's folder (place.json):
 * the part of the app you were in, the Library's paper and project, the
 * vault's note. A file, not the webview's storage, because that is written
 * to disk lazily and what changed just before quitting could be lost.
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readTextFile } from "@tauri-apps/plugin-fs";
import { onFlush } from "./flush";
import { writeTextSafely } from "./safe-write";

export interface Place {
  /** "writing", or a part of the start page ("planner", "library"…). */
  last?: string;
  library?: {
    file?: unknown;
    project?: string | null;
    collections?: string[];
  };
  /** The vault note open. */
  note?: string | null;
  /** The Library's projects unfolded, and what's typed in its search. */
  libraryOpen?: string[];
  libraryQuery?: string;
}

let place: Place = {};
let loading: Promise<Place> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

async function path() {
  const dir = await appDataDir();
  await mkdir(dir, { recursive: true }).catch(() => {});
  return join(dir, "place.json");
}

/**
 * Where you left off last time, as it was on disk (what's kept since
 * launching doesn't count: the app records "Home" before it's restored).
 */
export function loadPlace(): Promise<Place> {
  loading ??= path()
    .then((p) => readTextFile(p))
    .then((text) => JSON.parse(text) as Place)
    .catch(() => ({}) as Place)
    .then((saved) => {
      // Kept with what's changed since on top, for the next write.
      place = { ...saved, ...place };
      return saved;
    });
  return loading;
}

/** Where you are now, this session included (after it's been read). */
export function loadCurrent(): Promise<Place> {
  return loadPlace().then(() => place);
}

/** Where you are now, as far as known yet (before reading: this session's). */
export const placeNow = (): Place => place;

let pending = false;

/** Writes where you are now (once what was there has been read). */
function writeNow() {
  pending = false;
  return loadPlace()
    .then(() => path())
    .then((p) => writeTextSafely(p, JSON.stringify(place)))
    .catch(() => {});
}

/** Keeps one part of where you are, written a moment later. */
export function keepPlace<K extends keyof Place>(key: K, value: Place[K]) {
  place = { ...place, [key]: value };
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(() => void writeNow(), 250);
}

// Quitting within that moment: written at once.
onFlush(() => {
  if (!pending) return;
  clearTimeout(timer);
  return writeNow();
});
