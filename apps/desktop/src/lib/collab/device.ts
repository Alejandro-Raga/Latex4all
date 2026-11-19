/**
 * This copy of the app, and the other devices linked to it (Settings → Devices): to tell a project's owner from the others.
 */

const ID = "latex4all-device-id";
const LINKED = "latex4all-linked-devices";

export function deviceId(): string {
  try {
    let id = localStorage.getItem(ID);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ID, id);
    }
    return id;
  } catch {
    return "";
  }
}

/** The ids of this device and the ones linked to it. */
export function myDevices(): Set<string> {
  const ids = new Set([deviceId()]);
  try {
    for (const id of JSON.parse(localStorage.getItem(LINKED) ?? "[]")) {
      if (typeof id === "string") ids.add(id);
    }
  } catch {
    // None.
  }
  return ids;
}

export function setLinkedDevices(ids: string[]) {
  try {
    localStorage.setItem(LINKED, JSON.stringify(ids));
  } catch {
    // Kept in memory only by the library's document.
  }
}

/** A name for this device, for the list of linked ones. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows computer";
  if (/Mac/i.test(ua)) return "Mac";
  return "Linux computer";
}

const PEOPLE = "latex4all-shared-with-people";

/** Projects shared with other people (the Share button, or joined from
 * someone's link), as opposed to only synced between one's own devices. */
/** Paths compared as one whatever way their accents are stored. */
export class PathSet extends Set<string> {
  override has(path: string) {
    return super.has(path.normalize("NFC"));
  }
  override add(path: string) {
    return super.add(path.normalize("NFC"));
  }
  override delete(path: string) {
    return super.delete(path.normalize("NFC"));
  }
}

export function sharedWithPeople(): Set<string> {
  try {
    // Marks from before people were told apart by who's in the project:
    // they marked every project, so they're dropped once.
    if (localStorage.getItem(`${PEOPLE}-v2`) !== "1") {
      localStorage.removeItem(PEOPLE);
      localStorage.setItem(`${PEOPLE}-v2`, "1");
    }
    const set = new PathSet();
    for (const p of JSON.parse(localStorage.getItem(PEOPLE) ?? "[]"))
      set.add(p);
    return set;
  } catch {
    return new PathSet();
  }
}

export function markSharedWithPeople(root: string) {
  const roots = sharedWithPeople();
  if (roots.has(root)) return;
  roots.add(root);
  try {
    localStorage.setItem(PEOPLE, JSON.stringify([...roots]));
  } catch {
    // Shown as synced only until next time.
  }
}

export function unmarkSharedWithPeople(root: string) {
  const roots = sharedWithPeople();
  if (!roots.delete(root)) return;
  try {
    localStorage.setItem(PEOPLE, JSON.stringify([...roots]));
  } catch {
    // As it was.
  }
}
