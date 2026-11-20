/**
 * Which of a shared project's files this computer leaves out of the sync,
 * for files kept in step some other way (Dropbox, OneDrive…) while the main
 * .tex syncs live. A path is a file or a folder; a folder covers everything
 * in it, files added later included. The choice is this computer's own: the
 * files stay shared for everyone else.
 */

/** Whether `path` is one of `paths` or inside one of them. */
export function isUnder(path: string, paths: readonly string[]) {
  return paths.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Every folder above `path`, outermost first: `a/b/c.png` → `a`, `a/b`. */
export function foldersOf(path: string) {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * The list after ticking or unticking `path`: no duplicates, and nothing
 * listed inside a folder that's already listed.
 */
export function toggled(paths: readonly string[], path: string, sync: boolean) {
  const next = sync
    ? paths.filter((p) => p !== path && !p.startsWith(`${path}/`))
    : isUnder(path, paths)
      ? [...paths]
      : [...paths.filter((p) => !p.startsWith(`${path}/`)), path];
  return next.sort();
}

/** Paths left out before and not now: their copy here comes back in. */
export function rejoined(before: readonly string[], now: readonly string[]) {
  return before.filter((p) => !now.includes(p));
}

/** "x (conflicted copy 2).y", "x (SFConflict …).y" → "x.y": what it's a copy of. */
function original(name: string) {
  return name
    .replace(
      / \((?:conflicted copy(?: \d+)?|SFConflict[^)]*)\)(?=\.[^.]*$|$)/,
      "",
    )
    .trim();
}

/** A copy a sync made when two versions met: "x (conflicted copy).y",
 * "x (SFConflict name 2026-06-11-10-18-58).y". */
const CONFLICT_COPY =
  / \((?:conflicted copy(?: \d+)?|SFConflict[^)]*)\)(?=\.[^.]*$|$)/;

/**
 * Never shared, whoever's computer has them: a Git folder or the pointer
 * file to one (each computer's own, with its own paths), what macOS and
 * Windows leave in folders, a save cut short, the folders a repair set
 * damaged files aside in, and conflict copies. A conflict copy is the
 * computer's own business, settled there: shared, every other computer got
 * a copy of it, and then copies of those.
 */
export function neverShared(path: string) {
  const parts = path.split("/");
  const last = parts[parts.length - 1];
  const name = original(last);
  return (
    parts.slice(0, -1).some((p) => p === ".git" || p === ".latex4all") ||
    parts.some((p) => /^_damaged-\d{4}-\d{2}-\d{2}$/.test(p)) ||
    CONFLICT_COPY.test(last) ||
    /\.[a-z0-9]{6}\.saving$/i.test(last) ||
    [".git", ".DS_Store", "Thumbs.db", "desktop.ini"].some(
      (n) => name.toLowerCase() === n.toLowerCase(),
    )
  );
}
