import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  mapPosition,
  quoteOf,
  reanchor,
  textDiff,
} from "@/lib/annotations/anchoring";
import {
  type AnnotationFile,
  LocalAnnotations,
  type ProjectText,
} from "@/lib/annotations/local-annotations";
import { SharedAnnotations } from "@/lib/annotations/shared-annotations";
import { clearHighlights } from "@/lib/annotations/actions";
import type { Author } from "@/lib/annotations/types";
import {
  addTextFile,
  applyTextChange,
  filesMap,
} from "@/lib/collab/project-doc";

const ana: Author = { name: "Ana", color: "#e11d48" };
const ben: Author = { name: "Ben", color: "#2563eb" };

/** What's highlighted, as text. */
function spans(
  text: string,
  source: { rangesFor(path: string): Array<{ from: number; to: number }> },
  path = "main.tex",
) {
  return source.rangesFor(path).map((a) => text.slice(a.from, a.to));
}

describe("anchoring", () => {
  it("moves a highlight with edits, without growing it from outside", () => {
    const text = "The quick brown fox";
    const [from, to] = [4, 9]; // "quick"
    const apply = (next: string) => {
      const change = textDiff(text, next)!;
      return next.slice(
        mapPosition(from, change, 1),
        mapPosition(to, change, -1),
      );
    };
    expect(apply("Oh, The quick brown fox")).toBe("quick");
    expect(apply("The very quick brown fox")).toBe("quick"); // typed right before
    expect(apply("The quickest brown fox")).toBe("quick"); // typed right after
    expect(apply("The qu-ick brown fox")).toBe("qu-ick"); // typed inside
    expect(apply("The brown fox")).toBe(""); // deleted
  });

  it("finds quoted words again after an outside edit", () => {
    const before = "alpha beta gamma. alpha beta delta.";
    const second = before.lastIndexOf("beta");
    const quote = quoteOf(before, second, second + 4);
    const after = `Intro. ${before}`;
    const found = reanchor(after, second, second + 4, quote)!;
    expect(found.from).toBe(after.lastIndexOf("beta"));
    expect(reanchor("nothing like it", second, second + 4, quote)).toBeNull();
  });
});

describe("annotations in a project that isn't shared", () => {
  function project(files: Record<string, string>) {
    let listeners: Array<() => void> = [];
    const text: ProjectText & { set(path: string, content?: string): void } = {
      contentOf: (path) => files[path],
      write(path, content) {
        text.set(path, content);
      },
      paths: () => Object.keys(files),
      subscribe: (listener) => {
        listeners.push(listener);
        return () => {
          listeners = listeners.filter((l) => l !== listener);
        };
      },
      set(path, content) {
        if (content === undefined) delete files[path];
        else files[path] = content;
        for (const l of listeners) l();
      },
    };
    let saved: string | null = null;
    const file: AnnotationFile = {
      read: async () => saved,
      write: async (json) => {
        saved = json;
      },
    };
    return { files, text, file };
  }

  it("accepts and rejects suggested edits, and keeps them across reopening", async () => {
    const p = project({ "main.tex": "We prove the theorem." });
    const notes = await LocalAnnotations.load(p.file, p.text);
    const from = p.files["main.tex"].indexOf("prove");
    notes.suggest("main.tex", from, from + 5, "show", ana);
    const rejected = notes.suggest("main.tex", 0, 2, "One", ana)!;
    await notes.flush();

    const reopened = await LocalAnnotations.load(p.file, p.text);
    const [first] = reopened
      .rangesFor("main.tex")
      .filter((a) => a.suggestion?.text === "show");
    reopened.settleSuggestion(first.id, true, ben);
    reopened.settleSuggestion(rejected, false, ben);
    expect(p.files["main.tex"]).toBe("We show the theorem.");
    expect(reopened.rangesFor("main.tex")).toEqual([]);
  });

  it("keeps highlights on their words as the text is edited, and across reopening", async () => {
    const p = project({ "main.tex": "We prove the theorem." });
    const notes = await LocalAnnotations.load(p.file, p.text);
    const from = p.files["main.tex"].indexOf("theorem");
    const id = notes.add("main.tex", from, from + 7, "green", {
      author: ana,
      text: "Which one?",
    })!;
    notes.addComment(id, ben, "The second.");

    p.text.set("main.tex", "Here we prove the main theorem.");
    expect(spans(p.files["main.tex"], notes)).toEqual(["theorem"]);
    await notes.flush();
    notes.destroy();

    // Edited in another program while the app was closed.
    p.files["main.tex"] = "Abstract.\n\nHere we prove the main theorem.";
    const reopened = await LocalAnnotations.load(p.file, p.text);
    expect(spans(p.files["main.tex"], reopened)).toEqual(["theorem"]);
    const [note] = reopened.rangesFor("main.tex");
    expect(note.color).toBe("green");
    expect(note.comments.map((c) => `${c.author}: ${c.text}`)).toEqual([
      "Ana: Which one?",
      "Ben: The second.",
    ]);
  });

  it("follows a renamed file, and hides notes whose words are gone", async () => {
    const p = project({ "a.tex": "alpha beta gamma" });
    const notes = await LocalAnnotations.load(p.file, p.text);
    notes.add("a.tex", 6, 10, "yellow"); // "beta"
    p.text.set("a.tex");
    p.text.set("chapters/a.tex", "alpha beta gamma");
    expect(spans(p.files["chapters/a.tex"], notes, "chapters/a.tex")).toEqual([
      "beta",
    ]);

    p.text.set("chapters/a.tex", "alpha gamma");
    expect(notes.rangesFor("chapters/a.tex")).toEqual([]);
  });
});

