/**
 * What's known about the shared project's connection to the relay, for the
 * Share popover's "Connection" details and for diagnosing problems: its
 * state, when it last came and went and why, how often it reconnected, what
 * hasn't been sent yet, and a short log. Also tells the user, once per
 * outage, whether the sync service or their internet is down.
 */
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";
import type { SyncEvent } from "./shared-session";

export interface Probe {
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
}

export interface Health {
  relay: Probe;
  internet: Probe;
  at: number;
}

type LinkState = "connecting" | "online" | "offline";

interface ConnectionState {
  link: string | null;
  state: LinkState | null;
  since: number | null;
  lastOnline: number | null;
  lastOffline: number | null;
  lastReason: string | null;
  reconnects: number;
  lastHeard: number | null;
  /** Changes made here the relay hasn't confirmed yet. */
  pending: number;
  health: Health | null;
  /** What the last check found, while offline. */
  outage: "service" | "internet" | null;
  log: { at: number; text: string }[];
  reset: (link: string | null) => void;
  record: (event: SyncEvent) => void;
  check: () => Promise<Health | null>;
}

/** Offline this long before checking what's down and saying so. */
const CHECK_AFTER_MS = 15_000;
const LOG_SIZE = 50;

let checkTimer: ReturnType<typeof setTimeout> | null = null;
let noticeShown = false;

export const useConnection = create<ConnectionState>((set, get) => {
  const note = (text: string) =>
    set((s) => ({
      log: [...s.log, { at: Date.now(), text }].slice(-LOG_SIZE),
    }));

  const scheduleCheck = () => {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      checkTimer = null;
      if (get().state !== "offline") return;
      const health = await get().check();
      if (!health || get().state !== "offline" || noticeShown) return;
      noticeShown = true;
      if (!health.internet.ok) {
        set({ outage: "internet" });
        toast.warning("You're offline", {
          description:
            "Your changes to this shared project are kept here and will be sent when you're back online.",
          duration: 10_000,
        });
      } else if (!health.relay.ok) {
        set({ outage: "service" });
        toast.warning("The sync service isn't answering", {
          description:
            "Your changes to this shared project are kept here and will be sent when it's back.",
          duration: 10_000,
        });
      }
    }, CHECK_AFTER_MS);
  };

  return {
    link: null,
    state: null,
    since: null,
    lastOnline: null,
    lastOffline: null,
    lastReason: null,
    reconnects: 0,
    lastHeard: null,
    pending: 0,
    health: null,
    outage: null,
    log: [],

    reset: (link) => {
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = null;
      noticeShown = false;
      set({
        link,
        state: link ? "connecting" : null,
        since: link ? Date.now() : null,
        lastOnline: null,
        lastOffline: null,
        lastReason: null,
        reconnects: 0,
        lastHeard: null,
        pending: 0,
        health: null,
        outage: null,
        log: link ? [{ at: Date.now(), text: "opened" }] : [],
      });
    },

    record: (event) => {
      const now = Date.now();
      if (event.type !== "status") {
        set({ lastHeard: now });
        if (event.type === "caughtUp" || event.type === "ack") {
          set({ pending: event.pending });
        }
        if (event.type === "caughtUp") {
          note(
            `caught up at #${event.seq} (${event.pending} of mine still unconfirmed)`,
          );
        }
        if (event.type === "error") note(`relay error: ${event.code}`);
        return;
      }
      const previous = get().state;
      if (event.state === previous) return;
      if (event.state === "online") {
        const back = get().outage !== null || noticeShown;
        set({
          state: "online",
          since: now,
          lastOnline: now,
          lastHeard: now,
          outage: null,
          reconnects: get().lastOffline ? get().reconnects + 1 : 0,
        });
        note("online");
        if (checkTimer) clearTimeout(checkTimer);
        if (back) {
          noticeShown = false;
          toast.success("Back online", {
            description: "Your changes to the shared project are being sent.",
          });
        }
      } else if (event.state === "offline") {
        const reason = event.reason ?? null;
        set({
          state: "offline",
          since: now,
          lastOffline: now,
          lastReason: reason,
        });
        note(`offline${reason ? `: ${reason}` : ""}`);
        scheduleCheck();
      } else {
        set({ state: "connecting", since: now });
        note("connecting");
      }
    },

    check: async () => {
      const { link } = get();
      if (!link) return null;
      try {
        const result = await invoke<Omit<Health, "at">>("collab_health", {
          link,
        });
        const health = { ...result, at: Date.now() };
        set({ health });
        note(
          `check: relay ${health.relay.ok ? `ok (${health.relay.ms} ms)` : `down (${health.relay.error ?? health.relay.status})`}, internet ${health.internet.ok ? "ok" : "down"}`,
        );
        return health;
      } catch (err) {
        note(`check failed: ${String(err)}`);
        return null;
      }
    },
  };
});

const time = (ms: number | null) =>
  ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : "never";

/**
 * A report to paste into a bug report or a message: everything above, with
 * the project named only by the start of its id (never its key).
 */
export function diagnostics(appVersion: string): string {
  const c = useConnection.getState();
  const url = c.link?.split("#")[0] ?? "";
  const host = url.replace(/^https?:\/\//, "").split("/")[0];
  const project = url.split("/p/")[1]?.slice(0, 8) ?? "?";
  const h = c.health;
  return [
    `Latex4All ${appVersion} · ${navigator.userAgent}`,
    `Relay ${host || "?"} · project ${project}…`,
    `Now ${time(Date.now())}`,
    `State ${c.state ?? "not shared"} since ${time(c.since)}`,
    `Last online ${time(c.lastOnline)} · last offline ${time(c.lastOffline)}${c.lastReason ? ` (${c.lastReason})` : ""}`,
    `Reconnects ${c.reconnects} · unsent changes ${c.pending} · last heard from relay ${time(c.lastHeard)}`,
    h
      ? `Check at ${time(h.at)}: relay ${h.relay.ok ? "ok" : "DOWN"} ${h.relay.status ?? ""} ${h.relay.ms} ms ${h.relay.error ?? ""}· internet ${h.internet.ok ? "ok" : "DOWN"} ${h.internet.ms} ms ${h.internet.error ?? ""}`
      : "No check run",
    "",
    "Log:",
    ...c.log.map((l) => `${time(l.at)} ${l.text}`),
  ].join("\n");
}
