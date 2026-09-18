import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { yCollab } from "y-codemirror.next";
import { toBase64 } from "lib0/buffer";
import {
  applyTextChange,
  layout,
  metaMap,
  numberedPath,
  textHash,
} from "@/lib/collab/project-doc";
import {
  type Known,
  type LocalFile,
  ProjectSync,
  type Workspace,
} from "@/lib/collab/project-sync";
import {
  OFFLINE_AFTER_MS,
  SharedSession,
  type SyncEvent,
} from "@/lib/collab/shared-session";
import { settleConcurrentEdits } from "@/lib/collab/concurrent-edits";
import { SharedAnnotations } from "@/lib/annotations/shared-annotations";

// ─── A relay and devices, in memory ───

/** Behaves like apps/relay plus collab.rs: seqs, acks, catch-up, outbox. */
class FakeRelay {
  log: Array<{ seq: number; data: Uint8Array }> = [];
  snapshot: { upTo: number; data: Uint8Array } | null = null;
  blobs = new Map<string, string>();
  private online = new Set<Device>();

  get head() {
    return Math.max(
      this.log[this.log.length - 1]?.seq ?? 0,
      this.snapshot?.upTo ?? 0,
    );
  }

  connect(device: Device) {
    this.online.add(device);
    const after = device.after;
    if (this.snapshot && after < this.snapshot.upTo) {
      device.receive({
        type: "snapshot",
        upTo: this.snapshot.upTo,
        data: toBase64(this.snapshot.data),
      });
    }
    const from = Math.max(after, this.snapshot?.upTo ?? 0);
    for (const entry of this.log.filter((e) => e.seq > from)) {
      device.receive({
        type: "update",
        seq: entry.seq,
        data: toBase64(entry.data),
      });
    }
    device.receive({
      type: "caughtUp",
      seq: this.head,
      logEntries: this.log.length,
      logBytes: this.log.reduce((n, e) => n + e.data.length, 0),
      pending: device.outbox.length,
      chatDays: 30,
    });
    for (const update of device.outbox.splice(0)) this.store(device, update);
  }

  disconnect(device: Device) {
    this.online.delete(device);
    device.receive({ type: "status", state: "offline" });
  }

  isOnline(device: Device) {
    return this.online.has(device);
  }

  store(from: Device, data: Uint8Array) {
    const seq = this.head + 1;
    this.log.push({ seq, data });
    from.receive({ type: "ack", seq, pending: from.outbox.length });
    for (const other of this.online) {
      if (other !== from) {
        other.receive({ type: "update", seq, data: toBase64(data) });
      }
    }
  }

  awareness(from: Device, data: Uint8Array) {
    for (const other of this.online) {
      if (other !== from)
        other.receive({ type: "awareness", data: toBase64(data) });
    }
  }
}

/** A project folder: files on disk, and the editor's loaded view of them. */
class FakeWorkspace implements Workspace {
  disk = new Map<string, string>();
  /** Whether this project is the one open. */
  open = true;
  private view = new Map<string, LocalFile>();
  private listeners = new Set<() => void>();

  constructor(
    private readonly relay: FakeRelay,
    files: Record<string, string> = {},
  ) {
    for (const [path, content] of Object.entries(files)) {
      this.disk.set(path, content);
    }
    this.readDisk();
  }

  static isBinary(path: string) {
    return /\.(png|pdf)$/.test(path);
  }

  available() {
    return this.open;
  }

  files() {
    return [...this.view.values()];
  }

  /** What the document store does when the project closes. */
  closeProject() {
    this.open = false;
    this.view = new Map();
    this.changed();
  }

