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
  /** Its code (docs/sync.md, "Error codes"), to look up or report. */
  code?: string;
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
  code: "R02",
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
      code: "R09",
      level: "warning",
      text: `This project uses ${megabytes(usage.projectBytes)} of its ${megabytes(usage.maxProjectBytes)} MB. Once full, changes stop reaching the others.`,
    });
  }
  if (usage.relayNearlyFull) {
    warnings.push({
      id: "relay-full",
      code: "R08",
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
/** Why a file didn't go through, in a few words (with its leading ": "). */
function plainReason(reason: string): string {
  if (/relay answered 5\d\d/i.test(reason)) return ": the relay didn't answer";
  if (
    /couldn't reach the relay|error sending request|timed? ?out/i.test(reason)
  ) {
    return ": no connection to the relay";
  }
  if (/relay answered 4\d\d/i.test(reason)) {
    return `: the relay refused it (${reason.match(/\d{3}/)?.[0]})`;
  }
  if (
    /os error (5|32|33)\b|being used by another process|access is denied/i.test(
      reason,
    )
  ) {
    return ": another program has it open (Seafile, an editor or an antivirus)";
  }
  if (/no such file|not found|os error 2\b/i.test(reason)) {
    return ": the file couldn't be read";
  }
  return "";
}

export function warningForError(message: string): SyncWarning | null {
  switch (message) {
    case "quota":
      return FULL;
    case "too-large":
      return {
        id: "too-large",
        code: "R05",
        level: "error",
        text: "A change was too large to send. Try splitting it up.",
      };
    case "outdated":
      return {
        id: "outdated",
        code: "R04",
        level: "error",
        text: "This project needs a newer Latex4All. Update to keep syncing; your changes are kept.",
      };
    case "gone":
      return {
        id: "gone",
        code: "R03",
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
        code: "R05",
        level: "warning",
        text: `${path} is over 25 MB, so it isn't shared.`,
      };
    }
    const why = plainReason(reason);
    return action === "share"
      ? {
          id: `share:${path}`,
          code: "R06",
          level: "warning",
          text: `Couldn't share ${path}${why}. Trying again in a few minutes.`,
        }
      : {
          id: `get:${path}`,
          code: "R07",
          level: "warning",
          text: `Couldn't get the latest ${path}${why}. Trying again.`,
        };
  }
  return { id: message, code: "X00", level: "warning", text: message };
}

/**
 * Peer-to-peer and storage problems, by the code the sync reports
 * (src-tauri/src/p2p.rs `Problem`); docs/sync.md lists them all.
 */
const PEER_PROBLEMS: Record<string, Omit<SyncWarning, "id" | "code">> = {
  P01: {
    level: "warning",
    text: "Peer-to-peer sync can't start: this network may block it. Changes still go through the sync server.",
  },
  P02: {
    level: "warning",
    text: "This computer's sync identity couldn't be read, so it made a new one.",
  },
  P03: {
    level: "error",
    text: "Another computer is syncing as this one (its app data was copied from here). Restart Latex4All on one of them to give it its own identity.",
  },
  P04: {
    level: "warning",
    text: "Some changes from others were refused: they weren't signed by a member.",
  },
  F01: {
    level: "error",
    text: "The sync folder can't be found. Check it's still there and your cloud app is running, or choose it again in Settings → Sync.",
  },
  F02: {
    level: "error",
    text: "The sync folder can't be written to. Check your cloud app has room and the folder isn't read-only.",
  },
  H01: {
    level: "warning",
    text: "Your server can't be reached. Changes wait here and go out when it's back.",
  },
  H02: {
    level: "error",
    text: "Your server didn't accept its code. Copy the code from it again into Settings → Sync.",
  },
};

export function warningForPeerProblem(code: string): SyncWarning {
  const known = PEER_PROBLEMS[code];
  return known
    ? { id: `peer:${code}`, code, ...known }
    : {
        id: `peer:${code}`,
        code,
        level: "warning",
        text: "Peer-to-peer sync had a problem.",
      };
}
