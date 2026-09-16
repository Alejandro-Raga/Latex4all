import { describe, expect, it } from "vitest";
import { create } from "zustand";
import * as Y from "yjs";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { yCollab } from "y-codemirror.next";
import { CollabProvider } from "@/lib/collab/provider";
import {
  applyTextChange,
  bindProjectText,
  shareProjectText,
  sharedFiles,
  type SyncableFile,
} from "@/lib/collab/text-sync";

/** Stands in for the Rust relay: every message goes to everyone else. */
function createRelay() {
  const members: CollabProvider[] = [];
  const queue: Array<{ from: CollabProvider; message: Uint8Array }> = [];
  return {
    join(doc: Y.Doc) {
      const provider: CollabProvider = new CollabProvider(doc, {
        send: (message) => queue.push({ from: provider, message }),
      });
      members.push(provider);
      return provider;
    },
    leave(provider: CollabProvider) {
      members.splice(members.indexOf(provider), 1);
    },
    /** Delivers until nothing is left in flight. */
    flush() {
      while (queue.length > 0) {
        const { from, message } = queue.shift()!;
        for (const member of members) {
          if (member !== from) member.receive(message);
        }
      }
    },
  };
}

function createFileStore(files: SyncableFile[]) {
  return create<{
    files: SyncableFile[];
    updateFileContent: (id: string, content: string) => void;
  }>()((set) => ({
    files,
    updateFileContent: (id, content) =>
      set((s) => ({
        files: s.files.map((f) => (f.id === id ? { ...f, content } : f)),
      })),
  }));
}

const text = (doc: Y.Doc, path: string) =>
  sharedFiles(doc).get(path)?.toString();

describe("CollabProvider", () => {
  it("brings a late joiner up to date and merges concurrent edits", () => {
    const relay = createRelay();
    const hostDoc = new Y.Doc();
    shareProjectText(hostDoc, [
      { id: "main.tex", relativePath: "main.tex", content: "Hello world" },
    ]);
    const host = relay.join(hostDoc);
    host.connect();
    relay.flush();

    const guestDoc = new Y.Doc();
    const guest = relay.join(guestDoc);
    guest.connect();
    relay.flush();
    expect(text(guestDoc, "main.tex")).toBe("Hello world");

    // Both type at once, before either hears about the other.
    sharedFiles(hostDoc).get("main.tex")!.insert(0, ">> ");
    sharedFiles(guestDoc).get("main.tex")!.insert(11, "!");
    relay.flush();
    expect(text(hostDoc, "main.tex")).toBe(">> Hello world!");
    expect(text(guestDoc, "main.tex")).toBe(">> Hello world!");

    // A third person syncs even though the second answers their request too.
    const thirdDoc = new Y.Doc();
    const third = relay.join(thirdDoc);
    third.connect();
    relay.flush();
    expect(text(thirdDoc, "main.tex")).toBe(">> Hello world!");
    host.destroy();
    guest.destroy();
    third.destroy();
  });

  it("shares presence and removes it on leaving", () => {
    const relay = createRelay();
    const aDoc = new Y.Doc();
    const bDoc = new Y.Doc();
    const a = relay.join(aDoc);
    a.awareness.setLocalState({ user: { name: "Ana" } });
    a.connect();
    const b = relay.join(bDoc);
    b.awareness.setLocalState({ user: { name: "Ben" } });
    b.connect();
    relay.flush();

    expect(b.awareness.getStates().get(aDoc.clientID)?.user.name).toBe("Ana");
    expect(a.awareness.getStates().get(bDoc.clientID)?.user.name).toBe("Ben");

    b.destroy();
    relay.flush();
    relay.leave(b);
    expect(a.awareness.getStates().has(bDoc.clientID)).toBe(false);
    a.destroy();
  });

  it("ignores garbage instead of throwing", () => {
    const provider = new CollabProvider(new Y.Doc(), { send: () => {} });
    expect(() => provider.receive(new Uint8Array([0, 255, 255]))).not.toThrow();
    provider.destroy();
  });
});