  reopenProject() {
    this.open = true;
    this.readDisk();
    this.changed();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  /** Typing, or anything else that edits a loaded file. */
  setText(path: string, content: string) {
    const file = this.view.get(path);
    if (!file || file.content === content) return;
    this.view.set(path, {
      ...file,
      content,
      size: content.length,
      dirty: true,
    });
    this.changed();
  }

  /** Autosave. */
  save() {
    for (const [path, file] of this.view) {
      if (!file.dirty || file.content === undefined) continue;
      this.disk.set(path, file.content);
      this.view.set(path, { ...file, dirty: false });
    }
    this.changed();
  }

  async writeText(path: string, content: string) {
    this.disk.set(path, content);
  }

  async upload(path: string) {
    const bytes = this.disk.get(path) ?? "";
    const blobId = textHash(bytes).padStart(64, "0");
    this.relay.blobs.set(blobId, bytes);
    return { blobId, size: bytes.length };
  }

  async download(path: string, blobId: string) {
    const bytes = this.relay.blobs.get(blobId);
    if (bytes === undefined) throw new Error("no such blob");
    this.disk.set(path, bytes);
  }

  async move(from: string, to: string) {
    const content = this.disk.get(from);
    if (content === undefined) throw new Error(`no ${from}`);
    this.disk.delete(from);
    this.disk.set(to, content);
  }

  async remove(path: string) {
    this.disk.delete(path);
  }

  async refresh() {
    this.readDisk();
    this.changed();
  }

  private readDisk() {
    const next = new Map<string, LocalFile>();
    for (const [path, content] of this.disk) {
      const current = this.view.get(path);
      if (current?.dirty) {
        next.set(path, current);
        continue;
      }
      const file: LocalFile = FakeWorkspace.isBinary(path)
        ? { path, kind: "blob", size: content.length, dirty: false }
        : { path, kind: "text", content, size: content.length, dirty: false };
      const same =
        current &&
        current.kind === file.kind &&
        current.content === file.content &&
        current.size === file.size;
      next.set(path, same ? current : file);
    }
    this.view = next;
  }

  /** The user (or another program) changing the folder. */
  async userWrites(path: string, content: string) {
    this.disk.set(path, content);
    await this.refresh();
  }
  async userDeletes(path: string) {
    this.disk.delete(path);
    await this.refresh();
  }
  async userMoves(from: string, to: string) {
    await this.move(from, to);
    await this.refresh();
  }

  snapshot() {
    return Object.fromEntries([...this.disk].sort());
  }
}

/** One copy of the app with the project open. */
class Device {
  outbox: Uint8Array[] = [];
  session: SharedSession | null = null;
  sync: ProjectSync | null = null;
  saved: { seq: number; local: string; state: Uint8Array } | null = null;
  errors: string[] = [];
  /** Where overlapping edits were found on catching up. */
  conflicts: Array<{ path: string; from: number }> = [];
  private buffered: SyncEvent[] | null = null;

  constructor(
    readonly relay: FakeRelay,
    readonly workspace: FakeWorkspace,
    readonly name = "Someone",
  ) {}

  get after() {
    return this.session?.seq ?? 0;
  }

  receive(event: SyncEvent) {
    if (this.buffered) this.buffered.push(event);
    else this.session?.handle(event);
  }

  /** Opens the project the way collab-store does. */
  async open({
    online = true,
    name,
  }: {
    online?: boolean;
    name?: string;
  } = {}) {
    const relay = this.relay;
    const session = new SharedSession(
      {
        publish: (update) => {
          if (relay.isOnline(this)) relay.store(this, update);
          else this.outbox.push(update);
        },
        awareness: (data) => {
          if (relay.isOnline(this)) relay.awareness(this, data);
        },
        compact: (upTo, data) => {
          relay.snapshot = { upTo, data };
          relay.log = relay.log.filter((e) => e.seq > upTo);
        },
        save: async (seq, local, state) => {
          this.saved = { seq, local, state };
        },
      },
      {
        local: () => this.sync?.knownFiles() ?? {},
        onConcurrentEdits: (base, mine, theirs) => {
          this.conflicts.push(
            ...settleConcurrentEdits(session.doc, base, mine, theirs, {
              name: this.name,
              color: "#000",
            }),
          );
        },
      },
    );
    if (this.saved) session.load(this.saved.seq, this.saved.state);
    this.session = session;
    const known: Known = this.saved ? JSON.parse(this.saved.local) : {};

    // Connected first so local changes have somewhere to go, but what the
    // relay sends waits until the folder has been settled.
    this.buffered = [];
    session.connecting();
    if (online) relay.connect(this);
    if (name) metaMap(session.doc).set("name", name);
    this.sync = new ProjectSync(session.doc, this.workspace, known, {
      onError: (message) => this.errors.push(message),
    });
    await this.sync.start();
    for (const event of this.buffered.splice(0)) session.handle(event);
    this.buffered = null;
    await this.settle();
  }

