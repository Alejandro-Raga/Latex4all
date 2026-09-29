/**
 * Pages for the WebKit end-to-end tests: one piece of the app at a time,
 * picked by ?scenario=, with Tauri stubbed out (no native side here).
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import "../src/styles/globals.css";
import { ThemeBridge } from "@/components/theme-bridge";
import {
  RightDock,
  WideDockPanel,
} from "@/components/workspace/dock/right-dock";
import { PdfViewer } from "@/components/workspace/preview/pdf-viewer";
import { VaultGraph } from "@/components/workspace/vault-graph";
import { THEME_IDS } from "@/lib/app-themes";
import { useDockStore } from "@/stores/dock-store";

(window as any).__TAURI_INTERNALS__ = {
  invoke: async () => {
    throw new Error("no native side in tests");
  },
  transformCallback: () => 0,
};
const params = new URLSearchParams(location.search);
const scenario = params.get("scenario");
const root = createRoot(document.getElementById("root") as HTMLElement);
const chrome = {
  "--titlebar-height": "30px",
  "--workspace-topbar-height": "40px",
} as React.CSSProperties;

if (scenario === "dock") {
  (window as any).dock = useDockStore;
  useDockStore.setState({
    collapsed: { reference: false, vault: false, notes: false },
  });
  useDockStore.getState().setOpen("reference", true);
  function Dock() {
    const wide = useDockStore((s) => s.wide);
    return (
      <div className="flex h-full" style={chrome}>
        <div className="min-w-0 flex-1" data-testid="pane">
          {wide ? <WideDockPanel /> : "pane"}
        </div>
        <div style={{ width: 380 }}>
          <RightDock />
        </div>
      </div>
    );
  }
  root.render(<Dock />);
}

if (scenario === "pdf") {
  fetch("/examples/report-scientific/main.pdf")
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      function Viewer() {
        const [scale, setScale] = useState(1);
        return (
          <div className="flex h-full flex-col">
            <PdfViewer
              data={new Uint8Array(buf)}
              scale={scale}
              onScaleChange={setScale}
              theme="light"
              onThemeChange={() => {}}
              onTextSelect={(s) => {
                (window as any).lastSelection = s?.text ?? null;
                (window as any).lastRects = s?.rects ?? null;
                (window as any).lastPageHeight = s?.pageHeight ?? null;
              }}
            />
          </div>
        );
      }
      root.render(<Viewer />);
    });
}

if (scenario === "graph") {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    id: `n${i}`,
    label: i === 0 ? "Centre" : `Note ${i}`,
    color: ["#3b82f6", "#f59e0b", "#10b981"][i % 3],
    centre: i === 0,
  }));
  const links: { source: string; target: string }[] = [];
  for (let i = 1; i < 60; i++) {
    links.push({ source: `n${i}`, target: `n${Math.floor(rnd() * i)}` });
  }
  root.render(
    <div style={{ width: 800, padding: 16 }}>
      <VaultGraph
        nodes={nodes}
        links={links}
        height={500}
        onOpen={(id) => {
          (window as any).opened = id;
        }}
      />
    </div>,
  );
}

if (scenario === "theme") {
  const theme = params.get("theme") ?? "light";
  root.render(
    <ThemeProvider attribute="class" themes={THEME_IDS} forcedTheme={theme}>
      <ThemeBridge />
      <div className="h-full bg-background p-4 text-foreground">themed</div>
    </ThemeProvider>,
  );
}
