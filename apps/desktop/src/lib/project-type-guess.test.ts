import { describe, expect, it } from "vitest";
import { typeOfDocumentClass } from "./project-meta";

describe("a project's type from its document class", () => {
  it("reads the common classes", () => {
    const of = (cls: string, opts = "") =>
      typeOfDocumentClass(`% x\n\\documentclass${opts}{${cls}}\n`);
    expect(of("article", "[12pt]")).toBe("Article");
    expect(of("elsarticle")).toBe("Article");
    expect(of("beamer")).toBe("Presentation");
    expect(of("report")).toBe("Report");
    expect(of("book")).toBe("Book");
    expect(of("moderncv")).toBe("CV");
    expect(of("scrlttr2")).toBe("Letter");
    expect(of("phdthesis")).toBe("Thesis");
    expect(of("standalone")).toBe(null);
    expect(typeOfDocumentClass("no class here")).toBe(null);
  });
});
