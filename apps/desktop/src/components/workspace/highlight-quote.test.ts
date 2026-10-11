import { describe, expect, it } from "vitest";
import { thought } from "@/lib/vault/zotero-sync/model";
import { FADED_HREF, vaultMarkdown } from "@/lib/vault/render";
import {
  highlightOf,
  notesByHighlight,
  type QuoteNode,
} from "./highlight-quote";
import type { VaultIndex } from "@/lib/vault/vault-index";

const text = (value: string): QuoteNode => ({ type: "text", value });
const a = (href: string, label: string): QuoteNode => ({
  type: "element",
  tagName: "a",
  properties: { href },
  children: [text(label)],
});
const quote = (...children: QuoteNode[]): QuoteNode => ({
  type: "element",
  tagName: "blockquote",
  children: [{ type: "element", tagName: "p", children }],
});

describe("a comment under a highlight", () => {
  it("is shown faded, not as HTML", () => {
    const md = vaultMarkdown(thought("Useful to split <the> sample & more"));
    expect(md).toBe(`[Useful to split <the> sample & more](${FADED_HREF})`);
    expect(md).not.toContain("<em");
  });

  it("keeps the links in it", () => {
    expect(vaultMarkdown(thought("See [[Topic A]] here"))).toContain(
      "*[Topic A](vault:Topic%20A)*",
    );
  });
});

describe("a highlight quoted in a note", () => {
  it("is read from a paper note's quote", () => {
    const h = highlightOf(
      quote(
        text("Firms spend on R&D.\n— "),
        a(
          "zotero://open-pdf/library/items/PDF00001?page=7&annotation=ANN00001",
          "p. 7",
        ),
      ),
    );
    expect(h).toMatchObject({
      attachmentKey: "PDF00001",
      annotationKey: "ANN00001",
      pageIndex: 6,
      pageLabel: "7",
      paperName: null,
      text: "Firms spend on R&D.",
    });
  });

  it("is read from a topic's passage, with its paper", () => {
    const h = highlightOf(
      quote(
        text("A passage.\n— "),
        a("vault:Arora2018", "Arora2018, p. 3"),
        text(" · "),
        a(
          "zotero://open-pdf/library/items/PDF00001?page=3&annotation=ANN00002",
          "PDF",
        ),
      ),
    );
    expect(h).toMatchObject({
      paperName: "Arora2018",
      pageLabel: "3",
      text: "A passage.",
    });
  });

  it("isn't one when the quote has no highlight link", () => {
    expect(highlightOf(quote(text("Just a quote")))).toBeNull();
  });

  it("is found in every note quoting it", () => {
    const index = {
      list: [
        { path: "a.md", body: "x annotation=ANN00001 y annotation=ANN00001" },
        { path: "b.md", body: "annotation=ANN00001" },
      ],
    } as unknown as VaultIndex;
    expect(
      notesByHighlight(index)
        .get("ANN00001")
        ?.map((n) => n.path),
    ).toEqual(["a.md", "b.md"]);
  });
});
