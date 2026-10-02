import { describe, expect, it } from "vitest";
import { parseLog, sharedContext, shortAsk } from "./ai-memory";

const log = [
  {
    at: 100,
    who: "Claude",
    tab: "t1",
    ask: "Tighten the intro",
    files: ["main.tex"],
  },
  {
    at: 200,
    who: "Gemini",
    tab: "t2",
    ask: "Add a table of results",
    files: ["results.tex"],
  },
  { at: 300, who: "ChatGPT", tab: "t3", ask: "Explain section 2", files: [] },
];

describe("shared memory", () => {
  it("gives the memory when a chat starts, unless the service reads it itself", () => {
    const start = sharedContext({
      memory: "Use APA style.",
      log: [],
      tab: "t1",
      since: 0,
      startingChat: true,
      readsMemoryItself: false,
    });
    expect(start).toContain("AGENTS.md");
    expect(start).toContain("Use APA style.");
    const codex = sharedContext({
      memory: "Use APA style.",
      log: [],
      tab: "t1",
      since: 0,
      startingChat: true,
      readsMemoryItself: true,
    });
    expect(codex).not.toContain("Use APA style.");
  });

  it("tells a chat what the others did since its last turn", () => {
    const text = sharedContext({
      memory: null,
      log,
      tab: "t1",
      since: 150,
      startingChat: false,
      readsMemoryItself: false,
    });
    expect(text).toContain("Gemini");
    expect(text).toContain("changed results.tex");
    expect(text).toContain("ChatGPT");
    expect(text).not.toContain("Tighten the intro");
    expect(
      sharedContext({
        memory: null,
        log,
        tab: "t3",
        since: 300,
        startingChat: false,
        readsMemoryItself: false,
      }),
    ).toBe("");
  });

  it("reads the log, skipping broken lines", () => {
    const text = `${JSON.stringify(log[0])}\nnot json\n${JSON.stringify(log[1])}\n`;
    expect(parseLog(text).map((e) => e.who)).toEqual(["Claude", "Gemini"]);
  });

  it("keeps the ask short and drops the context labels", () => {
    expect(shortAsk("@main.tex:3-9\nRewrite this paragraph")).toBe(
      "Rewrite this paragraph",
    );
    expect(shortAsk("x".repeat(200))).toHaveLength(118);
  });
});
