/**
 * What every assistant in a project shares, whichever service it is:
 *
 * - AGENTS.md at the project root: lasting notes (style, decisions, what's
 *   left to do). Codex reads it by itself; Claude and Gemini are given it
 *   when a chat starts.
 * - .latex4all/ai-log.jsonl: who asked what and which files changed, so an
 *   assistant hears what the others did since its own last turn.
 */
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export const MEMORY_FILE = "AGENTS.md";
const LOG_FILE = ".latex4all/ai-log.jsonl";
const LOG_KEEP = 200;

export interface AiLogEntry {
  at: number;
  /** The service ("Claude", "ChatGPT", "DeepSeek"…). */
  who: string;
  /** The chat it came from, to leave out an assistant's own turns. */
  tab: string;
  /** What was asked, shortened. */
  ask: string;
  /** Project files it changed. */
  files: string[];
}

const join = (root: string, rel: string) =>
  `${root.replace(/[\\/]+$/, "")}/${rel}`;

export async function readMemory(root: string): Promise<string | null> {
  try {
    const text = await readTextFile(join(root, MEMORY_FILE));
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

export async function writeMemory(root: string, text: string): Promise<void> {
  await writeTextFile(join(root, MEMORY_FILE), text);
}

export function parseLog(text: string): AiLogEntry[] {
  return text
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as AiLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is AiLogEntry => Boolean(e && typeof e.at === "number"));
}

export async function readLog(root: string): Promise<AiLogEntry[]> {
  try {
    return parseLog(await readTextFile(join(root, LOG_FILE)));
  } catch {
    return [];
  }
}

// One write at a time: two chats finishing together mustn't lose a line.
let logQueue: Promise<void> = Promise.resolve();

export function appendLog(root: string, entry: AiLogEntry): Promise<void> {
  logQueue = logQueue.then(async () => {
    try {
      const entries = [...(await readLog(root)), entry].slice(-LOG_KEEP);
      await mkdir(join(root, ".latex4all"), { recursive: true });
      await writeTextFile(
        join(root, LOG_FILE),
        `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`,
      );
    } catch {
      // The log is a help, not a must: a project we can't write to goes on.
    }
  });
  return logQueue;
}

const MEMORY_RULE =
  "This project keeps lasting notes in AGENTS.md at its root, shared by every assistant used here. When something is settled that others should know (style, decisions, what's left to do), add a short line to it.";

const START_RULE =
  "If the user asks you to remember something for this project, write it in AGENTS.md at the project root (create the file); every assistant used here reads it.";

const time = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * What to put before a request: the project memory when a chat starts,
 * and what other assistants did since this chat's last turn.
 */
export function sharedContext(input: {
  memory: string | null;
  log: AiLogEntry[];
  tab: string;
  since: number;
  /** A chat's first turn (or the service changed): give the memory. */
  startingChat: boolean;
  /** Codex reads AGENTS.md itself. */
  readsMemoryItself: boolean;
}): string {
  const parts: string[] = [];
  if (input.startingChat && input.memory) {
    parts.push(MEMORY_RULE);
    if (!input.readsMemoryItself) {
      parts.push(`[Project memory, AGENTS.md]\n${input.memory.trim()}`);
    }
  } else if (input.startingChat) {
    // No memory yet: started only when the user asks for one.
    parts.push(START_RULE);
  }
  const others = input.log
    .filter((e) => e.tab !== input.tab && e.at > input.since)
    .slice(-6);
  if (others.length) {
    parts.push(
      [
        input.startingChat
          ? "[Recent work on this project by other assistants]"
          : "[Since this chat's last turn, other assistants worked on the project]",
        ...others.map(
          (e) =>
            `- ${e.who}, ${time(e.at)}: "${e.ask}"${e.files.length ? ` (changed ${e.files.join(", ")})` : ""}`,
        ),
        "Read the files again before editing what they changed.",
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

/** A request as a log line's "ask": its first line, shortened. */
export const shortAsk = (text: string) => {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("@") && !l.startsWith("[")) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};
