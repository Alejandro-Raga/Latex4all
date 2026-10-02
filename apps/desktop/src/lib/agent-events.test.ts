import { describe, expect, it } from "vitest";
import {
  engineErrorMessage,
  isEngineErrorLine,
  newTranslateState,
  translateAgentLine,
} from "./agent-events";

const run = (engine: "codex" | "gemini", events: object[]) => {
  const st = newTranslateState();
  return events.flatMap((e) =>
    translateAgentLine(engine, JSON.stringify(e), st),
  );
};

describe("Codex events as chat messages", () => {
  it("translates a turn with a command, an edit and a reply", () => {
    const out = run("codex", [
      { type: "thread.started", thread_id: "T1" },
      { type: "turn.started" },
      {
        type: "item.started",
        item: {
          id: "c1",
          type: "command_execution",
          command: "ls",
          aggregated_output: "",
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "c1",
          type: "command_execution",
          command: "ls",
          aggregated_output: "main.tex",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "f1",
          type: "file_change",
          changes: [{ path: "/p/main.tex", kind: "update" }],
          status: "completed",
        },
      },
      {
        type: "item.completed",
        item: { id: "m1", type: "agent_message", text: "Done." },
      },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 1000,
          cached_input_tokens: 800,
          output_tokens: 50,
        },
      },
    ]);
    expect(out[0]).toMatchObject({
      type: "system",
      subtype: "init",
      session_id: "T1",
    });
    expect(out[1].message?.content?.[0]).toMatchObject({
      type: "tool_use",
      name: "Bash",
      input: { command: "ls" },
    });
    expect(out[2].message?.content?.[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "c1",
      content: "main.tex",
      is_error: false,
    });
    // The edit, as Claude's Edit tool so file review picks it up.
    expect(out[3].message?.content?.[0]).toMatchObject({
      type: "tool_use",
      name: "Edit",
      input: { file_path: "/p/main.tex" },
    });
    expect(out[4].message?.content?.[0]).toMatchObject({
      type: "tool_result",
      is_error: false,
    });
    expect(out[5].message?.content?.[0]).toEqual({
      type: "text",
      text: "Done.",
    });
    expect(out[6]).toMatchObject({
      type: "result",
      is_error: false,
      result: "Done.",
      usage: {
        input_tokens: 200,
        cache_read_input_tokens: 800,
        output_tokens: 50,
      },
    });
  });

  it("says so when an edit didn't land", () => {
    const out = run("codex", [
      {
        type: "item.completed",
        item: {
          id: "f1",
          type: "file_change",
          changes: [{ path: "C:\\p\\main.tex", kind: "update" }],
          status: "failed",
        },
      },
    ]);
    expect(out[1].message?.content?.[0]).toMatchObject({ is_error: true });
    expect(out[2].message?.content?.[0]).toEqual({
      type: "text",
      text: "⚠ ChatGPT couldn't write main.tex.",
    });
  });

  it("reports a failed turn as an error result", () => {
    const out = run("codex", [
      {
        type: "turn.failed",
        error: { message: "You've hit your usage limit." },
      },
    ]);
    expect(out[0]).toMatchObject({
      type: "result",
      is_error: true,
      result: "You've hit your usage limit.",
    });
  });
});

describe("Gemini events as chat messages", () => {
  it("streams text, maps its tools, and totals the tokens", () => {
    const out = run("gemini", [
      { type: "init", session_id: "S1", model: "gemini-2.5-pro" },
      { type: "message", role: "user", content: "Fix the intro" },
      { type: "message", role: "assistant", content: "Let me ", delta: true },
      { type: "message", role: "assistant", content: "look.", delta: true },
      {
        type: "tool_use",
        tool_name: "replace",
        tool_id: "t1",
        parameters: {
          file_path: "/p/intro.tex",
          old_string: "a",
          new_string: "b",
        },
      },
      { type: "tool_result", tool_id: "t1", status: "success", output: "ok" },
      { type: "message", role: "assistant", content: "Fixed.", delta: true },
      {
        type: "result",
        status: "success",
        stats: {
          input_tokens: 5000,
          output_tokens: 120,
          cached: 3000,
          models: { "gemini-2.5-pro": {} },
        },
      },
    ]);
    expect(out[0]).toMatchObject({
      type: "system",
      session_id: "S1",
      model: "gemini-2.5-pro",
    });
    // The user's own message is already in the chat.
    expect(out[1]).toMatchObject({
      type: "assistant",
      subtype: "streaming_delta",
    });
    expect(out[3].message?.content?.[0]).toMatchObject({
      type: "tool_use",
      name: "Edit",
      input: { file_path: "/p/intro.tex", old_string: "a", new_string: "b" },
    });
    expect(out[4].message?.content?.[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "t1",
    });
    expect(out[6]).toMatchObject({
      type: "result",
      result: "Fixed.",
      usage: {
        input_tokens: 2000,
        cache_read_input_tokens: 3000,
        output_tokens: 120,
      },
      modelUsage: { "gemini-2.5-pro": {} },
    });
  });

  it("reports an error result, and skips lines that aren't JSON", () => {
    const out = run("gemini", [
      { type: "result", status: "error", error: { message: "Quota exceeded" } },
    ]);
    expect(out[0]).toMatchObject({ is_error: true, result: "Quota exceeded" });
    expect(
      translateAgentLine(
        "gemini",
        "Loaded cached credentials.",
        newTranslateState(),
      ),
    ).toEqual([]);
  });
});

describe("engine errors", () => {
  it("explains Google's refusal of free Gemini CLI sign-ins", () => {
    expect(
      engineErrorMessage(
        "gemini",
        "An unexpected critical error occurred:IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.",
      ),
    ).toMatch(/Gemini API key/);
  });

  it("picks error lines, not chatter", () => {
    expect(isEngineErrorLine("YOLO mode is enabled.")).toBe(false);
    expect(isEngineErrorLine("    at throwIneligible (x.js:1)")).toBe(false);
    expect(isEngineErrorLine("Error authenticating: boom")).toBe(true);
  });
});