describe("applyTextChange", () => {
  const apply = (from: string, to: string) => {
    const doc = new Y.Doc();
    const ytext = doc.getText("t");
    ytext.insert(0, from);
    applyTextChange(ytext, to);
    return ytext.toString();
  };

  it("produces the new text", () => {
    expect(apply("abc", "abXc")).toBe("abXc");
    expect(apply("aaaa", "aaa")).toBe("aaa");
    expect(apply("", "new")).toBe("new");
    expect(apply("gone", "")).toBe("");
  });

  it("does not split surrogate pairs", () => {
    expect(apply("x😀y", "x😁y")).toBe("x😁y");
    expect(apply("😀", "😀😀")).toBe("😀😀");
  });

  it("leaves a concurrent edit elsewhere intact", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("t").insert(0, "one two three");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyTextChange(a.getText("t"), "ONE two three");
    applyTextChange(b.getText("t"), "one two THREE");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText("t").toString()).toBe("ONE two THREE");
    expect(b.getText("t").toString()).toBe("ONE two THREE");
  });
});

describe("bindProjectText", () => {
  it("copies store edits to the shared text and remote edits to the store", () => {
    const doc = new Y.Doc();
    const store = createFileStore([
      { id: "main.tex", relativePath: "main.tex", content: "abc" },
      { id: "big.tex", relativePath: "big.tex" },
    ]);
    shareProjectText(doc, store.getState().files);
    expect(sharedFiles(doc).has("big.tex")).toBe(false);
    const unbind = bindProjectText(doc, store);

    store.getState().updateFileContent("main.tex", "abcd");
    expect(text(doc, "main.tex")).toBe("abcd");

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    sharedFiles(remote).get("main.tex")!.insert(0, "Z");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    expect(store.getState().files[0].content).toBe("Zabcd");
    expect(text(doc, "main.tex")).toBe("Zabcd");

    unbind();
    store.getState().updateFileContent("main.tex", "after");
    expect(text(doc, "main.tex")).toBe("Zabcd");
  });

  it("gives a guest the host's text, including files shared later", () => {
    const hostDoc = new Y.Doc();
    shareProjectText(hostDoc, [
      { id: "main.tex", relativePath: "main.tex", content: "unsaved edits" },
    ]);
    const guestDoc = new Y.Doc();
    Y.applyUpdate(guestDoc, Y.encodeStateAsUpdate(hostDoc));
    const store = createFileStore([
      { id: "main.tex", relativePath: "main.tex", content: "from disk" },
      { id: "refs.bib", relativePath: "refs.bib", content: "old" },
    ]);
    let membershipChanges = 0;
    bindProjectText(guestDoc, store, () => membershipChanges++);
    expect(store.getState().files[0].content).toBe("unsaved edits");

    const before = Y.encodeStateVector(guestDoc);
    shareProjectText(hostDoc, [
      { id: "refs.bib", relativePath: "refs.bib", content: "@book{x}" },
    ]);
    Y.applyUpdate(guestDoc, Y.encodeStateAsUpdate(hostDoc, before));
    expect(store.getState().files[1].content).toBe("@book{x}");
    expect(membershipChanges).toBe(1);
  });

  it("does not double up typing in a bound editor", () => {
    const doc = new Y.Doc();
    const store = createFileStore([
      { id: "main.tex", relativePath: "main.tex", content: "Hello" },
    ]);
    shareProjectText(doc, store.getState().files);
    bindProjectText(doc, store);
    const ytext = sharedFiles(doc).get("main.tex")!;

    // The editor writes its doc to the store after every change, as
    // latex-editor.tsx's update listener does.
    const view = new EditorView({
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          yCollab(ytext, null),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              store
                .getState()
                .updateFileContent("main.tex", update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    view.dispatch({ changes: { from: 5, insert: " world" } });
    expect(ytext.toString()).toBe("Hello world");
    expect(store.getState().files[0].content).toBe("Hello world");

    // A remote edit reaches the view and the store once.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    sharedFiles(remote).get("main.tex")!.insert(0, "Oh, ");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    expect(view.state.doc.toString()).toBe("Oh, Hello world");
    expect(store.getState().files[0].content).toBe("Oh, Hello world");

    // Something outside the editor (Claude, Zotero) writes to the store.
    store.getState().updateFileContent("main.tex", "Oh, Hello world.");
    expect(ytext.toString()).toBe("Oh, Hello world.");
    expect(view.state.doc.toString()).toBe("Oh, Hello world.");
    view.destroy();
  });
});
