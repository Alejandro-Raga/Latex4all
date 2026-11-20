/**
 * Told whenever the app writes a PDF (an export, a compile's saved copy),
 * so lists of a project's PDFs show it straight away.
 */
const listeners = new Set<(path: string) => void>();

export function notePdfWritten(path: string) {
  for (const listener of listeners) listener(path);
}

export function onPdfWritten(listener: (path: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
