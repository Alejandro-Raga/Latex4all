/**
 * What can go wrong with syncing a shared project, worded for the person
 * using it: shown in the Shared button until it's resolved.
 */

export interface SyncWarning {
  /** One per kind of problem (and file), so repeats don't pile up. */
  id: string;
  /** `error`: changes aren't reaching the others. */
  level: "warning" | "error";
  text: string;
}

export interface Usage {
  projectBytes: number;
  maxProjectBytes: number;
  relayNearlyFull: boolean;
}

/** Warnings about space, from the relay's latest figures. */
export const USAGE_WARNING_IDS = ["full", "nearly-full", "relay-full"];

/** Past this share of its allowance, a project is nearly full. */
const NEARLY_FULL = 0.8;

export function megabytes(bytes: number) {
  return Math.round(bytes / (1024 * 1024));
}

const FULL: SyncWarning = {
  id: "full",
  level: "error",
  text: "This project is full, so new changes and files don't reach the others. Remove large files to make room.",
};

export function usageWarnings(usage: Usage): SyncWarning[] {
  const warnings: SyncWarning[] = [];
  const share = usage.projectBytes / usage.maxProjectBytes;
  if (share >= 1) warnings.push(FULL);
  else if (share >= NEARLY_FULL) {
    warnings.push({
      id: "nearly-full",
      level: "warning",
      text: `This project uses ${megabytes(usage.projectBytes)} of its ${megabytes(usage.maxProjectBytes)} MB. Once full, changes stop reaching the others.`,
    });
  }
  if (usage.relayNearlyFull) {
    warnings.push({
      id: "relay-full",
      level: "warning",
      text: "The sync server is nearly full. Syncing may stop for everyone.",
    });
  }
  return warnings;
}

/**
 * A warning for an error from the sync (a relay error code, or a message
 * about one file), or null if it isn't worth keeping on show.
 */
export function warningForError(message: string): SyncWarning | null {
  switch (message) {
    case "quota":
      return FULL;
    case "too-large":
      return {
        id: "too-large",
        level: "error",
        text: "A change was too large to send. Try splitting it up.",
      };
    case "outdated":
      return {
        id: "outdated",
        level: "error",
        text: "This project needs a newer Latex4All. Update to keep syncing; your changes are kept.",
      };
    case "gone":
      return {
        id: "gone",
        level: "error",
        text: "This project is no longer shared. Your files are still here.",
      };
    case "corrupt":
    case "chat-quota":
    case "chat-too-large":
      return null;
  }
  const file = message.match(/^Couldn't (share|get|download) (.+?): (.*)$/);
  if (file) {
    const [, action, path, reason] = file;
    if (reason === "quota") return FULL;
    if (reason === "too-large") {
      return {
        id: `too-large:${path}`,
        level: "warning",
        text: `${path} is over 25 MB, so it isn't shared.`,
      };
    }
    return action === "share"
      ? {
          id: `share:${path}`,
          level: "warning",
          text: `Couldn't share ${path}. It will be tried again when it changes.`,
        }
      : {
          id: `get:${path}`,
          level: "warning",
          text: `Couldn't get the latest ${path}. It will be tried again.`,
        };
  }
  return { id: message, level: "warning", text: message };
}