  async settle() {
    for (let i = 0; i < 5; i++) {
      await this.sync?.idle();
      await Promise.resolve();
    }
  }

  async close() {
    this.sync?.stop();
    // Goodbye first, so others stop showing this device right away.
    await this.session?.destroy();
    this.relay.disconnect(this);
    this.session = null;
    this.sync = null;
  }

  goOffline() {
    this.relay.disconnect(this);
  }

  goOnline() {
    this.relay.connect(this);
  }
}

async function settleAll(...devices: Device[]) {
  for (let round = 0; round < 3; round++) {
    for (const device of devices) {
      device.workspace.save();
      await device.settle();
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ───

describe("shared projects", () => {
  it("gives someone who joins every file, text and binary", async () => {
    const relay = new FakeRelay();
    const a = new Device(
      relay,
      new FakeWorkspace(relay, {
        "main.tex": "\\documentclass{article}",
        "figures/plot.png": "PNGDATA",
      }),
    );
    await a.open({ name: "Thesis" });

    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    await settleAll(a, b);

    expect(b.workspace.snapshot()).toEqual(a.workspace.snapshot());
    expect(metaMap(b.session!.doc).get("name")).toBe("Thesis");
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });

  it("merges changes made while offline, without an authoritative copy", async () => {
    const relay = new FakeRelay();
    const a = new Device(
      relay,
      new FakeWorkspace(relay, {
        "main.tex": "Intro.\nMethods.\nResults.",
        "plot.png": "OLDPNG",
      }),
    );
    await a.open();
    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    await settleAll(a, b);

    b.goOffline();
    // A, online: edits the first line, adds a bibliography.
    a.workspace.setText("main.tex", "Introduction.\nMethods.\nResults.");
    await a.workspace.userWrites("refs.bib", "@book{knuth}");
    // B, offline: edits the last line, moves the figure, deletes nothing.
    b.workspace.setText("main.tex", "Intro.\nMethods.\nResults, finally.");
    await b.workspace.userMoves("plot.png", "figures/plot.png");
    await settleAll(a, b);
    expect(b.outbox.length).toBeGreaterThan(0);

    b.goOnline();
    await settleAll(a, b);

    const expected = {
      "figures/plot.png": "OLDPNG",
      "main.tex": "Introduction.\nMethods.\nResults, finally.",
      "refs.bib": "@book{knuth}",
    };
    expect(a.workspace.snapshot()).toEqual(expected);
    expect(b.workspace.snapshot()).toEqual(expected);
  });

  it("catches up on changes made while this device was closed", async () => {
    const relay = new FakeRelay();
    const a = new Device(relay, new FakeWorkspace(relay, { "main.tex": "v1" }));
    await a.open();
    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    await settleAll(a, b);
    await b.close();

    a.workspace.setText("main.tex", "v2 from A");
    await a.workspace.userDeletes("main.tex");
    await a.workspace.userWrites("chapter.tex", "new chapter");
    await settleAll(a);

    // B reopens later, whether or not A is still around.
    await a.close();
    await b.open();
    await settleAll(b);
    expect(b.workspace.snapshot()).toEqual({ "chapter.tex": "new chapter" });
  });

  it("picks up edits made outside the app while it was closed", async () => {
    const relay = new FakeRelay();
    const a = new Device(
      relay,
      new FakeWorkspace(relay, { "main.tex": "Hello" }),
    );
    await a.open();
    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    await settleAll(a, b);

    await a.close();
    // e.g. edited in another editor, or by Claude, with the app closed.
    a.workspace.disk.set("main.tex", "Hello from VS Code");
    await a.workspace.refresh();
    await a.open();
    await settleAll(a, b);
    expect(b.workspace.snapshot()).toEqual({
      "main.tex": "Hello from VS Code",
    });
  });

  it("doesn't mistake a disk that lagged behind for an outside edit", async () => {
    const relay = new FakeRelay();
    const a = new Device(
      relay,
      new FakeWorkspace(relay, { "main.tex": "saved" }),
    );
    await a.open();
    await settleAll(a);

    // Typed, the document was saved, but the app quit before autosave.
    a.workspace.setText("main.tex", "saved and more");
    await a.settle();
    await a.close();
    a.workspace.disk.set("main.tex", "saved");
    await a.workspace.refresh();

    await a.open();
    await settleAll(a);
    expect(a.workspace.snapshot()).toEqual({ "main.tex": "saved and more" });
  });

  it("keeps both files when two people create the same path offline", async () => {
    const relay = new FakeRelay();
    const a = new Device(relay, new FakeWorkspace(relay, { "main.tex": "x" }));
    await a.open();
    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    await settleAll(a, b);

    a.goOffline();
    b.goOffline();
    await a.workspace.userWrites("notes.tex", "A's notes");
    await b.workspace.userWrites("notes.tex", "B's notes");
    await settleAll(a, b);
    a.goOnline();
    b.goOnline();
    await settleAll(a, b);

    const onA = a.workspace.snapshot();
    expect(onA).toEqual(b.workspace.snapshot());
    expect(Object.values(onA).sort()).toEqual(["A's notes", "B's notes", "x"]);
    expect(Object.keys(onA)).toContain("notes.tex");
  });

  it("never deletes anyone's files when a project closes", async () => {
    const relay = new FakeRelay();
    const a = new Device(
      relay,
      new FakeWorkspace(relay, { "main.tex": "x", "fig.png": "PNG" }),
    );
    await a.open();
    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    await settleAll(a, b);

    // The store empties before the sync has been told to stop.
    a.workspace.closeProject();
    await settleAll(a, b);
    await a.close();
    expect(b.workspace.snapshot()).toEqual({
      "fig.png": "PNG",
      "main.tex": "x",
    });

    // Nor when the files haven't loaded yet on the way back in.
    a.workspace.reopenProject();
    const loaded = a.workspace.files();
    expect(loaded.length).toBe(2);
    await a.open();
    await settleAll(a, b);
    expect(b.workspace.snapshot()).toEqual({
      "fig.png": "PNG",
      "main.tex": "x",
    });
  });

  it("deletes and renames reach everyone", async () => {
    const relay = new FakeRelay();
    const a = new Device(
      relay,
      new FakeWorkspace(relay, { "old.tex": "keep me", "draft.tex": "bin me" }),
    );
    await a.open();
    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    await settleAll(a, b);

    await b.workspace.userMoves("old.tex", "chapters/new.tex");
    await b.workspace.userDeletes("draft.tex");
    await settleAll(a, b);
    expect(a.workspace.snapshot()).toEqual({ "chapters/new.tex": "keep me" });

    // The rename kept the file's identity, so A's edits land in it.
    a.workspace.setText("chapters/new.tex", "keep me, edited");
    await settleAll(a, b);
    expect(b.workspace.snapshot()).toEqual({
      "chapters/new.tex": "keep me, edited",
    });
  });

  it("compacts the relay's log, and newcomers still get everything", async () => {
    const relay = new FakeRelay();
    const a = new Device(relay, new FakeWorkspace(relay, { "main.tex": "" }));
    await a.open();
    for (let i = 0; i < 1005; i++) {
      a.workspace.setText("main.tex", `edit ${i}`);
    }
    await settleAll(a);
    a.goOffline();
    a.goOnline(); // catching up again sees the long log
    await settleAll(a);
    expect(relay.snapshot).not.toBeNull();
    expect(relay.log.length).toBeLessThan(10);

    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    await settleAll(a, b);
    expect(b.workspace.snapshot()).toEqual({ "main.tex": "edit 1004" });
  });

  it("says syncing until caught up, and offline when the relay can't be reached", async () => {
    vi.useFakeTimers();
    const relay = new FakeRelay();
    const statuses: string[] = [];
    const session = new SharedSession(
      {
        publish: () => {},
        awareness: () => {},
        compact: () => {},
        save: async () => {},
      },
      { local: () => ({}), onStatus: (s) => statuses.push(s) },
    );
    session.connecting();
    expect(session.status).toBe("syncing");
    vi.advanceTimersByTime(OFFLINE_AFTER_MS);
    expect(session.status).toBe("offline");
    session.handle({
      type: "caughtUp",
      seq: relay.head,
      logEntries: 0,
      logBytes: 0,
      pending: 0,
      chatDays: 30,
    });
    expect(session.status).toBe("synced");
    session.handle({ type: "error", code: "gone" });
    expect(statuses).toEqual(["offline", "synced", "gone"]);
  });

  it("shares who's here, and forgets them when they leave", async () => {
    const relay = new FakeRelay();
    const a = new Device(relay, new FakeWorkspace(relay, { "main.tex": "" }));
    await a.open();
    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    a.session!.awareness.setLocalState({ user: { name: "Ana" } });
    b.session!.awareness.setLocalState({ user: { name: "Ben" } });
    const bId = b.session!.doc.clientID;
    expect(a.session!.awareness.getStates().get(bId)?.user.name).toBe("Ben");
    await b.close();
    expect(a.session!.awareness.getStates().has(bId)).toBe(false);
  });
});

describe("edits to the same text made out of sync", () => {
  async function pair(content: string) {
    const relay = new FakeRelay();
    const a = new Device(
      relay,
      new FakeWorkspace(relay, { "main.tex": content }),
      "Ana",
    );
    await a.open();
    const b = new Device(relay, new FakeWorkspace(relay), "Ben");
    await b.open();
    await settleAll(a, b);
    return { a, b };
  }

  function conflictsOn(device: Device) {
    return new SharedAnnotations(device.session!.doc)
      .rangesFor("main.tex")
      .filter((x) => x.suggestion);
  }

  it("keeps one version whole and marks it with the other", async () => {
    const { a, b } = await pair("Intro.\nThe results are good.\nEnd.");
    b.goOffline();
    a.workspace.setText("main.tex", "Intro.\nThe findings are mediocre.\nEnd.");
    b.workspace.setText("main.tex", "Intro.\nThe results are excellent.\nEnd.");
    await settleAll(a, b);
    b.goOnline();
    await settleAll(a, b);

    const expected = { "main.tex": "Intro.\nThe findings are mediocre.\nEnd." };
    expect(a.workspace.snapshot()).toEqual(expected);
    expect(b.workspace.snapshot()).toEqual(expected);
    expect(b.conflicts).toEqual([
      { path: "main.tex", from: expected["main.tex"].indexOf("mediocre") },
    ]);
    // Everyone sees it, with Ben's version.
    for (const device of [a, b]) {
      const [conflict] = conflictsOn(device);
      const text = device.workspace.snapshot()["main.tex"];
      expect(text.slice(conflict.from, conflict.to)).toBe("mediocre");
      expect(conflict.suggestion).toMatchObject({
        text: "excellent",
        author: "Ben",
      });
    }
  });

  it("uses the other version when asked, for everyone", async () => {
    const { a, b } = await pair("The results are good.");
    b.goOffline();
    a.workspace.setText("main.tex", "The results are mediocre.");
    b.workspace.setText("main.tex", "The results are excellent.");
    await settleAll(a, b);
    b.goOnline();
    await settleAll(a, b);

    const [conflict] = conflictsOn(a);
    new SharedAnnotations(a.session!.doc).settleSuggestion(conflict.id, true, {
      name: "Ana",
      color: "#000",
    });
    await settleAll(a, b);
    const expected = { "main.tex": "The results are excellent." };
    expect(a.workspace.snapshot()).toEqual(expected);
    expect(b.workspace.snapshot()).toEqual(expected);
    expect(conflictsOn(b).every((c) => c.suggestion?.settled)).toBe(true);
  });

  it("keeps an edit to text someone else deleted meanwhile", async () => {
    const { a, b } = await pair("Keep. Drop this. Keep.");
    b.goOffline();
    a.workspace.setText("main.tex", "Keep. Keep.");
    b.workspace.setText("main.tex", "Keep. Drop this, edited. Keep.");
    await settleAll(a, b);
    b.goOnline();
    await settleAll(a, b);

    expect(a.workspace.snapshot()["main.tex"]).toBe(
      "Keep. Drop this, edited. Keep.",
    );
    const [conflict] = conflictsOn(a);
    expect(conflict.suggestion).toMatchObject({ text: "", author: "" });
  });

  it("marks nothing when the edits were to different parts", async () => {
    const { a, b } = await pair("Intro.\nMethods.\nResults.");
    b.goOffline();
    a.workspace.setText("main.tex", "Introduction.\nMethods.\nResults.");
    b.workspace.setText("main.tex", "Intro.\nMethods.\nResults, finally.");
    await settleAll(a, b);
    b.goOnline();
    await settleAll(a, b);

    expect(b.workspace.snapshot()["main.tex"]).toBe(
      "Introduction.\nMethods.\nResults, finally.",
    );
    expect(b.conflicts).toEqual([]);
    expect(conflictsOn(a)).toEqual([]);
  });

  it("catches an edit made outside the app while it was closed", async () => {
    const { a, b } = await pair("The results are good.");
    await b.close();
    a.workspace.setText("main.tex", "The results are mediocre.");
    await settleAll(a);
    // e.g. in another editor, with the app closed.
    b.workspace.disk.set("main.tex", "The results are excellent.");
    await b.workspace.refresh();
    await b.open();
    await settleAll(a, b);

    expect(b.workspace.snapshot()["main.tex"]).toBe(
      "The results are mediocre.",
    );
    expect(conflictsOn(b)[0]?.suggestion?.text).toBe("excellent");
  });
});

describe("the shared document", () => {
  it("numbers colliding paths the same way everywhere", () => {
    expect(numberedPath("figures/plot.png", 2)).toBe("figures/plot (2).png");
    expect(numberedPath("Makefile", 3)).toBe("Makefile (3)");
    expect(numberedPath("v1.2/notes", 2)).toBe("v1.2/notes (2)");

    const doc = new Y.Doc();
    const files = doc.getMap<Y.Map<unknown>>("files");
    for (const id of ["b", "a"]) {
      const entry = new Y.Map<unknown>();
      entry.set("path", "x.tex");
      entry.set("kind", "text");
      entry.set("text", new Y.Text(id));
      files.set(id, entry);
    }
    const placed = layout(doc);
    expect(placed.get("x.tex")?.fileId).toBe("a");
    expect(placed.get("x (2).tex")?.fileId).toBe("b");
  });

  it("applyTextChange keeps concurrent edits and surrogate pairs intact", () => {
    const apply = (from: string, to: string) => {
      const text = new Y.Doc().getText("t");
      text.insert(0, from);
      applyTextChange(text, to);
      return text.toString();
    };
    expect(apply("abc", "abXc")).toBe("abXc");
    expect(apply("x😀y", "x😁y")).toBe("x😁y");
    expect(apply("😀", "😀😀")).toBe("😀😀");

    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("t").insert(0, "one two three");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyTextChange(a.getText("t"), "ONE two three");
    applyTextChange(b.getText("t"), "one two THREE");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText("t").toString()).toBe("ONE two THREE");
  });

  it("does not double up typing in a bound editor", async () => {
    const relay = new FakeRelay();
    const a = new Device(
      relay,
      new FakeWorkspace(relay, { "main.tex": "Hello" }),
    );
    await a.open();
    const text = a.sync!.textAt("main.tex")!.text;

    // As latex-editor.tsx does: the editor edits the shared text and writes
    // its content to the store after every change.
    const view = new EditorView({
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          yCollab(text, null),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              a.workspace.setText("main.tex", update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.dispatch({ changes: { from: 5, insert: " world" } });
    expect(text.toString()).toBe("Hello world");

    const b = new Device(relay, new FakeWorkspace(relay));
    await b.open();
    b.workspace.setText("main.tex", "Oh, Hello world");
    await settleAll(a, b);
    expect(view.state.doc.toString()).toBe("Oh, Hello world");
    expect(a.workspace.snapshot()).toEqual({ "main.tex": "Oh, Hello world" });
    view.destroy();
  });
});
