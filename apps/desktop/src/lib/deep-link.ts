/**
 * latex4all:// links, which open a project (and a place in it) from outside
 * the app — from a project's note in Obsidian, say.
 *
 *   latex4all://open?project=/path/to/project&file=main.tex&line=42
 */

export interface Latex4AllLink {
  project: string;
  file?: string;
  line?: number;
}

export function latex4allLink(link: Latex4AllLink): string {
  const params = new URLSearchParams({ project: link.project });
  if (link.file) params.set("file", link.file);
  if (link.line) params.set("line", String(link.line));
  return `latex4all://open?${params}`;
}

export function parseLatex4AllLink(url: string): Latex4AllLink | null {
  const m = url.match(/^latex4all:\/\/open\/?\?(.*)$/i);
  if (!m) return null;
  const params = new URLSearchParams(m[1]);
  const project = params.get("project");
  if (!project) return null;
  const line = Number(params.get("line"));
  return {
    project,
    ...(params.get("file") ? { file: params.get("file") as string } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
  };
}

/** Offset of the start of 1-based `line` in `text` (clamped to the text). */
export function offsetOfLine(text: string, line: number): number {
  let offset = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}
