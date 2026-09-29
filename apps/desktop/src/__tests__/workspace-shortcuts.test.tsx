import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import {
  useCommandPalette,
  useWorkspaceShortcuts,
} from "@/components/workspace/command-palette";
import { filterGraph, graphFor } from "@/components/workspace/vault-panel";
import { parseNote } from "@/lib/vault/parse";
import { buildVaultIndex } from "@/lib/vault/vault-index";
import { useDockStore } from "@/stores/dock-store";
import { useReadingStore } from "@/stores/reading-store";

const press = (init: KeyboardEventInit) =>
  act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { metaKey: true, ...init }),
    );
  });

it("drives the palette, side panels and PDF tabs from the keyboard", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  function Host() {
    useWorkspaceShortcuts();
    return null;
  }
  await act(async () =>
    createRoot(document.createElement("div")).render(<Host />),
  );

  await press({ key: "k" });
  expect(useCommandPalette.getState().open).toBe(true);
  await press({ key: "k" });
  expect(useCommandPalette.getState().open).toBe(false);

  useDockStore.setState({ open: { reference: false, vault: false } });
  await press({ altKey: true, key: "™", code: "Digit2" });
  expect(useDockStore.getState().open.vault).toBe(true);

  const r = useReadingStore.getState();
  r.open({ id: "a", label: "a", data: new Uint8Array() });
  r.open({ id: "b", label: "b", data: new Uint8Array() });
  r.activate("preview");
  await press({ shiftKey: true, key: "}", code: "BracketRight" });
  expect(useReadingStore.getState().active).toBe("a");
  await press({ shiftKey: true, key: "{", code: "BracketLeft" });
  await press({ shiftKey: true, key: "{", code: "BracketLeft" });
  expect(useReadingStore.getState().active).toBe("b");
});

it("hides a group from the map but keeps the note itself", () => {
  const index = buildVaultIndex([
    parseNote("Ideas/Centre.md", "[[Nelson1959]] [[Other idea]] [[Inbox]]"),
    parseNote("Papers/Nelson1959.md", "---\ncitekey: Nelson1959\n---\n"),
    parseNote("Ideas/Other idea.md", "x"),
    parseNote("Inbox.md", "y"),
  ]);
  const graph = graphFor(index, "Centre", 1);
  expect([...graph.groups.keys()].sort()).toEqual(["", "Ideas", "Papers"]);
  const noIdeas = filterGraph(graph, new Set(["Ideas"]));
  expect(noIdeas.nodes.map((n) => n.id).sort()).toEqual([
    "Centre",
    "Inbox",
    "Nelson1959",
  ]);
  expect(noIdeas.links.some((l) => l.target === "Other idea")).toBe(false);
});