describe("annotations in a shared project", () => {
  /** Two devices whose documents exchange every update. */
  function pair(content: string) {
    const a = new Y.Doc();
    addTextFile(a, "main.tex", content);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    let online = true;
    const outboxA: Uint8Array[] = [];
    const outboxB: Uint8Array[] = [];
    a.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      if (online) Y.applyUpdate(b, u, "remote");
      else outboxA.push(u);
    });
    b.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      if (online) Y.applyUpdate(a, u, "remote");
      else outboxB.push(u);
    });
    const textOf = (doc: Y.Doc) =>
      [...filesMap(doc).values()][0].get("text") as Y.Text;
    return {
      a,
      b,
      textOf,
      offline() {
        online = false;
      },
      online() {
        online = true;
        for (const u of outboxA.splice(0)) Y.applyUpdate(b, u, "remote");
        for (const u of outboxB.splice(0)) Y.applyUpdate(a, u, "remote");
      },
    };
  }

  it("shows the same highlights and threads on every device", () => {
    const p = pair("Results are significant.");
    const onA = new SharedAnnotations(p.a);
    const onB = new SharedAnnotations(p.b);
    let changesSeenByB = 0;
    onB.subscribe(() => changesSeenByB++);

    const from = "Results are ".length;
    const id = onA.add("main.tex", from, from + 11, "pink", {
      author: ana,
      text: "p-value?",
    })!;
    expect(spans(p.textOf(p.b).toString(), onB)).toEqual(["significant"]);
    expect(changesSeenByB).toBeGreaterThan(0);

    // Replies written at the same time, one of them offline, are both kept.
    p.offline();
    onA.addComment(id, ana, "Also the sample size.");
    onB.addComment(id, ben, "p < 0.01");
    p.online();
    const threadA = onA.rangesFor("main.tex")[0].comments.map((c) => c.text);
    const threadB = onB.rangesFor("main.tex")[0].comments.map((c) => c.text);
    expect(threadA).toEqual(threadB);
    expect([...threadA].sort()).toEqual(
      ["Also the sample size.", "p < 0.01", "p-value?"].sort(),
    );

    onB.setResolved(id, true);
    expect(onA.rangesFor("main.tex")[0].resolved).toBe(true);
    onA.remove(id);
    expect(onB.rangesFor("main.tex")).toEqual([]);
  });

  it("suggests an edit that anyone can accept, for everyone", () => {
    const p = pair("Results are significant.");
    const onA = new SharedAnnotations(p.a);
    const onB = new SharedAnnotations(p.b);
    const from = "Results are ".length;
    onA.suggest("main.tex", from, from + 11, "suggestive", ana);

    const [seen] = onB.rangesFor("main.tex");
    expect(seen.suggestion).toMatchObject({
      text: "suggestive",
      author: "Ana",
    });
    expect(p.textOf(p.b).toString().slice(seen.from, seen.to)).toBe(
      "significant",
    );

    onB.settleSuggestion(seen.id, true, ben);
    expect(p.textOf(p.a).toString()).toBe("Results are suggestive.");
    expect(onA.rangesFor("main.tex")).toEqual([]);
  });

  it("leaves the text alone when a suggestion is rejected", () => {
    const p = pair("Results are significant.");
    const onA = new SharedAnnotations(p.a);
    const id = onA.suggest("main.tex", 0, 7, "", ana)!;
    onA.settleSuggestion(id, false, ben);
    expect(p.textOf(p.b).toString()).toBe("Results are significant.");
    expect(onA.rangesFor("main.tex")).toEqual([]);
  });

  it("keeps a suggestion's discussion as a resolved note on the new text", () => {
    const p = pair("Results are significant.");
    const onA = new SharedAnnotations(p.a);
    const onB = new SharedAnnotations(p.b);
    const from = "Results are ".length;
    const id = onA.suggest("main.tex", from, from + 11, "suggestive", ana)!;
    onB.addComment(id, ben, "Agreed, softer.");
    onB.settleSuggestion(id, true, ben);

    const [note] = onA.rangesFor("main.tex");
    expect(note.suggestion).toBeUndefined();
    expect(note.resolved).toBe(true);
    expect(note.comments.map((c) => c.text)).toEqual([
      "Agreed, softer.",
      "Accepted the suggestion.",
    ]);
    expect(spans(p.textOf(p.a).toString(), onA)).toEqual(["suggestive"]);
  });

  it("stays on its words while others edit around and inside it", () => {
    const p = pair("The quick brown fox");
    const onA = new SharedAnnotations(p.a);
    const onB = new SharedAnnotations(p.b);
    onA.add("main.tex", 4, 9, "yellow"); // "quick"

    const edit = (doc: Y.Doc, next: string) =>
      applyTextChange(p.textOf(doc), next);
    edit(p.b, "Oh, The quick brown fox");
    edit(p.a, "Oh, The very quick brown fox"); // right before
    edit(p.b, "Oh, The very quickest brown fox"); // right after
    edit(p.a, "Oh, The very qu-ickest brown fox"); // inside
    const text = p.textOf(p.a).toString();
    expect(spans(text, onA)).toEqual(["qu-ick"]);
    expect(spans(p.textOf(p.b).toString(), onB)).toEqual(["qu-ick"]);

    edit(p.b, "Oh, The very brown fox");
    expect(onA.rangesFor("main.tex")).toEqual([]);
  });

  it("forgets annotations of a deleted file without errors", () => {
    const p = pair("text");
    const onA = new SharedAnnotations(p.a);
    onA.add("main.tex", 0, 4, "blue");
    const [fileId] = [...filesMap(p.b).keys()];
    filesMap(p.b).delete(fileId);
    expect(onA.rangesFor("main.tex")).toEqual([]);
  });

  it("moves annotations into a project when it's shared, and back out", async () => {
    const doc = new Y.Doc();
    addTextFile(doc, "main.tex", "Alpha beta gamma");
    const shared = new SharedAnnotations(doc);
    shared.importLocal([
      {
        id: "n1",
        path: "main.tex",
        from: 6,
        to: 10,
        quote: quoteOf("Alpha beta gamma", 6, 10),
        color: "purple",
        resolved: false,
        comments: [
          {
            id: "c1",
            author: "Ana",
            authorColor: "#e11d48",
            text: "Greek",
            at: 1,
          },
        ],
      },
    ]);
    expect(spans("Alpha beta gamma", shared)).toEqual(["beta"]);
    const exported = shared.exportLocal(() => "Alpha beta gamma");
    expect(exported).toMatchObject([
      {
        id: "n1",
        path: "main.tex",
        from: 6,
        to: 10,
        color: "purple",
        quote: { exact: "beta" },
      },
    ]);
    expect(exported[0].comments[0].text).toBe("Greek");
  });
});

