import { describe, it, expect } from "vitest";
import {
  MAX_COMMITS,
  buildNotes,
  commitNotes,
  extractChangelogSection,
  toPlainText,
} from "../../../../../scripts/release-notes.mjs";

describe("release-notes", () => {
  describe("extractChangelogSection", () => {
    const changelog = [
      "# Changelog",
      "",
      "## [1.4.0] - 2026-09-14",
      "",
      "### Fixed",
      "",
      "- Titles no longer overlap previews",
      "",
      "## [1.3.0]",
      "",
      "- Something older",
      "",
    ].join("\n");

    it("returns only the requested version's body", () => {
      const section = extractChangelogSection(changelog, "1.4.0");
      expect(section).toContain("Titles no longer overlap previews");
      // Must stop at the next version, or every release ships the whole file.
      expect(section).not.toContain("Something older");
    });

    it("keeps subsection headings inside the section", () => {
      expect(extractChangelogSection(changelog, "1.4.0")).toContain(
        "### Fixed",
      );
    });

    it("drops the version heading itself", () => {
      expect(extractChangelogSection(changelog, "1.4.0")).not.toContain(
        "## [1.4.0]",
      );
    });

    it("accepts the heading spellings a changelog picks up over time", () => {
      // A release must not fail to build over punctuation drift.
      for (const heading of [
        "## [1.4.0]",
        "## [1.4.0] - 2026-09-14",
        "## [v1.4.0]",
        "## 1.4.0",
        "## \\[1.4.0]", // the escaped form the old upstream file used
      ]) {
        const body = `${heading}\n\n- A change\n`;
        expect(extractChangelogSection(body, "1.4.0")).toBe("- A change");
      }
    });

    it("does not match a different version that shares a prefix", () => {
      const body = "## [1.4.10]\n\n- Ten\n";
      expect(extractChangelogSection(body, "1.4.1")).toBeNull();
    });

    it("returns null for a missing version", () => {
      expect(extractChangelogSection(changelog, "9.9.9")).toBeNull();
    });

    it("returns null for a heading with an empty body", () => {
      // An empty section is as useless as a missing one, so it must fail the
      // build rather than ship blank notes.
      expect(
        extractChangelogSection("## [1.4.0]\n\n## [1.3.0]\n", "1.4.0"),
      ).toBeNull();
    });
  });

  describe("commitNotes", () => {
    it("lists subjects under a header naming the baseline", () => {
      const notes = commitNotes(["Fix a thing", "Add a thing"], "v1.3.0");
      expect(notes).toContain("Changes since v1.3.0:");
      expect(notes).toContain("- Fix a thing");
      expect(notes).toContain("- Add a thing");
    });

    it("de-duplicates repeated subjects", () => {
      // A cherry-pick or rebase can land the same subject twice; showing it
      // twice reads as a broken changelog.
      const notes = commitNotes(["Same", "Same", "Other"], "v1.0.0");
      expect(notes.match(/- Same/g)).toHaveLength(1);
    });

    it("summarises once past the cap", () => {
      const many = Array.from(
        { length: MAX_COMMITS + 5 },
        (_, i) => `Commit ${i}`,
      );
      const notes = commitNotes(many, "v1.0.0");
      expect(notes).toContain("- Commit 0");
      expect(notes).toContain("…and 5 more.");
      expect(notes).not.toContain(`- Commit ${MAX_COMMITS + 4}`);
    });

    it("says so when there is nothing new", () => {
      expect(commitNotes([], "v1.3.0")).toContain("No code changes");
    });

    it("copes with no previous release at all", () => {
      expect(commitNotes(["First"], null)).toContain("Changes in this build:");
    });
  });

  describe("toPlainText", () => {
    it("strips markup the update dialog cannot render", () => {
      const plain = toPlainText(
        "### Fixed\n\n- **Bold** and `code` and [a link](https://example.com)",
      );
      expect(plain).toContain("Fixed");
      expect(plain).not.toContain("###");
      expect(plain).toContain("Bold and code and a link");
      expect(plain).not.toContain("**");
      expect(plain).not.toContain("](");
    });

    it("keeps bullets, which read fine as plain text", () => {
      expect(toPlainText("- One\n- Two")).toBe("- One\n- Two");
    });

    it("collapses runs of blank lines", () => {
      expect(toPlainText("A\n\n\n\nB")).toBe("A\n\nB");
    });
  });

  describe("buildNotes", () => {
    const runGit = (args) =>
      args[0] === "tag" ? "v1.3.0\nv1.2.0" : "Subject one\nSubject two";

    it("uses the changelog on the release channel", () => {
      const notes = buildNotes({
        channel: "release",
        version: "1.4.0",
        changelog: "## [1.4.0]\n\n- Hand written\n",
      });
      expect(notes).toBe("- Hand written");
    });

    it("refuses to build a release with no changelog entry", () => {
      expect(() =>
        buildNotes({
          channel: "release",
          version: "1.4.0",
          changelog: "# Changelog\n",
        }),
      ).toThrow(/no section for 1\.4\.0/);
    });

    it("uses commits since the last stable release on the test channel", () => {
      const notes = buildNotes({ channel: "test", changelog: "", runGit });
      expect(notes).toContain("Changes since v1.3.0:");
      expect(notes).toContain("- Subject one");
    });
  });
});
