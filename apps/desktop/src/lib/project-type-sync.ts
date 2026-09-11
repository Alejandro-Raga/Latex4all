/**
 * Reconciling the cached project types with what is on disk.
 *
 * Types live in each project's folder, so the grid renders a cached copy and
 * this brings the cache back in line. The subtlety is that it must not fight
 * with a type the user has just set: the cache is updated optimistically so the
 * menu closes onto the right answer, and the write to disk lands a moment
 * later. A read that happens in between sees no file yet and would helpfully
 * "correct" the cache back to nothing — which is exactly the bug this shape
 * exists to prevent, where setting a type the first time appeared to do nothing
 * and setting it again worked.
 *
 * Hence `isPending`: a path being written is not a path to reconcile.
 */

export interface SyncProjectTypesOptions {
  paths: string[];
  readType: (path: string) => Promise<string | null>;
  getCached: (path: string) => string | null;
  setCached: (path: string, type: string | null) => void;
  /** True while a write for this path is in flight. */
  isPending: (path: string) => boolean;
}

export async function syncProjectTypes({
  paths,
  readType,
  getCached,
  setCached,
  isPending,
}: SyncProjectTypesOptions): Promise<void> {
  await Promise.all(
    paths.map(async (path) => {
      if (isPending(path)) return;

      const onDisk = await readType(path);

      // Checked again after the read: a write can start while it is in flight,
      // and the value that write is about to commit is newer than this one.
      if (isPending(path)) return;
      if (onDisk === getCached(path)) return;

      setCached(path, onDisk);
    }),
  );
}
