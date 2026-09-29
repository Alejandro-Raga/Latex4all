import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

it("keeps each project's tabs and panels, and restores them on return", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const { WorkspaceMemory } = await import(
    "@/components/workspace/workspace-memory"
  );
  const { useDocumentStore } = await import("@/stores/document-store");
  const { useReadingStore } = await import("@/stores/reading-store");
  const { useDockStore } = await import("@/stores/dock-store");

  const el = document.createElement("div");
  document.body.append(el);
  await act(async () =>
    useDocumentStore.setState({ projectRoot: "/p/A" } as any),
  );
  await act(async () => createRoot(el).render(<WorkspaceMemory />));

  // Work in A: a PDF tab and the Vault.
  await act(async () => {
    useReadingStore.getState().open({
      id: "/p/A/fig.pdf",
      label: "fig.pdf",
      data: new Uint8Array(),
      filePath: "/p/A/fig.pdf",
    });
    useDockStore.getState().setOpen("vault", true);
  });
  await wait(700);

  // Over to B: nothing of A's comes along.
  await act(async () =>
    useDocumentStore.setState({ projectRoot: "/p/B" } as any),
  );
  await wait(50);
  expect(useReadingStore.getState().papers).toEqual([]);
  expect(useDockStore.getState().open.vault).toBe(true); // B has no memory yet: left as is
  await act(async () => useDockStore.getState().setOpen("vault", false));
  await wait(700);

  // Back to A: its tab and panel return, the tab in front.
  await act(async () =>
    useDocumentStore.setState({ projectRoot: "/p/A" } as any),
  );
  await wait(100);
  const reading = useReadingStore.getState();
  expect(reading.papers.map((p) => p.label)).toEqual(["fig.pdf"]);
  expect(reading.active).toBe("/p/A/fig.pdf");
  expect(useDockStore.getState().open.vault).toBe(true);
});
