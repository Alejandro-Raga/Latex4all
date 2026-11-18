/**
 * Where you left off, kept in a small file in the app's folder (place.json):
 * the part of the app you were in, the Library's paper and project, the
 * vault's note. A file, not the webview's storage, because that is written
 * to disk lazily and what changed just before quitting could be lost.
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

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

/** Keeps one part of where you are, written a moment later. */
export function keepPlace<K extends keyof Place>(key: K, value: Place[K]) {
  place = { ...place, [key]: value };
  clearTimeout(timer);
  timer = setTimeout(() => {
    // Only once what was there has been read, so nothing of it is lost.
    void loadPlace()
      .then(() => path())
      .then((p) => writeTextFile(p, JSON.stringify(place)))
      .catch(() => {});
  }, 250);
}
