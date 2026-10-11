import { describe, expect, it } from "vitest";
import golden from "./__fixtures__/markdownify.json";
import { htmlToMarkdown } from "./markdownify";

describe("Zotero notes to Markdown, as Python's markdownify writes them", () => {
  it.each(golden.map((g, i) => [i, g.html, g.md]))("case %i", (_, html, md) => {
    expect(htmlToMarkdown(html as string)).toBe(md);
  });
});
