/**
 * Everything holding work not yet on disk (the editor's unsaved edits, a
 * highlight about to be saved, where you are) registers how to save it now.
 * Before the window closes or the app quits, all of it is saved.
 */
type Flush = () => Promise<unknown> | unknown;

const flushes = new Set<Flush>();

/** Registers a way to save something now; returns how to unregister it. */
export function onFlush(flush: Flush): () => void {
  flushes.add(flush);
  return () => flushes.delete(flush);
}

/** Saves everything there is to save, each on its own (one failing doesn't
 *  stop the rest), within `ms` at most. */
export async function flushAll(ms = 4000): Promise<void> {
  const all = Promise.allSettled(
    [...flushes].map((f) => Promise.resolve().then(f)),
  );
  await Promise.race([all, new Promise((r) => setTimeout(r, ms))]);
}