describe("drawing annotations in the editor", () => {
  it("keeps a note's glyph at the end of its highlight while typing after it", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { EditorView } = await import("@codemirror/view");
    const { annotationsExtension, annotationsField, setAnnotations } =
      await import("@/components/workspace/editor/annotations-extension");
    const view = new EditorView({
      state: EditorState.create({
        doc: "Alpha beta gamma",
        extensions: [annotationsExtension],
      }),
    });
    view.dispatch({
      effects: setAnnotations.of([
        {
          id: "n1",
          from: 6,
          to: 10,
          color: "yellow",
          resolved: false,
          comments: [
            { id: "c1", author: "Ana", authorColor: "#000", text: "?", at: 0 },
          ],
        },
      ]),
    });
    // Typed right after "beta", then more.
    view.dispatch({ changes: { from: 10, insert: "s" } });
    view.dispatch({ changes: { from: 11, insert: "!!" } });
    expect(view.state.doc.toString()).toBe("Alpha betas!! gamma");
    const glyphs: number[] = [];
    view.state
      .field(annotationsField)
      .decorations.between(0, view.state.doc.length, (from, _to, deco) => {
        if (deco.spec.widget) glyphs.push(from);
      });
    // Still right after "beta", not pushed along by the typing.
    expect(glyphs).toEqual([10]);
    view.destroy();
  });

  it("marks highlighted text, shows a glyph for notes, and follows typing", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { EditorView } = await import("@codemirror/view");
    const { annotationAt, annotationsExtension, setAnnotations } = await import(
      "@/components/workspace/editor/annotations-extension"
    );

    const a = new Y.Doc();
    addTextFile(a, "main.tex", "Alpha beta gamma delta");
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "remote") Y.applyUpdate(b, u, "remote");
    });
    const onA = new SharedAnnotations(a);
    const onB = new SharedAnnotations(b);

    // Bound to B's shared text the way the editor is, so typing reaches it.
    const { yCollab } = await import("y-codemirror.next");
    const textB = [...filesMap(b).values()][0].get("text") as Y.Text;
    const view = new EditorView({
      state: EditorState.create({
        doc: textB.toString(),
        extensions: [annotationsExtension, yCollab(textB, null)],
      }),
    });
    const refresh = () =>
      view.dispatch({ effects: setAnnotations.of(onB.rangesFor("main.tex")) });
    onB.subscribe(refresh);

    const highlight = onA.add("main.tex", 6, 10, "green")!; // "beta"
    const marked = () =>
      [...view.dom.querySelectorAll(".cm-annotation")].map(
        (el) => el.textContent,
      );
    expect(marked()).toEqual(["beta"]);
    expect(view.dom.querySelector(".cm-annotation-green")).not.toBeNull();
    expect(view.dom.querySelector(".cm-annotation-note")).toBeNull();

    // A collaborator's note makes the quiet glyph appear.
    onA.addComment(highlight, ana, "Greek letter");
    expect(view.dom.querySelector(".cm-annotation-note")).not.toBeNull();

    // Typing just before it moves it; hovering inside finds it.
    view.dispatch({ changes: { from: 6, insert: "big " } });
    expect(marked()).toEqual(["beta"]);
    expect(annotationAt(view.state, 12)?.id).toBe(highlight);
    expect(annotationAt(view.state, 2)).toBeNull();

    // Resolving greys it out, so it can still be found.
    onA.setResolved(highlight, true);
    expect(marked()).toEqual(["beta"]);
    expect(view.dom.querySelector(".cm-annotation-resolved")).not.toBeNull();
    expect(view.dom.querySelector(".cm-annotation-green")).toBeNull();
    expect(
      view.dom.querySelector(".cm-annotation-note-resolved"),
    ).not.toBeNull();
    expect(annotationAt(view.state, 12)?.id).toBe(highlight);
    view.destroy();
  });
});

