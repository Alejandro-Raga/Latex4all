import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PanelBoundary } from "@/components/panel-boundary";

it("keeps a crash inside its panel and can reload it", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  let broken = true;
  function Flaky() {
    if (broken) throw new Error("Previous layout not found");
    return <p>Vault is fine</p>;
  }
  const el = document.createElement("div");
  document.body.append(el);
  await act(async () =>
    createRoot(el).render(
      <>
        <PanelBoundary name="Vault">
          <Flaky />
        </PanelBoundary>
        <p>Editor keeps working</p>
      </>,
    ),
  );
  expect(el.textContent).toContain("Vault stopped working");
  expect(el.textContent).toContain("Previous layout not found");
  expect(el.textContent).toContain("Editor keeps working");
  broken = false;
  const reload = [...el.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Reload panel"),
  );
  await act(async () => reload?.click());
  expect(el.textContent).toContain("Vault is fine");
});
