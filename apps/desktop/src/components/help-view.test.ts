import { describe, expect, it } from "vitest";
import helpText from "@/content/help.md?raw";
import { helpSections, searchHelp, targetOf } from "./help-view";

const SETTINGS = [
  "provider",
  "ai-usage",
  "skills",
  "appearance",
  "editor",
  "pdf",
  "zotero",
  "vault",
  "environment",
  "languages",
  "updates",
];

describe("the help", () => {
  const sections = helpSections(helpText);

  it("has its sections, each with text", () => {
    expect(sections.map((s) => s.title)).toContain("Getting started");
    expect(sections.map((s) => s.title)).toContain("Keyboard shortcuts");
    for (const s of sections) expect(s.body.length).toBeGreaterThan(40);
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
  });

  it("only links to places that exist", () => {
    const links = [...helpText.matchAll(/\]\((app:[^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const target = targetOf(link);
      expect(target, link).not.toBeNull();
      if (target?.kind === "settings") {
        expect(SETTINGS).toContain(target.section);
      }
    }
  });

  it("finds sections by any word in them", () => {
    const found = searchHelp(sections, "highlight color");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((s) => /highlight/i.test(s.body + s.title))).toBe(true);
    expect(searchHelp(sections, "")).toHaveLength(sections.length);
    expect(searchHelp(sections, "xyzzy")).toHaveLength(0);
  });
});