describe("taking highlights off, and listing notes", () => {
  it("removes plain highlights but keeps notes, without their color", async () => {
    const doc = new Y.Doc();
    addTextFile(doc, "main.tex", "one two three four");
    addTextFile(doc, "intro.tex", "hello world");
    const source = new SharedAnnotations(doc);
    const plain = source.add("main.tex", 0, 3, "yellow")!; // "one"
    const noted = source.add("main.tex", 4, 7, "blue", {
      author: ana,
      text: "check",
    })!; // "two"
    const outside = source.add("main.tex", 14, 18, "pink")!; // "four"
    source.add("intro.tex", 0, 5, "green", { author: ben, text: "hi" });

    clearHighlights(source, "main.tex", 2, 5); // touches "one" and "two"
    const left = source.rangesFor("main.tex");
    expect(left.map((a) => a.id).sort()).toEqual([noted, outside].sort());
    expect(left.find((a) => a.id === noted)?.color).toBe("none");
    expect(left.find((a) => a.id === plain)).toBeUndefined();

    // The notes bar lists every file's.
    const all = source.listAll();
    expect(all.map((n) => n.path).sort()).toEqual([
      "intro.tex",
      "main.tex",
      "main.tex",
    ]);

    // A note with no color draws no highlight, but its glyph stays.
    const { EditorState } = await import("@codemirror/state");
    const { EditorView } = await import("@codemirror/view");
    const { annotationsExtension, setAnnotations } = await import(
      "@/components/workspace/editor/annotations-extension"
    );
    const view = new EditorView({
      state: EditorState.create({
        doc: "one two three four",
        extensions: annotationsExtension,
      }),
    });
    view.dispatch({ effects: setAnnotations.of(left) });
    expect(
      [...view.dom.querySelectorAll(".cm-annotation")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["four"]);
    expect(view.dom.querySelectorAll(".cm-annotation-note").length).toBe(1);
    view.destroy();
  });

  it("lists notes across files in a project that isn't shared", async () => {
    const files: Record<string, string> = { "a.tex": "alpha", "b.tex": "beta" };
    const text = {
      contentOf: (path: string) => files[path],
      write: () => {},
      paths: () => Object.keys(files),
      subscribe: () => () => {},
    };
    let saved: string | null = null;
    const local = await LocalAnnotations.load(
      {
        read: async () => saved,
        write: async (json) => {
          saved = json;
        },
      },
      text,
    );
    local.add("a.tex", 0, 5, "yellow", { author: ana, text: "first" });
    const plain = local.add("b.tex", 0, 4, "green")!;
    expect(
      local
        .listAll()
        .map((n) => n.path)
        .sort(),
    ).toEqual(["a.tex", "b.tex"]);
    clearHighlights(local, "b.tex", 0, 4);
    expect(local.listAll().map((n) => n.annotation.id)).not.toContain(plain);
  });
});
