import { expect, it } from "vitest";
import { useDocumentStore } from "@/stores/document-store";
import { documentStoreWorkspace } from "./store-workspace";

const file = (relativePath: string, content: string) =>
  ({
    id: relativePath,
    relativePath,
    name: relativePath,
    type: "other",
    content,
    isDirty: false,
  }) as never;

it("a shared project never takes another project's files for its own, mid-switch", () => {
  useDocumentStore.setState({
    projectRoot: "/p/Shared",
    files: [file("Plan.md", "# Shared\n\n- [ ] Its tasks")],
  } as never);
  const ws = documentStoreWorkspace("/p/Shared", "link");
  let heard = 0;
  const off = ws.subscribe(() => heard++);
  expect(ws.files()[0].content).toContain("Its tasks");

  // Another project opening: its root and files in one step, as the app does.
  useDocumentStore.setState({
    projectRoot: "/p/Other",
    files: [file("Plan.md", "# Other\n\n- [ ] Not these")],
  } as never);
  // Not a change of the shared project's: nothing sent, its files as last seen.
  expect(ws.files()[0].content).toContain("Its tasks");
  expect(ws.available()).toBe(false);
  off();
  // Not heard as a change of the shared project (it used to be, and sent).
  expect(heard).toBe(0);
});

it("another computer's typing in the project being left never lands in the next one", () => {
  useDocumentStore.setState({
    projectRoot: "/p/Shared",
    files: [file("main.tex", "the shared project's text")],
  } as never);
  const ws = documentStoreWorkspace("/p/Shared", "link");
  useDocumentStore.setState({
    projectRoot: "/p/Other",
    files: [file("main.tex", "the other project's text")],
  } as never);
  // Its sync, still running a moment after the switch, sets main.tex.
  ws.setText("main.tex", "the shared project's text, edited elsewhere");
  expect(useDocumentStore.getState().files[0].content).toBe(
    "the other project's text",
  );
});
